'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createUserMutationGate } from '@/lib/userMutationGate'
import { createClient, forceNewClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { getActiveCacheUserId, getCachedLists, setCachedLists, setCachedList, removeCachedList } from '@/lib/cache'
import { perfLog } from '@/lib/startupPerfLog'
import {
  isLikelyConnectivityError,
  resolveServerWorkOutcomeFromResult,
  resolveServerWorkOutcomeFromThrown,
  type ServerWorkOutcome,
} from '@/lib/connectivityErrors'
import { STILL_SAVING_TEMP_ENTITY_MSG } from '@/lib/mutationToastPolicy'
import type { Database, ItemWithState, Json, ListWithRole, ListUserSumScope } from '@/lib/supabase/types'
import { normalizeItemCategory } from '@/lib/supabase/types'
import type { RealtimeChannel } from '@supabase/supabase-js'

const supabase = createClient()

const FETCH_TIMEOUT_MS = 10_000
const SAVE_TIMEOUT_MS = 10_000
type UserListsRpcRow = Database['public']['Functions']['get_user_lists']['Returns'][number]

function createTempId(prefix: string) {
  return `temp-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function isTempEntityId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('temp-')
}

function coalesceListUserSumScope(raw: unknown): ListUserSumScope {
  if (raw === 'all' || raw === 'active' || raw === 'archived' || raw === 'none') return raw
  return 'none'
}

export function useLists() {
  const { user, loading: authLoading, bootstrapUserId } = useAuth()
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
  const mutationVersionRef = useRef(0)
  const realtimeScheduleCaptureVersionRef = useRef<number | null>(null)
  const scheduleRealtimeFetchRef = useRef<(delayMs: number, consumePending?: boolean) => void>(() => {})
  const userId = user?.id ?? (authLoading ? bootstrapUserId : null)

  const {
    isOfflineActionsDisabled,
    recoveryFetchGeneration,
    enterOffline,
    markOnlineRecovered,
    beginServerWork,
    endServerWork,
    startTempSyncWatch,
    canMutateNow,
    blockedMutationMessage,
  } = useConnectivity()
  const mutationGate = useMemo(() => createUserMutationGate(), [])
  const tryBeginMutation = useCallback((): boolean => {
    if (!canMutateNow()) return false
    return mutationGate.tryBegin()
  }, [canMutateNow, mutationGate])

  useEffect(() => {
    perfLog('localStorage read start')
    const lsT0 = performance.now()
    let approxStorageChars = 0
    try {
      const scoped = userId || getActiveCacheUserId()
      if (scoped && typeof localStorage !== 'undefined') {
        approxStorageChars = localStorage.getItem(`cached_lists_${scoped}`)?.length ?? 0
      }
    } catch {
      // ignore
    }
    const cachedLists = getCachedLists(userId)?.lists || []
    perfLog('localStorage read end', {
      durationMs: Math.round(performance.now() - lsT0),
      bytesOrItemCount: cachedLists.length,
      approxStorageChars,
    })
    setLists(cachedLists)
    setLoading(!!userId && cachedLists.length === 0)
    setHasCompletedInitialFetch(false)
    hasInitialDataRef.current = cachedLists.length > 0
  }, [userId])

  const trackSaveOperation = async (operation: PromiseLike<unknown>): Promise<unknown> => {
    pendingSaveOpsRef.current++
    setSaveTimedOut(false)

    if (!saveTimeoutRef.current) {
      saveTimeoutRef.current = setTimeout(() => {
        if (pendingSaveOpsRef.current > 0) setSaveTimedOut(true)
      }, SAVE_TIMEOUT_MS)
    }

    beginServerWork()
    try {
      const result = await Promise.resolve(operation)
      endServerWork(resolveServerWorkOutcomeFromResult(result))
      return result
    } catch (e) {
      endServerWork(resolveServerWorkOutcomeFromThrown(e))
      throw e
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

  const fetchLists = useCallback(async (options?: { staleCheckVersion?: number | null }) => {
    const staleCheck = options?.staleCheckVersion
    let staleDiscarded = false

    if (!userId) {
      perfLog('fetchLists start', { note: 'no user' })
      setLists([])
      setLoading(false)
      setIsFetching(false)
      setHasCompletedInitialFetch(true)
      perfLog('fetchLists end', { durationMs: 0, listCount: 0 })
      return
    }

    if (fetchingRef.current) return
    const fetchT0 = performance.now()
    perfLog('fetchLists start')
    let listCount = 0
    let fetchErr: string | undefined
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

    beginServerWork()
    let serverOutcome: ServerWorkOutcome = 'success'
    try {
      // Fetch all lists with counts in a single RPC call
      const { data, error: rpcError } = await supabase.rpc('get_user_lists')

      if (rpcError) throw rpcError

      if (staleCheck != null && staleCheck !== mutationVersionRef.current) {
        staleDiscarded = true
        if (process.env.NODE_ENV === 'development') {
          console.log('[useLists] delayed fetch discarded (stale)', {
            capturedVersion: staleCheck,
            currentMutationVersion: mutationVersionRef.current,
          })
        }
        serverOutcome = 'success'
        return
      }

      if (staleCheck != null && process.env.NODE_ENV === 'development') {
        console.log('[useLists] delayed fetch applied', {
          capturedVersion: staleCheck,
          currentMutationVersion: mutationVersionRef.current,
        })
      }

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
        archivedItemCount: item.archivedItemCount ?? 0,
        sumScope: coalesceListUserSumScope(item.sumScope),
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
      listCount = listsData.length
      markOnlineRecovered('fetchLists-success')
      serverOutcome = 'success'
    } catch (err) {
      serverOutcome = isLikelyConnectivityError(err) ? 'connectivity_failure' : 'application_error'
      if (serverOutcome === 'connectivity_failure') {
        enterOffline('fetchLists-connectivity-error')
      }
      fetchErr = (err as Error).message
      setError((err as Error).message)
    } finally {
      endServerWork(serverOutcome)
      perfLog('fetchLists end', {
        durationMs: Math.round(performance.now() - fetchT0),
        listCount,
        error: fetchErr,
        staleDiscarded,
      })
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current)
      setLoading(false)
      setIsFetching(false)
      setHasCompletedInitialFetch(true)
      fetchingRef.current = false
      if (staleCheck != null) {
        realtimeScheduleCaptureVersionRef.current = null
      }
      if (staleDiscarded) {
        queueMicrotask(() => {
          scheduleRealtimeFetchRef.current(0)
        })
      }
    }
  }, [beginServerWork, endServerWork, enterOffline, markOnlineRecovered, userId])

  const isInitialSyncing = isFetching && !hasCompletedInitialFetch && lists.length > 0

  const refreshLists = useCallback(() => {
    void fetchLists()
  }, [fetchLists])

  // Initial fetch
  useEffect(() => {
    fetchLists()
  }, [fetchLists])

  const lastRecoveryFetchGenRef = useRef(0)
  useEffect(() => {
    if (!userId) return
    if (recoveryFetchGeneration <= lastRecoveryFetchGenRef.current) return
    lastRecoveryFetchGenRef.current = recoveryFetchGeneration
    void fetchLists()
  }, [recoveryFetchGeneration, fetchLists, userId])

  useEffect(() => {
    setCachedLists(userId, lists)
  }, [userId, lists])

  // Real-time subscriptions
  useEffect(() => {
    if (!userId) return

    const scheduleRealtimeFetch = (delayMs: number, consumePending = false) => {
      if (realtimeScheduleCaptureVersionRef.current === null) {
        realtimeScheduleCaptureVersionRef.current = mutationVersionRef.current
        if (process.env.NODE_ENV === 'development') {
          console.log('[useLists] realtime fetch scheduled, captured mutation version', realtimeScheduleCaptureVersionRef.current)
        }
      }

      if (realtimeDebounceRef.current) {
        clearTimeout(realtimeDebounceRef.current)
      }

      realtimeDebounceRef.current = setTimeout(() => {
        realtimeDebounceRef.current = null

        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
          if (consumePending) pendingRealtimeRef.current = true
          realtimeScheduleCaptureVersionRef.current = null
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
        const cap = realtimeScheduleCaptureVersionRef.current
        if (cap == null) {
          void fetchLists()
        } else {
          void fetchLists({ staleCheckVersion: cap })
        }
      }, Math.max(delayMs, 0))
    }

    scheduleRealtimeFetchRef.current = scheduleRealtimeFetch

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

    const subscribeT0 = performance.now()
    perfLog('realtime subscribe start')
    let subscribeEndLogged = false
    const logRealtimeSubscribeEnd = (extra: Record<string, unknown> = {}) => {
      if (subscribeEndLogged) return
      subscribeEndLogged = true
      perfLog('realtime subscribe end', {
        durationMs: Math.round(performance.now() - subscribeT0),
        ...extra,
      })
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
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          logRealtimeSubscribeEnd({})
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          logRealtimeSubscribeEnd({ error: err?.message ?? status })
        }
      })

    channelRef.current = channel

    return () => {
      scheduleRealtimeFetchRef.current = () => {}
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
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
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
      archivedItemCount: 0,
      sumScope: 'none',
      label: label || '',
    }

    mutationVersionRef.current += 1
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
      if (isLikelyConnectivityError(error)) {
        startTempSyncWatch()
        return { error: new Error('Syncing with server ...') }
      }
      return { error }
    }

    const newList: ListWithRole = {
      ...data,
      role: 'owner',
      userArchived: false,
      memberCount: 0,
      activeItemCount: 0,
      archivedItemCount: 0,
      sumScope: 'none',
      label: label || '',
    }
    setLists(prev => [newList, ...prev.filter(list => list.id !== tempId && list.id !== newList.id)])
    markOnlineRecovered()

    return { data, error: null }
    } finally {
      mutationGate.end()
    }
  }

  const updateList = async (listId: string, updates: { name?: string; archived?: boolean; comment?: string | null; category_names?: string | null; category_order?: string | null }) => {
    if (isTempEntityId(listId)) {
      return { error: new Error(STILL_SAVING_TEMP_ENTITY_MSG) }
    }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
      const previousList = lists.find(list => list.id === listId)
      mutationVersionRef.current += 1
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
        if (isLikelyConnectivityError(error)) {
          startTempSyncWatch()
          return { error: new Error('Syncing with server ...') }
        }
        return { error }
      }

      markOnlineRecovered()
      return { error: null }
    } finally {
      mutationGate.end()
    }
  }

  const deleteList = async (listId: string) => {
    if (isTempEntityId(listId)) {
      return { error: new Error(STILL_SAVING_TEMP_ENTITY_MSG) }
    }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
      const { error } = await trackSaveOperation(
        supabase
          .from('lists')
          .delete()
          .eq('id', listId)
      )

      if (!error) {
        mutationVersionRef.current += 1
        skipRealtimeUntilRef.current = Date.now() + 2000
        setLists(prev => prev.filter(list => list.id !== listId))
        removeCachedList(userId, listId)
        markOnlineRecovered()
      } else if (isLikelyConnectivityError(error)) {
        startTempSyncWatch()
        return { error: new Error('Syncing with server ...') }
      }

      return { error }
    } finally {
      mutationGate.end()
    }
  }

  const updateUserListState = async (listId: string, updates: { archived?: boolean; sort_order?: number }) => {
    if (!user) return { error: new Error('Not authenticated') }
    if (isTempEntityId(listId)) {
      return { error: new Error(STILL_SAVING_TEMP_ENTITY_MSG) }
    }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
    const previousLists = lists
    const nextLists = updates.archived !== undefined
      ? moveListBetweenSections(lists, listId, updates.archived)
      : lists.map(list =>
          list.id === listId ? { ...list, userArchived: updates.archived ?? list.userArchived } : list
        )

    mutationVersionRef.current += 1
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
      if (isLikelyConnectivityError(error)) {
        startTempSyncWatch()
        return { error: new Error('Syncing with server ...') }
      }
      return { error }
    }

    if (updates.archived !== undefined) {
      const orderError = await persistListOrder(nextLists)
      if (orderError) {
        setLists(previousLists)
        return { error: orderError }
      }
    }

    markOnlineRecovered()
    return { error: null }
    } finally {
      mutationGate.end()
    }
  }

  const joinListByToken = async (token: string) => {
    if (!tryBeginMutation()) {
      return { data: null, error: new Error(blockedMutationMessage()) }
    }
    try {
      const freshClient = forceNewClient()
      const { data, error } = await trackSaveOperation(
        freshClient.rpc('join_list_by_token', { p_token: token })
      )

      if (!error) {
        skipRealtimeUntilRef.current = Date.now() + 2000
        await fetchLists()
        markOnlineRecovered()
      } else if (isLikelyConnectivityError(error)) {
        startTempSyncWatch()
        return { data: null, error: new Error('Syncing with server ...') }
      }

      return { data, error }
    } finally {
      mutationGate.end()
    }
  }

  const leaveList = async (listId: string) => {
    if (!user) return { error: new Error('Not authenticated') }
    if (isTempEntityId(listId)) {
      return { error: new Error(STILL_SAVING_TEMP_ENTITY_MSG) }
    }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
      const { error } = await trackSaveOperation(
        supabase.rpc('leave_list', {
          p_list_id: listId,
        })
      )

      if (error) {
        if (isLikelyConnectivityError(error)) {
          startTempSyncWatch()
          return { error: new Error('Syncing with server ...') }
        }
        return { error }
      }

      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      setLists(prev => prev.filter(list => list.id !== listId))
      removeCachedList(userId, listId)
      markOnlineRecovered()

      return { error: null }
    } finally {
      mutationGate.end()
    }
  }

  const duplicateList = async (listId: string, newName: string, label?: string) => {
    if (!user) return { error: new Error('Not authenticated') }
    if (isTempEntityId(listId)) {
      return { error: new Error(STILL_SAVING_TEMP_ENTITY_MSG) }
    }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
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
      archivedItemCount: sourceList?.archivedItemCount ?? 0,
      sumScope: 'none',
      label: label || '',
    }

    mutationVersionRef.current += 1
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
      if (isLikelyConnectivityError(error)) {
        startTempSyncWatch()
        return { error: new Error('Syncing with server ...') }
      }
      return { error }
    }

    if (!data?.list) {
      setLists(prev => prev.filter(list => list.id !== tempId))
      return { error: new Error('Failed to duplicate list') }
    }

    const dupMembers = (data.members ?? []) as { is_target?: boolean }[]
    const dupItems = data.items ?? []
    const duplicatedList: ListWithRole = {
      ...data.list,
      role: 'owner',
      userArchived: false,
      memberCount: dupMembers.filter(m => !m.is_target).length,
      activeItemCount: dupItems.filter((item: { archived: boolean }) => !item.archived).length,
      archivedItemCount: dupItems.filter((item: { archived: boolean }) => item.archived).length,
      sumScope: 'none',
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
    markOnlineRecovered()

    return { data: data.list, error: null }
    } finally {
      mutationGate.end()
    }
  }

  const importList = async (name: string, label?: string, categoryNames?: string, rows?: Json, hasTargets?: boolean) => {
    if (!user) return { error: new Error('Not authenticated') }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
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
      archivedItemCount: 0,
      sumScope: 'none',
      label: label || '',
    }

    mutationVersionRef.current += 1
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
      if (isLikelyConnectivityError(error)) {
        startTempSyncWatch()
        return { error: new Error('Syncing with server ...') }
      }
      return { error }
    }

    const newList: ListWithRole = {
      ...data,
      role: 'owner',
      userArchived: false,
      memberCount: hasTargets ? 1 : 0,
      activeItemCount: itemCount,
      archivedItemCount: 0,
      sumScope: 'none',
      label: label || '',
    }
    setLists(prev => [newList, ...prev.filter(list => list.id !== tempId && list.id !== newList.id)])
    markOnlineRecovered()

    return { data, error: null }
    } finally {
      mutationGate.end()
    }
  }

  const persistListLabelOnly = async (listId: string, label: string) => {
    const previousLists = lists
    mutationVersionRef.current += 1
    skipRealtimeUntilRef.current = Date.now() + 2000
    setLists(prev => prev.map(list =>
      list.id === listId ? { ...list, label } : list
    ))

    const { error } = await trackSaveOperation(
      supabase
        .from('list_users')
        .update({ label })
        .eq('list_id', listId)
        .eq('user_id', user!.id)
    )

    if (error) {
      setLists(previousLists)
      if (isLikelyConnectivityError(error)) {
        startTempSyncWatch()
        return { error: new Error('Syncing with server ...') }
      }
    } else {
      markOnlineRecovered()
    }

    return { error }
  }

  const updateListLabel = async (listId: string, label: string) => {
    if (!user) return { error: new Error('Not authenticated') }
    if (isTempEntityId(listId)) {
      return { error: new Error(STILL_SAVING_TEMP_ENTITY_MSG) }
    }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
      return await persistListLabelOnly(listId, label)
    } finally {
      mutationGate.end()
    }
  }

  const applyListLabelsBatch = async (changes: Array<{ listId: string; label: string }>) => {
    if (!user) return { error: new Error('Not authenticated') }
    if (changes.some(c => isTempEntityId(c.listId))) {
      return { error: new Error(STILL_SAVING_TEMP_ENTITY_MSG) }
    }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
      for (const { listId, label } of changes) {
        const { error } = await persistListLabelOnly(listId, label)
        if (error) return { error }
      }
      return { error: null }
    } finally {
      mutationGate.end()
    }
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
    if (reorderedLists.some(l => isTempEntityId(l.id))) {
      return
    }
    if (!tryBeginMutation()) {
      return
    }
    try {
    const previousLists = lists
    mutationVersionRef.current += 1
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

    const firstError = results.find(r => (r as { error?: unknown }).error) as { error?: unknown } | undefined
    if (firstError?.error) {
      setLists(previousLists)
      if (isLikelyConnectivityError(firstError.error)) {
        startTempSyncWatch()
      }
    } else {
      markOnlineRecovered()
    }
    } finally {
      mutationGate.end()
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
    refresh: refreshLists,
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
    applyListLabelsBatch,
    labels,
    isOfflineActionsDisabled,
  }
}
