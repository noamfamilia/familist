'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient, forceNewClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import { getCachedLists, setCachedLists, setCachedList, removeCachedList } from '@/lib/cache'
import type { Database, ItemWithState, ListWithRole, MemberWithCreator } from '@/lib/supabase/types'
import type { RealtimeChannel } from '@supabase/supabase-js'

const supabase = createClient()

const FETCH_TIMEOUT_MS = 5000
const SAVE_TIMEOUT_MS = 5000

type UserListsRpcRow = Database['public']['Functions']['get_user_lists']['Returns'][number]

function createTempId(prefix: string) {
  return `temp-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function useLists() {
  const { user } = useAuth()
  // Initialize from cache for instant load
  const [lists, setLists] = useState<ListWithRole[]>(() => getCachedLists()?.lists || [])
  const [loading, setLoading] = useState(() => !getCachedLists()?.lists?.length)
  const [isFetching, setIsFetching] = useState(true)
  const [hasCompletedInitialFetch, setHasCompletedInitialFetch] = useState(false)
  const [fetchTimedOut, setFetchTimedOut] = useState(false)
  const [saveTimedOut, setSaveTimedOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchingRef = useRef(false)
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingSaveOpsRef = useRef(0)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const skipRealtimeUntilRef = useRef<number>(0)
  const hasInitialDataRef = useRef(false)
  const realtimeDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const pendingRealtimeRef = useRef(false)
  const userId = user?.id

  useEffect(() => {
    const cachedLists = getCachedLists(userId)?.lists || []
    setLists(cachedLists)
    setLoading(!!userId && cachedLists.length === 0)
    setHasCompletedInitialFetch(false)
    hasInitialDataRef.current = cachedLists.length > 0
  }, [userId])

  const trackSaveOperation = async <T>(operation: Promise<T>): Promise<T> => {
    pendingSaveOpsRef.current++
    setSaveTimedOut(false)

    if (!saveTimeoutRef.current) {
      saveTimeoutRef.current = setTimeout(() => {
        if (pendingSaveOpsRef.current > 0) setSaveTimedOut(true)
      }, SAVE_TIMEOUT_MS)
    }

    try {
      return await operation
    } finally {
      pendingSaveOpsRef.current--
      if (pendingSaveOpsRef.current === 0) {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
          saveTimeoutRef.current = null
        }
        setSaveTimedOut(false)
      }
    }
  }

  const persistListOrder = async (orderedLists: ListWithRole[]) => {
    if (!user) return null

    const results = await Promise.all(
      orderedLists.map((list, index) =>
        trackSaveOperation(
          supabase
            .from('list_users')
            .update({ sort_order: index })
            .eq('list_id', list.id)
            .eq('user_id', user.id)
        )
      )
    )

    return results.find(result => result.error)?.error || null
  }

  const moveListBetweenSections = (currentLists: ListWithRole[], listId: string, archived: boolean) => {
    const targetList = currentLists.find(list => list.id === listId)
    if (!targetList) return currentLists

    const remainingLists = currentLists.filter(list => list.id !== listId)
    const activeLists = remainingLists.filter(list => !list.userArchived)
    const archivedLists = remainingLists.filter(list => list.userArchived)
    const updatedList = { ...targetList, userArchived: archived }

    return [...activeLists, updatedList, ...archivedLists]
  }

  const fetchLists = useCallback(async () => {
    if (!userId) {
      setLists([])
      setLoading(false)
      setIsFetching(false)
      setHasCompletedInitialFetch(true)
      return
    }

    if (fetchingRef.current) return
    fetchingRef.current = true
    setIsFetching(true)
    setFetchTimedOut(false)

    // Set timeout for fetch
    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current)
    fetchTimeoutRef.current = setTimeout(() => {
      if (fetchingRef.current) {
        setFetchTimedOut(true)
      }
    }, FETCH_TIMEOUT_MS)

    // Only show loading spinner on initial load if no cached data
    if (!hasInitialDataRef.current && !getCachedLists(userId)?.lists?.length) {
      setLoading(true)
    }
    setError(null)

    try {
      // Fetch all lists with counts in a single RPC call
      const { data, error: rpcError } = await supabase.rpc('get_user_lists')

      if (rpcError) throw rpcError

      const listsData: ListWithRole[] = (data || []).map((item: UserListsRpcRow) => ({
        id: item.id,
        name: item.name,
        owner_id: item.owner_id,
        visibility: item.visibility,
        archived: item.archived,
        created_at: item.created_at,
        updated_at: item.updated_at,
        role: item.role,
        userArchived: item.userArchived,
        memberCount: item.memberCount,
        activeItemCount: item.activeItemCount,
        ownerNickname: item.ownerNickname,
        comment: item.comment,
      }))

      setLists(listsData)
      setCachedLists(userId, listsData)
      hasInitialDataRef.current = true
      setFetchTimedOut(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current)
      setLoading(false)
      setIsFetching(false)
      setHasCompletedInitialFetch(true)
      fetchingRef.current = false
    }
  }, [userId])

  const isInitialSyncing = isFetching && !hasCompletedInitialFetch && lists.length > 0

  // Initial fetch
  useEffect(() => {
    fetchLists()
  }, [fetchLists])

  useEffect(() => {
    setCachedLists(userId, lists)
  }, [userId, lists])

  // Real-time subscriptions
  useEffect(() => {
    if (!userId) return

    const scheduleRealtimeFetch = (delayMs: number, consumePending = false) => {
      if (realtimeDebounceRef.current) {
        clearTimeout(realtimeDebounceRef.current)
      }

      realtimeDebounceRef.current = setTimeout(() => {
        realtimeDebounceRef.current = null

        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
          if (consumePending) pendingRealtimeRef.current = true
          return
        }

        const remainingSkipMs = skipRealtimeUntilRef.current - Date.now()
        if (remainingSkipMs > 0) {
          if (consumePending || pendingRealtimeRef.current) {
            scheduleRealtimeFetch(remainingSkipMs, true)
          }
          return
        }

        if (consumePending) pendingRealtimeRef.current = false
        fetchLists()
      }, Math.max(delayMs, 0))
    }

    const handleRealtimeChange = () => {
      // Skip fetch if we recently did a local optimistic update (within 2 seconds)
      if (Date.now() < skipRealtimeUntilRef.current) {
        return
      }

      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        pendingRealtimeRef.current = true
        return
      }

      scheduleRealtimeFetch(250)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || !pendingRealtimeRef.current) return
      scheduleRealtimeFetch(0, true)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    const channel = supabase
      .channel(`lists-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lists' },
        handleRealtimeChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'list_users', filter: `user_id=eq.${userId}` },
        handleRealtimeChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'members' },
        handleRealtimeChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'items' },
        handleRealtimeChange
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (realtimeDebounceRef.current) {
        clearTimeout(realtimeDebounceRef.current)
        realtimeDebounceRef.current = null
      }
      pendingRealtimeRef.current = false
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
    }
  }, [userId, fetchLists])

  const createList = async (name: string) => {
    if (!user) return { error: new Error('Not authenticated') }

    const tempId = createTempId('list')
    const now = new Date().toISOString()
    const optimisticList: ListWithRole = {
      id: tempId,
      name,
      owner_id: user.id,
      visibility: 'private',
      archived: false,
      comment: null,
      join_token_hash: null,
      join_role_granted: 'editor',
      join_expires_at: null,
      join_revoked_at: null,
      join_use_count: 0,
      created_at: now,
      updated_at: now,
      role: 'owner',
      userArchived: false,
      memberCount: 0,
      activeItemCount: 0,
    }

    skipRealtimeUntilRef.current = Date.now() + 2000
    setLists(prev => [optimisticList, ...prev])

    const { data, error } = await trackSaveOperation(
      supabase
        .from('lists')
        .insert({ name, owner_id: user.id })
        .select()
        .single()
    )

    if (error) {
      setLists(prev => prev.filter(list => list.id !== tempId))
      if (error.code === '23505') {
        return { error: new Error('You already have a list with this name') }
      }
      return { error }
    }

    const newList: ListWithRole = {
      ...data,
      role: 'owner',
      userArchived: false,
      memberCount: 0,
      activeItemCount: 0,
    }
    const finalLists = [newList, ...lists.filter(list => list.id !== tempId && list.id !== newList.id)]
    setLists(finalLists)
    await persistListOrder(finalLists)

    return { data, error: null }
  }

  const updateList = async (listId: string, updates: { name?: string; archived?: boolean; comment?: string | null }) => {
    const previousList = lists.find(list => list.id === listId)
    skipRealtimeUntilRef.current = Date.now() + 2000
    setLists(prev => prev.map(list => 
      list.id === listId ? { ...list, ...updates } : list
    ))

    const { error } = await trackSaveOperation(
      supabase
        .from('lists')
        .update(updates)
        .eq('id', listId)
    )

    if (error) {
      if (previousList) {
        setLists(prev => prev.map(list => list.id === listId ? previousList : list))
      }
      if (error.code === '23505') {
        return { error: new Error('You already have a list with this name') }
      }
      return { error }
    }

    return { error: null }
  }

  const deleteList = async (listId: string) => {
    const { error } = await trackSaveOperation(
      supabase
        .from('lists')
        .delete()
        .eq('id', listId)
    )

    if (!error) {
      skipRealtimeUntilRef.current = Date.now() + 2000
      setLists(prev => prev.filter(list => list.id !== listId))
      removeCachedList(userId, listId)
    }

    return { error }
  }

  const updateUserListState = async (listId: string, updates: { archived?: boolean; sort_order?: number }) => {
    if (!user) return { error: new Error('Not authenticated') }

    const previousLists = lists
    const nextLists = updates.archived !== undefined
      ? moveListBetweenSections(lists, listId, updates.archived)
      : lists.map(list =>
          list.id === listId ? { ...list, userArchived: updates.archived ?? list.userArchived } : list
        )

    skipRealtimeUntilRef.current = Date.now() + 2000
    setLists(nextLists)

    const { error } = await trackSaveOperation(
      supabase
        .from('list_users')
        .update(updates)
        .eq('list_id', listId)
        .eq('user_id', user.id)
    )

    if (error) {
      setLists(previousLists)
      return { error }
    }

    if (updates.archived !== undefined) {
      const orderError = await persistListOrder(nextLists)
      if (orderError) {
        setLists(previousLists)
        return { error: orderError }
      }
    }

    return { error: null }
  }

  const joinListByToken = async (token: string) => {
    const freshClient = forceNewClient()
    const { data, error } = await trackSaveOperation(
      freshClient.rpc('join_list_by_token', { p_token: token })
    )

    if (!error) {
      skipRealtimeUntilRef.current = Date.now() + 2000
      await fetchLists()
    }

    return { data, error }
  }

  const leaveList = async (listId: string) => {
    if (!user) return { error: new Error('Not authenticated') }

    const { error } = await trackSaveOperation(
      supabase.rpc('leave_list', {
        p_list_id: listId,
      })
    )

    if (error) return { error }

    skipRealtimeUntilRef.current = Date.now() + 2000
    setLists(prev => prev.filter(list => list.id !== listId))
    removeCachedList(userId, listId)

    return { error: null }
  }

  const duplicateList = async (listId: string, newName: string) => {
    if (!user) return { error: new Error('Not authenticated') }

    const [itemsResult, membersResult] = await Promise.all([
      trackSaveOperation(supabase.from('items').select('*').eq('list_id', listId)),
      trackSaveOperation(supabase.from('members').select('*').eq('list_id', listId)),
    ])

    if (itemsResult.error) return { error: itemsResult.error }
    if (membersResult.error) return { error: membersResult.error }

    const { data: newList, error: createError } = await trackSaveOperation(
      supabase
        .from('lists')
        .insert({ name: newName, owner_id: user.id })
        .select()
        .single()
    )

    if (createError) {
      if (createError.code === '23505') {
        return { error: new Error('You already have a list with this name') }
      }
      return { error: createError }
    }

    const memberMapping: Record<string, string> = {}
    const duplicatedMembers: MemberWithCreator[] = []
    const duplicatedItems: ItemWithState[] = []
    let memberCopyFailures = 0
    let itemCopyFailures = 0
    let stateCopyFailures = 0
    let copiedActiveItemCount = 0

    if (membersResult.data && membersResult.data.length > 0) {
      for (const member of membersResult.data) {
        const { data: newMember, error: memberError } = await trackSaveOperation(
          supabase
            .from('members')
            .insert({
              list_id: newList.id,
              name: member.name,
              created_by: user.id,
              sort_order: member.sort_order,
            })
            .select()
            .single()
        )

        if (memberError || !newMember) {
          memberCopyFailures++
          continue
        }
        memberMapping[member.id] = newMember.id
        duplicatedMembers.push({
          ...newMember,
          creator: null,
        })
      }
    }

    if (itemsResult.data && itemsResult.data.length > 0) {
      for (const item of itemsResult.data) {
        const { data: newItem, error: itemError } = await trackSaveOperation(
          supabase
            .from('items')
            .insert({
              list_id: newList.id,
              text: item.text,
              comment: item.comment,
              archived: item.archived,
              sort_order: item.sort_order,
            })
            .select()
            .single()
        )

        if (itemError || !newItem) {
          itemCopyFailures++
          continue
        }

        const duplicatedItem: ItemWithState = {
          ...newItem,
          memberStates: {},
        }
        duplicatedItems.push(duplicatedItem)

        if (!item.archived) {
          copiedActiveItemCount++
        }

        const { data: states } = await trackSaveOperation(
          supabase
            .from('item_member_state')
            .select('*')
            .eq('item_id', item.id)
        )

        if (states) {
          for (const state of states) {
            const newMemberId = memberMapping[state.member_id]
            if (newMemberId) {
              const { error: stateError } = await trackSaveOperation(
                supabase.from('item_member_state').insert({
                  item_id: newItem.id,
                  member_id: newMemberId,
                  quantity: state.quantity,
                  done: state.done,
                })
              )

              if (stateError) {
                stateCopyFailures++
              } else {
                duplicatedItem.memberStates[newMemberId] = {
                  ...state,
                  item_id: newItem.id,
                  member_id: newMemberId,
                }
              }
            }
          }
        }
      }
    }

    skipRealtimeUntilRef.current = Date.now() + 2000
    const duplicatedList: ListWithRole = {
      ...newList,
      role: 'owner',
      userArchived: false,
      memberCount: Object.keys(memberMapping).length,
      activeItemCount: copiedActiveItemCount,
    }
    setLists(prev => {
      if (prev.some(l => l.id === duplicatedList.id)) return prev
      return [duplicatedList, ...prev]
    })

    setCachedList(userId, newList.id, {
      list: newList,
      items: duplicatedItems,
      members: duplicatedMembers,
    })

    const warningParts: string[] = []
    if (memberCopyFailures > 0) {
      warningParts.push(`${memberCopyFailures} member${memberCopyFailures !== 1 ? 's were' : ' was'} skipped`)
    }
    if (itemCopyFailures > 0) {
      warningParts.push(`${itemCopyFailures} item${itemCopyFailures !== 1 ? 's were' : ' was'} skipped`)
    }
    if (stateCopyFailures > 0) {
      warningParts.push(`${stateCopyFailures} state${stateCopyFailures !== 1 ? 's were' : ' was'} skipped`)
    }

    const warning = warningParts.length > 0
      ? `List duplicated, but ${warningParts.join(', ')}.`
      : null

    return { data: newList, error: null, warning }
  }

  const reorderLists = async (reorderedLists: ListWithRole[]) => {
    if (!user) return

    skipRealtimeUntilRef.current = Date.now() + 2000
    setLists(reorderedLists)

    const updates = reorderedLists.map((list, index) => 
      trackSaveOperation(
        supabase
          .from('list_users')
          .update({ sort_order: index })
          .eq('list_id', list.id)
          .eq('user_id', user.id)
      )
    )

    await Promise.all(updates)
  }

  return {
    lists,
    loading,
    isFetching,
    isInitialSyncing,
    fetchTimedOut,
    saveTimedOut,
    error,
    refresh: fetchLists,
    createList,
    updateList,
    deleteList,
    updateUserListState,
    joinListByToken,
    leaveList,
    duplicateList,
    reorderLists,
  }
}
