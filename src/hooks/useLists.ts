'use client'
// @ts-nocheck

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient, forceNewClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import { getCachedLists, setCachedLists } from '@/lib/cache'
import type { ListWithRole } from '@/lib/supabase/types'
import type { RealtimeChannel } from '@supabase/supabase-js'

const supabase = createClient()

const FETCH_TIMEOUT_MS = 5000
const SAVE_TIMEOUT_MS = 5000

export function useLists() {
  const { user } = useAuth()
  // Initialize from cache for instant load
  const [lists, setLists] = useState<ListWithRole[]>(() => getCachedLists()?.lists || [])
  const [loading, setLoading] = useState(() => !getCachedLists()?.lists?.length)
  const [isFetching, setIsFetching] = useState(true)
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
  const userId = user?.id

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

  const fetchLists = useCallback(async () => {
    if (!userId) {
      setLists([])
      setLoading(false)
      setIsFetching(false)
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
    if (!hasInitialDataRef.current && !getCachedLists()?.lists?.length) {
      setLoading(true)
    }
    setError(null)

    try {
      // Fetch all lists with counts in a single RPC call
      const { data, error: rpcError } = await (supabase.rpc as any)('get_user_lists')

      if (rpcError) throw rpcError

      const listsData: ListWithRole[] = (data || []).map((item: any) => ({
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
      setCachedLists(listsData)
      hasInitialDataRef.current = true
      setFetchTimedOut(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current)
      setLoading(false)
      setIsFetching(false)
      fetchingRef.current = false
    }
  }, [userId])

  // Initial fetch
  useEffect(() => {
    fetchLists()
  }, [fetchLists])

  // Real-time subscriptions
  useEffect(() => {
    if (!userId) return

    const handleRealtimeChange = () => {
      // Skip fetch if we recently did a local optimistic update (within 2 seconds)
      if (Date.now() < skipRealtimeUntilRef.current) {
        return
      }
      fetchLists()
    }

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
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
    }
  }, [userId, fetchLists])

  const createList = async (name: string) => {
    if (!user) return { error: new Error('Not authenticated') }

    const { data, error } = await trackSaveOperation(
      supabase
        .from('lists')
        .insert({ name, owner_id: user.id })
        .select()
        .single()
    )

    if (error) {
      if (error.code === '23505') {
        return { error: new Error('You already have a list with this name') }
      }
      return { error }
    }

    skipRealtimeUntilRef.current = Date.now() + 2000

    const newList: ListWithRole = {
      ...data,
      role: 'owner',
      userArchived: false,
      memberCount: 0,
      activeItemCount: 0,
    }
    setLists(prev => {
      if (prev.some(l => l.id === newList.id)) return prev
      return [newList, ...prev]
    })

    return { data, error: null }
  }

  const updateList = async (listId: string, updates: { name?: string; archived?: boolean; comment?: string | null }) => {
    const { error } = await trackSaveOperation(
      supabase
        .from('lists')
        .update(updates)
        .eq('id', listId)
    )

    if (error) {
      if (error.code === '23505') {
        return { error: new Error('You already have a list with this name') }
      }
      return { error }
    }

    skipRealtimeUntilRef.current = Date.now() + 2000
    setLists(prev => prev.map(list => 
      list.id === listId ? { ...list, ...updates } : list
    ))

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
    }

    return { error }
  }

  const updateUserListState = async (listId: string, updates: { archived?: boolean; sort_order?: number }) => {
    if (!user) return { error: new Error('Not authenticated') }

    const { error } = await trackSaveOperation(
      supabase
        .from('list_users')
        .update(updates)
        .eq('list_id', listId)
        .eq('user_id', user.id)
    )

    if (!error) {
      skipRealtimeUntilRef.current = Date.now() + 2000
      setLists(prev => prev.map(list => 
        list.id === listId ? { ...list, userArchived: updates.archived ?? list.userArchived } : list
      ))
    }

    return { error }
  }

  const joinListByToken = async (token: string) => {
    const freshClient = forceNewClient()
    const { data, error } = await trackSaveOperation(
      (freshClient.rpc as any)('join_list_by_token', { p_token: token })
    )

    if (!error) {
      skipRealtimeUntilRef.current = Date.now() + 2000
      await fetchLists()
    }

    return { data, error }
  }

  const leaveList = async (listId: string) => {
    if (!user) return { error: new Error('Not authenticated') }

    const { error: membersError } = await trackSaveOperation(
      supabase
        .from('members')
        .delete()
        .eq('list_id', listId)
        .eq('created_by', user.id)
    )

    if (membersError) return { error: membersError }

    const { error: listUsersError } = await trackSaveOperation(
      supabase
        .from('list_users')
        .delete()
        .eq('list_id', listId)
        .eq('user_id', user.id)
    )

    if (listUsersError) return { error: listUsersError }

    supabase.channel(`list-${listId}`).send({
      type: 'broadcast',
      event: 'user_left',
      payload: { userId: user.id }
    })

    skipRealtimeUntilRef.current = Date.now() + 2000
    setLists(prev => prev.filter(list => list.id !== listId))

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

        if (memberError) continue
        memberMapping[member.id] = newMember.id
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

        if (itemError || !newItem) continue

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
              await trackSaveOperation(
                supabase.from('item_member_state').insert({
                  item_id: newItem.id,
                  member_id: newMemberId,
                  quantity: state.quantity,
                  done: state.done,
                })
              )
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
      memberCount: membersResult.data?.length || 0,
      activeItemCount: itemsResult.data?.filter(i => !i.archived).length || 0,
    }
    setLists(prev => {
      if (prev.some(l => l.id === duplicatedList.id)) return prev
      return [duplicatedList, ...prev]
    })

    return { data: newList, error: null }
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
