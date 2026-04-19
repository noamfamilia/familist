'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createClient, forceNewClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import { getCachedLists, setCachedLists, setCachedList, removeCachedList } from '@/lib/cache'
import type { Database, ItemWithState, Json, ListWithRole } from '@/lib/supabase/types'
import { normalizeItemCategory } from '@/lib/supabase/types'
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

    if (archived) {
      return [...activeLists, updatedList, ...archivedLists]
    }
    return [updatedList, ...activeLists, ...archivedLists]
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
        category_names: item.category_names ?? null,
        category_order: item.category_order ?? null,
        label: item.label ?? '',
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

  const createList = async (name: string, label?: string) => {
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
      category_names: null,
      category_order: null,
      join_token: null,
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
      label: label || '',
    }

    skipRealtimeUntilRef.current = Date.now() + 2000
    setLists(prev => [optimisticList, ...prev])

    const { data, error } = await trackSaveOperation(
      supabase.rpc('create_list', { p_name: name, p_label: label || '' })
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
      label: label || '',
    }
    setLists(prev => [newList, ...prev.filter(list => list.id !== tempId && list.id !== newList.id)])

    return { data, error: null }
  }

  const updateList = async (listId: string, updates: { name?: string; archived?: boolean; comment?: string | null; category_names?: string | null; category_order?: string | null }) => {
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

  const duplicateList = async (listId: string, newName: string, label?: string) => {
    if (!user) return { error: new Error('Not authenticated') }

    const sourceList = lists.find(l => l.id === listId)
    const tempId = createTempId('list')
    const now = new Date().toISOString()
    const optimisticList: ListWithRole = {
      id: tempId,
      name: newName,
      owner_id: user.id,
      visibility: 'private',
      archived: false,
      comment: null,
      category_names: sourceList?.category_names ?? null,
      category_order: sourceList?.category_order ?? null,
      join_token: null,
      join_role_granted: 'editor',
      join_expires_at: null,
      join_revoked_at: null,
      join_use_count: 0,
      created_at: now,
      updated_at: now,
      role: 'owner',
      userArchived: false,
      memberCount: sourceList?.memberCount ?? 0,
      activeItemCount: sourceList?.activeItemCount || 0,
      label: label || '',
    }

    skipRealtimeUntilRef.current = Date.now() + 2000
    setLists(prev => [optimisticList, ...prev])

    const { data, error } = await trackSaveOperation(
      supabase.rpc('duplicate_list', {
        p_source_list_id: listId,
        p_new_name: newName,
        p_label: label || '',
      })
    )

    if (error) {
      setLists(prev => prev.filter(list => list.id !== tempId))
      if (error.code === '23505') {
        return { error: new Error('You already have a list with this name') }
      }
      return { error }
    }

    if (!data?.list) {
      setLists(prev => prev.filter(list => list.id !== tempId))
      return { error: new Error('Failed to duplicate list') }
    }

    const dupMembers = (data.members ?? []) as { is_target?: boolean }[]
    const duplicatedList: ListWithRole = {
      ...data.list,
      role: 'owner',
      userArchived: false,
      memberCount: dupMembers.filter(m => !m.is_target).length,
      activeItemCount: data.items?.filter((item: { archived: boolean }) => !item.archived).length || 0,
      label: label || '',
    }

    setLists(prev => {
      const filtered = prev.filter(list => list.id !== tempId && list.id !== duplicatedList.id)
      const nextLists = [duplicatedList, ...filtered]
      setCachedLists(userId, nextLists)
      return nextLists
    })

    const rawDupItems = (data.items ?? []) as ItemWithState[]
    const dupItems: ItemWithState[] = rawDupItems.map(item => ({
      ...item,
      category: normalizeItemCategory(item.category),
    }))

    setCachedList(userId, duplicatedList.id, {
      list: data.list,
      items: dupItems,
      members: data.members || [],
    })

    return { data: data.list, error: null }
  }

  const importList = async (name: string, label?: string, categoryNames?: string, rows?: Json, hasTargets?: boolean) => {
    if (!user) return { error: new Error('Not authenticated') }

    const tempId = createTempId('list')
    const now = new Date().toISOString()
    const itemCount = Array.isArray(rows) ? rows.length : 0
    const optimisticList: ListWithRole = {
      id: tempId,
      name,
      owner_id: user.id,
      visibility: 'private',
      archived: false,
      comment: null,
      category_names: categoryNames || null,
      category_order: null,
      join_token: null,
      join_role_granted: 'editor',
      join_expires_at: null,
      join_revoked_at: null,
      join_use_count: 0,
      created_at: now,
      updated_at: now,
      role: 'owner',
      userArchived: false,
      memberCount: hasTargets ? 1 : 0,
      activeItemCount: itemCount,
      label: label || '',
    }

    skipRealtimeUntilRef.current = Date.now() + 2000
    setLists(prev => [optimisticList, ...prev])

    const { data, error } = await trackSaveOperation(
      supabase.rpc('import_list', {
        p_name: name,
        p_label: label || '',
        p_category_names: categoryNames || '{}',
        p_rows: (rows || []) as unknown as Json,
        p_has_targets: hasTargets || false,
      })
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
      memberCount: hasTargets ? 1 : 0,
      activeItemCount: itemCount,
      label: label || '',
    }
    setLists(prev => [newList, ...prev.filter(list => list.id !== tempId && list.id !== newList.id)])

    return { data, error: null }
  }

  const updateListLabel = async (listId: string, label: string) => {
    if (!user) return { error: new Error('Not authenticated') }

    const previousLists = lists
    skipRealtimeUntilRef.current = Date.now() + 2000
    setLists(prev => prev.map(list =>
      list.id === listId ? { ...list, label } : list
    ))

    const { error } = await trackSaveOperation(
      supabase
        .from('list_users')
        .update({ label })
        .eq('list_id', listId)
        .eq('user_id', user.id)
    )

    if (error) {
      setLists(previousLists)
    }

    return { error }
  }

  const labels = useMemo(() => {
    const set = new Set<string>()
    for (const list of lists) {
      if (list.label) set.add(list.label)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [lists])

  const reorderLists = async (reorderedLists: ListWithRole[]) => {
    if (!user) return

    const previousLists = lists
    skipRealtimeUntilRef.current = Date.now() + 2000
    setLists(reorderedLists)

    const results = await Promise.all(
      reorderedLists.map((list, index) => 
        trackSaveOperation(
          supabase
            .from('list_users')
            .update({ sort_order: index })
            .eq('list_id', list.id)
            .eq('user_id', user.id)
        )
      )
    )

    if (results.some(r => (r as { error?: unknown }).error)) {
      setLists(previousLists)
    }
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
    importList,
    reorderLists,
    updateListLabel,
    labels,
  }
}
