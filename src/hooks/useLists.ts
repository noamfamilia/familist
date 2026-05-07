'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createUserMutationGate } from '@/lib/userMutationGate'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { getActiveCacheUserId, getCachedLists, setCachedLists, setCachedList, removeCachedList } from '@/lib/cache'
import { useListsQuery } from '@/lib/data/queries'
import { db } from '@/lib/db'
import { APP_VERSION } from '@/lib/appVersion'
import { perfLog } from '@/lib/startupPerfLog'
import { appendMutationDiagnostic } from '@/lib/offlineNavDiagnostics'
import { reportServerDexieParityDiagnostics, upsertListsSummaryFromServer } from '@/lib/data/serverDexieParity'
import { collectListIdsNeedingMirrorFromSummaries, enqueueListMirrorJobs } from '@/lib/data/listMirror'
import { notifyNetworkOpSucceeded } from '@/lib/profileFetchConnectivityBridge'
import {
  clearSyncQueueForList,
  enqueueSyncQueueRecord,
  listQueueParent,
  newBatchEntityId,
  userQueueParent,
} from '@/lib/data/syncQueue'
import { isoNow, syncFieldsForLocalInsert } from '@/lib/data/base_sync_fields'
import {
  isLikelyConnectivityError,
  resolveServerWorkOutcomeFromResult,
  resolveServerWorkOutcomeFromThrown,
  type ServerWorkOutcome,
} from '@/lib/connectivityErrors'
import type { Database, Json, ListWithRole, ListUserSumScope } from '@/lib/supabase/types'
import { normalizeItemCategory } from '@/lib/supabase/types'
import type { RealtimeChannel } from '@supabase/supabase-js'
import Dexie from 'dexie'

const supabase = createClient()

const FETCH_TIMEOUT_MS = 10_000
const SAVE_TIMEOUT_MS = 10_000
type UserListsRpcRow = Database['public']['Functions']['get_user_lists']['Returns'][number]

function coalesceListUserSumScope(raw: unknown): ListUserSumScope {
  if (raw === 'all' || raw === 'active' || raw === 'archived' || raw === 'none') return raw
  return 'none'
}

function extractListRowFields(list: ListWithRole) {
  const {
    role,
    userArchived,
    memberCount,
    activeItemCount,
    archivedItemCount,
    sumScope,
    ownerNickname,
    label,
    ...listFields
  } = list
  void role
  void userArchived
  void memberCount
  void activeItemCount
  void archivedItemCount
  void sumScope
  void ownerNickname
  void label
  return listFields
}

async function softDeleteListInDexie(
  userId: string | null,
  listId: string,
  options?: { queueServerDelete?: boolean; leaveRpc?: boolean },
) {
  if (!userId) return
  await clearSyncQueueForList(listId)
  const nowMs = Date.now()
  const queueServerDelete = options?.queueServerDelete !== false
  const leaveRpc = options?.leaveRpc === true
  await db.transaction(
    'rw',
    [db.lists, db.items, db.members, db.item_member_state, db.list_users, db.sync_queue],
    async () => {
      await db.lists.update(listId, { deleted_at: isoNow(), cached_at: nowMs })
      const listUser = await db.list_users.where('[list_id+user_id]').equals([listId, userId]).first()
      if (listUser) await db.list_users.delete(listUser.id)
      const [items, members, states] = await Promise.all([
        db.items.where('list_id').equals(listId).toArray(),
        db.members.where('list_id').equals(listId).toArray(),
        db.item_member_state.where('[list_id+item_id]').between([listId, Dexie.minKey], [listId, Dexie.maxKey]).toArray(),
      ])
      for (const item of items) await db.items.update(item.id, { deleted_at: isoNow() })
      for (const member of members) await db.members.update(member.id, { deleted_at: isoNow() })
      for (const state of states) await db.item_member_state.update(state.id, { deleted_at: isoNow() })
      if (leaveRpc) {
        await enqueueSyncQueueRecord({
          entity: 'list',
          entity_id: newBatchEntityId(),
          kind: 'rpc',
          payload: { method: 'leaveList', list_id: listId, user_id: userId },
          ...userQueueParent(userId),
          status: 'queued',
        })
      } else if (queueServerDelete) {
        await enqueueSyncQueueRecord({
          entity: 'list',
          entity_id: listId,
          kind: 'delete',
          payload: { id: listId },
          ...listQueueParent(listId),
          status: 'queued',
        })
      }
    },
  )
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
  const dexieLists = useListsQuery(userId)
  useEffect(() => {
    reportServerDexieParityDiagnostics()
  }, [])

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

  useEffect(() => {
    if (!userId) return
    if (dexieLists === undefined) return
    setLists(dexieLists)
    setLoading(dexieLists.length === 0 && !hasCompletedInitialFetch)
    hasInitialDataRef.current = dexieLists.length > 0
  }, [dexieLists, hasCompletedInitialFetch, userId])

  const trackSaveOperation = async <T>(operation: PromiseLike<T>): Promise<T> => {
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
    const nowMs = Date.now()
    const orderedIds = orderedLists.map((list) => list.id)
    appendMutationDiagnostic(
      `[mutation:list.reorder.queue] userId=${user.id} count=${orderedIds.length} head=${orderedIds.slice(0, 5).join(',')} tail=${orderedIds.slice(-5).join(',')}`,
    )
    await db.transaction('rw', db.list_users, db.sync_queue, async () => {
      for (const [index, list] of orderedLists.entries()) {
        const row = await db.list_users.where('[list_id+user_id]').equals([list.id, user.id]).first()
        if (row) await db.list_users.update(row.id, { sort_order: index })
      }
      await enqueueSyncQueueRecord({
        entity: 'list',
        entity_id: newBatchEntityId(),
        kind: 'rpc',
        payload: {
          method: 'reorderListUsers',
          user_id: user.id,
          list_ids: orderedIds,
        },
        ...userQueueParent(user.id),
        status: 'queued',
      })
    })
    return null
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
    appendMutationDiagnostic(
      `[fetchLists.debug] start userId=${userId ?? 'null'} staleCheck=${staleCheck == null ? 'null' : String(staleCheck)} mutationVersion=${mutationVersionRef.current}`,
    )

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
      appendMutationDiagnostic(`[fetchLists.debug] rpc rows=${Array.isArray(data) ? data.length : 0}`)

      if (rpcError) throw rpcError

      if (staleCheck != null && staleCheck !== mutationVersionRef.current) {
        staleDiscarded = true
        appendMutationDiagnostic(
          `[fetchLists.debug] stale-discard captured=${staleCheck} current=${mutationVersionRef.current}`,
        )
        serverOutcome = 'success'
        return
      }

      const rawRows = (data || []) as UserListsRpcRow[]
      const mirrorListIds = await collectListIdsNeedingMirrorFromSummaries(rawRows)
      const listsData: ListWithRole[] = rawRows.map((item) => ({
        id: item.id,
        name: item.name,
        owner_id: item.owner_id,
        visibility: item.visibility,
        archived: item.archived,
        comment: item.comment ?? null,
        category_names: null,
        category_order: null,
        join_token: null,
        join_role_granted: 'editor',
        join_expires_at: null,
        join_revoked_at: null,
        join_use_count: 0,
        client_created_at: item.client_created_at,
        server_created_at: item.server_created_at,
        deleted_at: item.deleted_at ?? null,
        version: item.version ?? 1,
        last_synced_at: item.last_synced_at ?? null,
        updated_at: item.updated_at,
        role: item.role,
        userArchived: item.userArchived,
        sort_order: item.sort_order ?? null,
        memberCount: item.memberCount,
        activeItemCount: item.activeItemCount,
        archivedItemCount: item.archivedItemCount ?? 0,
        sumScope: coalesceListUserSumScope(item.sumScope),
        ownerNickname: item.ownerNickname,
        label: item.label ?? '',
      }))
      appendMutationDiagnostic(`[fetchLists.debug] apply rows=${listsData.length}`)

      setLists(listsData)
      setCachedLists(userId, listsData)
      await upsertListsSummaryFromServer(userId, rawRows)
      if (mirrorListIds.length > 0) {
        void enqueueListMirrorJobs(mirrorListIds)
      }
      appendMutationDiagnostic(`[fetchLists.debug] dexie-upsert rows=${listsData.length}`)
      hasInitialDataRef.current = true
      setFetchTimedOut(false)
      listCount = listsData.length
      notifyNetworkOpSucceeded('fetchLists')
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
        appVersion: APP_VERSION,
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
    // Do not write lists back into Dexie from this effect.
    // lists state is itself sourced from Dexie (useLiveQuery), so writing here creates
    // a feedback loop (especially with cachedAt updates) and can spam diagnostics.
  }, [userId, lists])

  // Real-time subscriptions
  useEffect(() => {
    if (!userId) return

    const scheduleRealtimeFetch = (delayMs: number, consumePending = false) => {
      if (realtimeScheduleCaptureVersionRef.current === null) {
        realtimeScheduleCaptureVersionRef.current = mutationVersionRef.current
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
          markOnlineRecovered('realtime-subscribed-lists')
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
  }, [fetchLists, markOnlineRecovered, userId])

  const createList = async (name: string, label?: string) => {
    if (!user) return { error: new Error('Not authenticated') }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
    appendMutationDiagnostic(`[mutation:list.create] local:start name="${name}"`)
    const listId = crypto.randomUUID()
    const now = new Date().toISOString()
    const sync = syncFieldsForLocalInsert()
    const optimisticList: ListWithRole = {
      id: listId,
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
      ...sync,
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
    await db.transaction('rw', db.lists, db.list_users, db.sync_queue, async () => {
      await db.lists.put({
        ...extractListRowFields(optimisticList),
        cached_at: Date.now(),
        app_version: APP_VERSION,
      })
      await db.list_users.put({
        id: crypto.randomUUID(),
        list_id: listId,
        user_id: user.id,
        role: 'owner',
        archived: false,
        sort_order: null,
        ...syncFieldsForLocalInsert(),
        member_filter: 'all',
        item_text_width: 'auto',
        label: label || '',
        last_viewed_members: null,
        show_targets: false,
        item_name_font_step: 3,
        sum_scope: 'none',
      })
      await enqueueSyncQueueRecord({
        entity: 'list',
        entity_id: listId,
        kind: 'create',
        payload: { id: listId, name, label: label || '' },
        ...listQueueParent(listId),
        status: 'queued',
      })
    })
    appendMutationDiagnostic(`[mutation:list.create] local:queued listId=${listId} server:queued`)
    markOnlineRecovered()
    return { data: { id: listId }, error: null }
    } finally {
      mutationGate.end()
    }
  }

  const updateList = async (listId: string, updates: { name?: string; archived?: boolean; comment?: string | null; category_names?: string | null; category_order?: string | null }) => {
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
      appendMutationDiagnostic(`[mutation:list.update] local:start listId=${listId}`)
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      setLists(prev => prev.map(list =>
        list.id === listId ? { ...list, ...updates } : list
      ))
      const nowMs = Date.now()
      await db.transaction('rw', db.lists, db.sync_queue, async () => {
        await db.lists.update(listId, { ...updates, cached_at: nowMs })
        await enqueueSyncQueueRecord({
          entity: 'list',
          entity_id: listId,
          kind: 'patch',
          payload: { id: listId, ...updates },
          ...listQueueParent(listId),
          status: 'queued',
        })
      })
      appendMutationDiagnostic(`[mutation:list.update] local:queued listId=${listId} server:queued`)

      markOnlineRecovered()
      return { error: null }
    } finally {
      mutationGate.end()
    }
  }

  const deleteList = async (listId: string) => {
    appendMutationDiagnostic(`[mutation:list.delete] local:start listId=${listId}`)
    if (!tryBeginMutation()) {
      appendMutationDiagnostic(`[mutation:list.delete] local:blocked reason=gate listId=${listId}`)
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      await softDeleteListInDexie(userId, listId)
      setLists(prev => prev.filter(list => list.id !== listId))
      removeCachedList(userId, listId)
      markOnlineRecovered()
      appendMutationDiagnostic(`[mutation:list.delete] local:queued-soft-delete listId=${listId} server:queued`)
      return { error: null }
    } finally {
      mutationGate.end()
    }
  }

  const updateUserListState = async (listId: string, updates: { archived?: boolean; sort_order?: number }) => {
    if (!user) return { error: new Error('Not authenticated') }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
    appendMutationDiagnostic(`[mutation:list.user_state] local:start listId=${listId}`)
    const previousLists = lists
    const nextLists = updates.archived !== undefined
      ? moveListBetweenSections(lists, listId, updates.archived)
      : lists.map(list =>
          list.id === listId ? { ...list, userArchived: updates.archived ?? list.userArchived } : list
        )

    mutationVersionRef.current += 1
    skipRealtimeUntilRef.current = Date.now() + 2000
    setLists(nextLists)
    const nowMs = Date.now()
    await db.transaction('rw', db.list_users, db.sync_queue, async () => {
      const row = await db.list_users.where('[list_id+user_id]').equals([listId, user.id]).first()
      if (row) await db.list_users.update(row.id, {
        ...(updates.archived !== undefined ? { archived: updates.archived } : {}),
        ...(updates.sort_order !== undefined ? { sort_order: updates.sort_order } : {}),
      })
      await enqueueSyncQueueRecord({
        entity: 'list',
        entity_id: newBatchEntityId(),
        kind: 'rpc',
        payload: {
          method: 'patchListUser',
          id: listId,
          user_id: user.id,
          ...(updates.archived !== undefined ? { archived: updates.archived } : {}),
          ...(updates.sort_order !== undefined ? { sort_order: updates.sort_order } : {}),
        },
        ...listQueueParent(listId),
        status: 'queued',
      })
    })
    appendMutationDiagnostic(`[mutation:list.user_state] local:queued listId=${listId} server:queued`)

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
    if (!user) return { data: null, error: new Error('Not authenticated') }
    if (!tryBeginMutation()) {
      return { data: null, error: new Error(blockedMutationMessage()) }
    }
    try {
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      await enqueueSyncQueueRecord({
        entity: 'list',
        entity_id: newBatchEntityId(),
        kind: 'rpc',
        payload: { method: 'joinListByToken', token, user_id: user.id },
        ...userQueueParent(user.id),
        status: 'queued',
      })
      markOnlineRecovered()
      void fetchLists()
      window.setTimeout(() => void fetchLists(), 700)
      window.setTimeout(() => void fetchLists(), 2200)
      return { data: null, error: null }
    } finally {
      mutationGate.end()
    }
  }

  const leaveList = async (listId: string) => {
    if (!user) return { error: new Error('Not authenticated') }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      setLists(prev => prev.filter(list => list.id !== listId))
      removeCachedList(userId, listId)
      await softDeleteListInDexie(userId, listId, { queueServerDelete: false, leaveRpc: true })
      markOnlineRecovered()
      return { error: null }
    } finally {
      mutationGate.end()
    }
  }

  const duplicateList = async (listId: string, newName: string, label?: string) => {
    if (!user) return { error: new Error('Not authenticated') }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
    const sourceList = lists.find(l => l.id === listId)
    const duplicateId = crypto.randomUUID()
    const now = new Date().toISOString()
    const sync = syncFieldsForLocalInsert()
    const optimisticList: ListWithRole = {
      id: duplicateId,
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
      ...sync,
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

    try {
      await db.transaction('rw', db.lists, db.list_users, db.sync_queue, async () => {
        await db.lists.put({
          ...extractListRowFields(optimisticList),
          cached_at: Date.now(),
          app_version: APP_VERSION,
        })
        await db.list_users.put({
          id: crypto.randomUUID(),
          list_id: duplicateId,
          user_id: user.id,
          role: 'owner',
          archived: false,
          sort_order: null,
          ...syncFieldsForLocalInsert(),
          member_filter: 'all',
          item_text_width: 'auto',
          label: label || '',
          last_viewed_members: null,
          show_targets: false,
          item_name_font_step: 3,
          sum_scope: 'none',
        })
        await enqueueSyncQueueRecord({
          entity: 'list',
          entity_id: newBatchEntityId(),
          kind: 'rpc',
          payload: {
            method: 'duplicateList',
            user_id: user.id,
            source_list_id: listId,
            duplicate_id: duplicateId,
            new_name: newName,
            label: label || '',
          },
          ...listQueueParent(duplicateId),
          status: 'queued',
        })
      })
    } catch (e) {
      setLists(prev => prev.filter(list => list.id !== duplicateId))
      return { error: e instanceof Error ? e : new Error('Failed to queue duplicate list') }
    }

    markOnlineRecovered()
    return { data: optimisticList, error: null }
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
    const importedId = crypto.randomUUID()
    const now = new Date().toISOString()
    const sync = syncFieldsForLocalInsert()
    const itemCount = Array.isArray(rows) ? rows.length : 0
    const optimisticList: ListWithRole = {
      id: importedId,
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
      ...sync,
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

    try {
      await db.transaction('rw', db.lists, db.list_users, db.sync_queue, async () => {
        await db.lists.put({
          ...extractListRowFields(optimisticList),
          cached_at: Date.now(),
          app_version: APP_VERSION,
        })
        await db.list_users.put({
          id: crypto.randomUUID(),
          list_id: importedId,
          user_id: user.id,
          role: 'owner',
          archived: false,
          sort_order: null,
          ...syncFieldsForLocalInsert(),
          member_filter: 'all',
          item_text_width: 'auto',
          label: label || '',
          last_viewed_members: null,
          show_targets: false,
          item_name_font_step: 3,
          sum_scope: 'none',
        })
        await enqueueSyncQueueRecord({
          entity: 'list',
          entity_id: newBatchEntityId(),
          kind: 'rpc',
          payload: {
            method: 'importList',
            user_id: user.id,
            imported_id: importedId,
            p_name: name,
            p_label: label || '',
            p_category_names: categoryNames || '{}',
            p_rows: (rows ?? []) as unknown as Json,
            p_has_targets: hasTargets || false,
          },
          ...listQueueParent(importedId),
          status: 'queued',
        })
      })
    } catch (e) {
      setLists(prev => prev.filter(list => list.id !== importedId))
      return { error: e instanceof Error ? e : new Error('Failed to queue import') }
    }

    markOnlineRecovered()
    void fetchLists()
    window.setTimeout(() => void fetchLists(), 800)
    window.setTimeout(() => void fetchLists(), 2500)

    return { data: optimisticList, error: null }
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

    const nowMs = Date.now()
    await db.transaction('rw', db.list_users, db.sync_queue, async () => {
      const row = await db.list_users.where('[list_id+user_id]').equals([listId, user!.id]).first()
      if (row) await db.list_users.update(row.id, { label })
      await enqueueSyncQueueRecord({
        entity: 'list',
        entity_id: newBatchEntityId(),
        kind: 'rpc',
        payload: { method: 'patchListUser', id: listId, user_id: user!.id, label },
        ...listQueueParent(listId),
        status: 'queued',
      })
    })
    appendMutationDiagnostic(`[mutation:list.label] local:queued listId=${listId} label="${label}" server:queued`)
    markOnlineRecovered()
    return { error: null }
  }

  const updateListLabel = async (listId: string, label: string) => {
    if (!user) return { error: new Error('Not authenticated') }
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
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
      const nextLabelById = new Map(changes.map((c) => [c.listId, c.label]))
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      setLists((prev) => prev.map((list) => (
        nextLabelById.has(list.id) ? { ...list, label: nextLabelById.get(list.id) ?? '' } : list
      )))

      const nowMs = Date.now()
      await db.transaction('rw', db.list_users, db.sync_queue, async () => {
        for (const { listId, label } of changes) {
          const row = await db.list_users.where('[list_id+user_id]').equals([listId, user.id]).first()
          if (row) await db.list_users.update(row.id, { label })
        }
        await enqueueSyncQueueRecord({
          entity: 'list',
          entity_id: newBatchEntityId(),
          kind: 'rpc',
          payload: {
            method: 'bulkPatchListLabels',
            updates: changes.map((c) => ({ list_id: c.listId, label: c.label })),
          },
          ...userQueueParent(user.id),
          status: 'queued',
        })
      })
      appendMutationDiagnostic(
        `[mutation:list.label.batch] local:queued count=${changes.length} server:queued`,
      )
      markOnlineRecovered()
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
    appendMutationDiagnostic(`[mutation:list.reorder] local:start count=${reorderedLists.length}`)
    if (!user) {
      appendMutationDiagnostic('[mutation:list.reorder] local:blocked reason=no-user')
      return
    }
    if (!tryBeginMutation()) {
      appendMutationDiagnostic('[mutation:list.reorder] local:blocked reason=gate')
      return
    }
    try {
    mutationVersionRef.current += 1
    skipRealtimeUntilRef.current = Date.now() + 2000
    setLists(reorderedLists)
    await persistListOrder(reorderedLists)
    appendMutationDiagnostic('[mutation:list.reorder] local:queued server:queued')
    markOnlineRecovered()
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
