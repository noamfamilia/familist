'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { createUserMutationGate } from '@/lib/userMutationGate'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { getActiveCacheUserId, getCachedLists, setCachedLists, setCachedList, removeCachedList } from '@/lib/cache'
import { db } from '@/lib/db'
import {
  subscribeListsCatalogL2Bridge,
  useListsCatalogStore,
  warmListsCatalog,
} from '@/stores/listsCatalogStore'
import { APP_VERSION } from '@/lib/appVersion'
import { perfLog } from '@/lib/startupPerfLog'
import { logServerRoundTrip } from '@/lib/serverActionLog'
import { appendMutationDiagnostic } from '@/lib/offlineNavDiagnostics'
import { reportServerDexieParityDiagnostics, upsertListsSummaryFromServer } from '@/lib/data/serverDexieParity'
import {
  catalogMutationVersionRef,
  catalogRealtimeScheduleCaptureVersionRef,
  catalogSkipRealtimeUntilRef,
  registerListsCatalogFetchHandler,
  requestListsCatalogRealtimeFlush,
} from '@/lib/data/listsCatalogRealtimeBridge'
import { enqueueListMirrorJobs } from '@/lib/data/listMirror'
import { notifyNetworkOpSucceeded } from '@/lib/profileFetchConnectivityBridge'
import {
  clearSyncQueueForList,
  enqueueSyncQueueRecord,
  listQueueParent,
  newBatchEntityId,
  userQueueParent,
} from '@/lib/data/syncQueue'
import { isoNow, syncFieldsForLocalInsert } from '@/lib/data/base_sync_fields'
import { validateImportSheetRowTextsUnique } from '@/lib/data/localItemTextUniqueness'
import { validateListNameForOwner } from '@/lib/data/localListMemberNameUniqueness'
import { withDeletionNameSuffix } from '@/lib/data/deletionRename'
import {
  isLikelyConnectivityError,
  resolveServerWorkOutcomeFromResult,
  resolveServerWorkOutcomeFromThrown,
  type ServerWorkOutcome,
} from '@/lib/connectivityErrors'
import type { Database, Json, ListWithRole, ListUserSumScope } from '@/lib/supabase/types'
import { normalizeItemCategory } from '@/lib/supabase/types'
import Dexie from 'dexie'
import {
  listCatalogSortOrderForVisualIndex,
  nextListCatalogSortOrderFromMembershipRows,
} from '@/lib/data/listCatalogSort'

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
    last_viewed,
    pending_items,
    sync_error,
    sync_error_message,
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
  void last_viewed
  void pending_items
  void sync_error
  void sync_error_message
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
      const t = isoNow()
      const listRow = await db.lists.get(listId)
      const renamedListName = withDeletionNameSuffix(listRow?.name ?? '')
      await db.lists.update(listId, { name: renamedListName, deleted_at: t, cached_at: nowMs })
      const listUser = await db.list_users.where('[list_id+user_id]').equals([listId, userId]).first()
      if (listUser) await db.list_users.delete(listUser.id)
      const [items, members, states] = await Promise.all([
        db.items.where('list_id').equals(listId).toArray(),
        db.members.where('list_id').equals(listId).toArray(),
        db.item_member_state.where('[list_id+item_id]').between([listId, Dexie.minKey], [listId, Dexie.maxKey]).toArray(),
      ])
      for (const item of items) {
        await db.items.update(item.id, {
          text: withDeletionNameSuffix(item.text ?? ''),
          deleted_at: t,
          updated_at: t,
        })
      }
      for (const member of members) {
        await db.members.update(member.id, {
          name: withDeletionNameSuffix(member.name ?? ''),
          deleted_at: t,
          updated_at: t,
        })
      }
      for (const state of states) await db.item_member_state.update(state.id, { deleted_at: t })
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
  const lists = useListsCatalogStore(useShallow((s) => s.lists))
  const listsCatalogStatus = useListsCatalogStore((s) => s.listsCatalogStatus)
  const [isFetching, setIsFetching] = useState(true)
  const [hasCompletedInitialFetch, setHasCompletedInitialFetch] = useState(false)
  const [fetchTimedOut, setFetchTimedOut] = useState(false)
  const [saveTimedOut, setSaveTimedOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchingRef = useRef(false)
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingSaveOpsRef = useRef(0)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const hasInitialDataRef = useRef(false)
  const userId = user?.id ?? (authLoading ? bootstrapUserId : null)
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
    swControlled,
    offlineAssetsReady,
  } = useConnectivity()
  const mutationGate = useMemo(() => createUserMutationGate(), [])
  const tryBeginMutation = useCallback((): boolean => {
    const browserOffline = typeof navigator !== 'undefined' && !navigator.onLine
    const offlineCatalogOk = browserOffline && swControlled && offlineAssetsReady
    if (!canMutateNow() && !offlineCatalogOk) return false
    return mutationGate.tryBegin()
  }, [canMutateNow, mutationGate, offlineAssetsReady, swControlled])

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

    if (!userId) {
      useListsCatalogStore.getState().clearListsCatalog()
      setHasCompletedInitialFetch(false)
      hasInitialDataRef.current = false
      perfLog('localStorage read end', { durationMs: Math.round(performance.now() - lsT0), note: 'no user' })
      return
    }

    const cachedLists = getCachedLists(userId)?.lists || []
    perfLog('localStorage read end', {
      durationMs: Math.round(performance.now() - lsT0),
      bytesOrItemCount: cachedLists.length,
      approxStorageChars,
    })
    useListsCatalogStore.getState().beginHomeSession(userId, cachedLists.length > 0 ? cachedLists : null)
    setHasCompletedInitialFetch(false)
    hasInitialDataRef.current = cachedLists.length > 0
  }, [userId])

  useEffect(() => {
    if (!userId) return
    void warmListsCatalog(userId)
    return subscribeListsCatalogL2Bridge(userId)
  }, [userId])

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
      const n = orderedLists.length
      for (const [index, list] of orderedLists.entries()) {
        const row = await db.list_users.where('[list_id+user_id]').equals([list.id, user.id]).first()
        if (row) await db.list_users.update(row.id, { sort_order: listCatalogSortOrderForVisualIndex(index, n) })
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
      `[fetchLists.debug] start userId=${userId ?? 'null'} staleCheck=${staleCheck == null ? 'null' : String(staleCheck)} mutationVersion=${catalogMutationVersionRef.current}`,
    )

    if (!userId) {
      perfLog('fetchLists start', { note: 'no user' })
      useListsCatalogStore.getState().clearListsCatalog()
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

    setError(null)

    beginServerWork()
    let serverOutcome: ServerWorkOutcome = 'success'
    const listsRpcT0 = performance.now()
    try {
      // Catalog: lists + list_users (counts come from Dexie liveQuery after mirror fills items/members)
      const { data, error: rpcError } = await supabase.rpc('get_user_lists')
      appendMutationDiagnostic(`[fetchLists.debug] rpc rows=${Array.isArray(data) ? data.length : 0}`)

      if (rpcError) throw rpcError

      if (staleCheck != null && staleCheck !== catalogMutationVersionRef.current) {
        staleDiscarded = true
        appendMutationDiagnostic(
          `[fetchLists.debug] stale-discard captured=${staleCheck} current=${catalogMutationVersionRef.current}`,
        )
        const n = Array.isArray(data) ? data.length : 0
        logServerRoundTrip({
          description: `Fetched list catalog (${n} lists)`,
          ok: true,
          durationMs: performance.now() - listsRpcT0,
          respondsTo: 'Home lists refresh (superseded by newer local edits)',
        })
        serverOutcome = 'success'
        return
      }

      const rawRows = (data || []) as UserListsRpcRow[]
      const mirrorListIds = rawRows.map((r) => r.id).filter((id): id is string => Boolean(id && id.length > 0))
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
        last_content_update: item.last_content_update ?? item.updated_at,
        role: item.role,
        userArchived: item.userArchived,
        sort_order: item.sort_order ?? null,
        last_viewed: item.last_viewed ?? null,
        memberCount: 0,
        activeItemCount: 0,
        archivedItemCount: 0,
        sumScope: coalesceListUserSumScope(item.sumScope),
        ownerNickname: item.ownerNickname,
        label: item.label ?? '',
      }))
      appendMutationDiagnostic(`[fetchLists.debug] apply rows=${listsData.length}`)

      setCachedLists(userId, listsData)
      await upsertListsSummaryFromServer(userId, rawRows)
      void enqueueListMirrorJobs(mirrorListIds)
      appendMutationDiagnostic(`[fetchLists.debug] dexie-upsert rows=${listsData.length}`)
      hasInitialDataRef.current = true
      setFetchTimedOut(false)
      listCount = listsData.length
      notifyNetworkOpSucceeded('fetchLists')
      markOnlineRecovered('fetchLists-success')
      serverOutcome = 'success'
      logServerRoundTrip({
        description: `Fetched list catalog (${listsData.length} lists)`,
        ok: true,
        durationMs: performance.now() - listsRpcT0,
        respondsTo: 'Home lists refresh',
      })
    } catch (err) {
      serverOutcome = isLikelyConnectivityError(err) ? 'connectivity_failure' : 'application_error'
      if (serverOutcome === 'connectivity_failure') {
        enterOffline('fetchLists-connectivity-error')
      }
      fetchErr = (err as Error).message
      setError((err as Error).message)
      logServerRoundTrip({
        description: 'Fetched list catalog',
        ok: false,
        durationMs: performance.now() - listsRpcT0,
        respondsTo: 'Home lists refresh',
        failure: err,
      })
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
      setIsFetching(false)
      setHasCompletedInitialFetch(true)
      fetchingRef.current = false
      if (staleCheck != null) {
        catalogRealtimeScheduleCaptureVersionRef.current = null
      }
      if (staleDiscarded) {
        queueMicrotask(() => {
          requestListsCatalogRealtimeFlush(0)
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

  useEffect(() => {
    if (!userId) {
      registerListsCatalogFetchHandler(null)
      return
    }
    registerListsCatalogFetchHandler((opts) => {
      void fetchLists(opts)
    })
    return () => {
      registerListsCatalogFetchHandler(null)
    }
  }, [fetchLists, userId])

  const createList = async (name: string, label?: string) => {
    if (!user) return { error: new Error('Not authenticated') }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
    const trimmedName = name.trim()
    if (!trimmedName) {
      return { error: new Error('List name is required') }
    }
    const nameDup = await validateListNameForOwner(user.id, trimmedName)
    if (!nameDup.ok) {
      return { error: new Error(nameDup.message) }
    }
    appendMutationDiagnostic(`[mutation:list.create] local:start name="${trimmedName}"`)
    const listId = crypto.randomUUID()
    const now = new Date().toISOString()
    const sync = syncFieldsForLocalInsert()
    const cat = useListsCatalogStore.getState()
    const existingMemberships = await db.list_users.where('user_id').equals(user.id).toArray()
    const nextSort = nextListCatalogSortOrderFromMembershipRows(existingMemberships, listId)
    const optimisticList: ListWithRole = {
      id: listId,
      name: trimmedName,
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
      last_content_update: now,
      role: 'owner',
      userArchived: false,
      memberCount: 0,
      activeItemCount: 0,
      archivedItemCount: 0,
      sumScope: 'none',
      label: label || '',
      last_viewed: now,
      sort_order: nextSort,
    }

    catalogMutationVersionRef.current += 1
    catalogSkipRealtimeUntilRef.current = Date.now() + 2000
    cat.beginLocalCatalogPersistence()
    try {
      cat.setCatalogLists((prev) => [optimisticList, ...prev])
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
          sort_order: nextSort,
          ...syncFieldsForLocalInsert(),
          member_filter: 'all',
          item_text_width: 'auto',
          label: label || '',
          last_viewed_members: null,
          last_viewed: now,
          show_targets: false,
          item_name_font_step: 3,
          sum_scope: 'none',
          sync_error: false,
        })
        await enqueueSyncQueueRecord({
          entity: 'list',
          entity_id: listId,
          kind: 'create',
          payload: {
            id: listId,
            name: trimmedName,
            label: label || '',
            client_created_at: sync.client_created_at,
          },
          ...listQueueParent(listId),
          status: 'queued',
        })
      })
    } finally {
      cat.endLocalCatalogPersistence()
    }
    appendMutationDiagnostic(`[mutation:list.create] local:queued listId=${listId} server:queued`)
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
      let effectiveUpdates = updates
      if (updates.comment !== undefined) {
        effectiveUpdates = {
          ...effectiveUpdates,
          comment: updates.comment === '' || updates.comment == null ? null : updates.comment,
        }
      }
      if (updates.name !== undefined) {
        const listRow = await db.lists.get(listId)
        if (!listRow) {
          return { error: new Error('List not found locally') }
        }
        const trimmedListName = updates.name.trim()
        if (!trimmedListName) {
          return { error: new Error('List name cannot be empty') }
        }
        const nameDup = await validateListNameForOwner(listRow.owner_id, trimmedListName, listId)
        if (!nameDup.ok) {
          return { error: new Error(nameDup.message) }
        }
        effectiveUpdates = { ...updates, name: trimmedListName }
      }
      catalogMutationVersionRef.current += 1
      catalogSkipRealtimeUntilRef.current = Date.now() + 2000
      const cat = useListsCatalogStore.getState()
      cat.beginLocalCatalogPersistence()
      try {
        cat.setCatalogLists((prev) => prev.map((list) => (list.id === listId ? { ...list, ...effectiveUpdates } : list)))
        const nowMs = Date.now()
        await db.transaction('rw', db.lists, db.list_users, db.sync_queue, async () => {
          await db.lists.update(listId, { ...effectiveUpdates, cached_at: nowMs })
          await enqueueSyncQueueRecord({
            entity: 'list',
            entity_id: listId,
            kind: 'patch',
            payload: { id: listId, ...effectiveUpdates },
            ...listQueueParent(listId),
            status: 'queued',
          })
        })
      } finally {
        cat.endLocalCatalogPersistence()
      }
      appendMutationDiagnostic(`[mutation:list.update] local:queued listId=${listId} server:queued`)

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
      catalogMutationVersionRef.current += 1
      catalogSkipRealtimeUntilRef.current = Date.now() + 2000
      const cat = useListsCatalogStore.getState()
      cat.beginLocalCatalogPersistence()
      try {
        await softDeleteListInDexie(userId, listId)
        cat.setCatalogLists((prev) => prev.filter((list) => list.id !== listId))
      } finally {
        cat.endLocalCatalogPersistence()
      }
      removeCachedList(userId, listId)
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
    const cat = useListsCatalogStore.getState()
    const previousLists = cat.lists
    const nextLists =
      updates.archived !== undefined
        ? moveListBetweenSections(cat.lists, listId, updates.archived)
        : cat.lists.map((list) =>
            list.id === listId ? { ...list, userArchived: updates.archived ?? list.userArchived } : list,
          )

    catalogMutationVersionRef.current += 1
    catalogSkipRealtimeUntilRef.current = Date.now() + 2000
    cat.beginLocalCatalogPersistence()
    try {
      cat.setCatalogLists(nextLists)
      try {
        await db.transaction('rw', db.list_users, db.sync_queue, async () => {
          const queueTs = Date.now()
          const row = await db.list_users.where('[list_id+user_id]').equals([listId, user.id]).first()
          if (row) {
            await db.list_users.update(row.id, {
              ...(updates.archived !== undefined ? { archived: updates.archived } : {}),
              ...(updates.sort_order !== undefined ? { sort_order: updates.sort_order } : {}),
            })
          }
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
            updated_at: queueTs,
          })

          // Archive/unarchive reorders the catalog; apply every membership `sort_order` in the same txn
          // so Dexie liveQuery never emits with stale sort_order (was jumping restored list to the end).
          if (updates.archived !== undefined) {
            const orderedIds = nextLists.map((l) => l.id)
            appendMutationDiagnostic(
              `[mutation:list.user_state.reorder] userId=${user.id} count=${orderedIds.length} head=${orderedIds.slice(0, 5).join(',')}`,
            )
            const n = nextLists.length
            for (const [index, list] of nextLists.entries()) {
              const lu = await db.list_users.where('[list_id+user_id]').equals([list.id, user.id]).first()
              if (lu) await db.list_users.update(lu.id, { sort_order: listCatalogSortOrderForVisualIndex(index, n) })
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
              updated_at: queueTs + 1,
            })
          }
        })
      } catch (e) {
        cat.setCatalogLists(previousLists)
        return { error: e instanceof Error ? e : new Error('Failed to update list state') }
      }
      appendMutationDiagnostic(`[mutation:list.user_state] local:queued listId=${listId} server:queued`)
    } finally {
      cat.endLocalCatalogPersistence()
    }

    return { error: null }
    } finally {
      mutationGate.end()
    }
  }

  const joinListByToken = useCallback(
    async (token: string) => {
      const tokenLen = token?.length ?? 0
      if (authLoading) {
        appendMutationDiagnostic(
          `[invite] joinListByToken deferred reason=authLoading catalogUserId=${userId ?? 'null'} tokenLen=${tokenLen}`,
        )
        return { data: null, error: new Error('Session still loading'), joinedListName: null as string | null }
      }
      if (!user?.id) {
        appendMutationDiagnostic(
          `[invite] joinListByToken blocked reason=no_user_session authLoading=0 catalogUserId=${userId ?? 'null'} bootstrapUserId=${bootstrapUserId ?? 'null'} tokenLen=${tokenLen}`,
        )
        return { data: null, error: new Error('Not authenticated'), joinedListName: null as string | null }
      }
      if (!tryBeginMutation()) {
        const msg = blockedMutationMessage()
        appendMutationDiagnostic(
          `[invite] joinListByToken blocked reason=mutation_gate userId=${user.id} tokenLen=${tokenLen} msg=${msg}`,
        )
        return { data: null, error: new Error(msg), joinedListName: null as string | null }
      }
      try {
        if (canMutateNow()) {
          appendMutationDiagnostic(
            `[invite] joinListByToken rpc userId=${user.id} tokenLen=${tokenLen} catalogUserId=${userId ?? 'null'}`,
          )
          catalogMutationVersionRef.current += 1
          catalogSkipRealtimeUntilRef.current = Date.now() + 2000
          const { data: listIdRaw, error: rpcError } = await supabase.rpc('join_list_by_token', {
            p_token: token,
          } as never)
          if (rpcError) {
            appendMutationDiagnostic(
              `[invite] joinListByToken rpc_err userId=${user.id} tokenLen=${tokenLen} err=${rpcError.message}`,
            )
            return { data: null, error: new Error(rpcError.message), joinedListName: null as string | null }
          }
          const listId =
            typeof listIdRaw === 'string'
              ? listIdRaw
              : listIdRaw != null
                ? String(listIdRaw)
                : null
          if (!listId) {
            return {
              data: null,
              error: new Error('Join did not return a list id'),
              joinedListName: null as string | null,
            }
          }
          markOnlineRecovered()
          await fetchLists()
          const joined = useListsCatalogStore.getState().lists.find((l) => l.id === listId)
          appendMutationDiagnostic(
            `[invite] joinListByToken rpc_ok userId=${user.id} listId=${listId} name=${joined?.name ? '1' : '0'}`,
          )
          return { data: listId, error: null, joinedListName: joined?.name ?? null }
        }

        appendMutationDiagnostic(
          `[invite] joinListByToken blocked reason=not_online userId=${user.id} tokenLen=${tokenLen} catalogUserId=${userId ?? 'null'}`,
        )
        return {
          data: null,
          error: new Error(blockedMutationMessage()),
          joinedListName: null as string | null,
        }
      } catch (e) {
        appendMutationDiagnostic(
          `[invite] joinListByToken throw userId=${user.id} tokenLen=${tokenLen} err=${e instanceof Error ? e.message : String(e)}`,
        )
        return { data: null, error: e instanceof Error ? e : new Error(String(e)), joinedListName: null as string | null }
      } finally {
        mutationGate.end()
      }
    },
    [
      authLoading,
      user,
      userId,
      bootstrapUserId,
      tryBeginMutation,
      mutationGate,
      blockedMutationMessage,
      markOnlineRecovered,
      fetchLists,
      canMutateNow,
    ],
  )

  const leaveList = async (listId: string) => {
    if (!user) return { error: new Error('Not authenticated') }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
      catalogMutationVersionRef.current += 1
      catalogSkipRealtimeUntilRef.current = Date.now() + 2000
      const cat = useListsCatalogStore.getState()
      cat.beginLocalCatalogPersistence()
      try {
        cat.setCatalogLists((prev) => prev.filter((list) => list.id !== listId))
        removeCachedList(userId, listId)
        await softDeleteListInDexie(userId, listId, { queueServerDelete: false, leaveRpc: true })
      } finally {
        cat.endLocalCatalogPersistence()
      }
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
    const catDup0 = useListsCatalogStore.getState()
    const sourceList = catDup0.lists.find((l) => l.id === listId)
    const duplicateId = crypto.randomUUID()
    const now = new Date().toISOString()
    const sync = syncFieldsForLocalInsert()
    const existingMembershipsDup = await db.list_users.where('user_id').equals(user.id).toArray()
    const nextSortDup = nextListCatalogSortOrderFromMembershipRows(existingMembershipsDup, duplicateId)
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
      last_content_update: now,
      role: 'owner',
      userArchived: false,
      memberCount: sourceList?.memberCount ?? 0,
      activeItemCount: sourceList?.activeItemCount || 0,
      archivedItemCount: sourceList?.archivedItemCount ?? 0,
      sumScope: 'none',
      label: label || '',
      last_viewed: now,
      sort_order: nextSortDup,
    }

    catalogMutationVersionRef.current += 1
    catalogSkipRealtimeUntilRef.current = Date.now() + 2000
    const catDup = useListsCatalogStore.getState()
    catDup.beginLocalCatalogPersistence()
    try {
      catDup.setCatalogLists((prev) => [optimisticList, ...prev])
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
            sort_order: nextSortDup,
            ...syncFieldsForLocalInsert(),
            member_filter: 'all',
            item_text_width: 'auto',
            label: label || '',
            last_viewed_members: null,
            last_viewed: now,
            show_targets: false,
            item_name_font_step: 3,
            sum_scope: 'none',
            sync_error: false,
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
              client_created_at: sync.client_created_at,
            },
            ...listQueueParent(duplicateId),
            status: 'queued',
          })
        })
      } catch (e) {
        catDup.setCatalogLists((prev) => prev.filter((list) => list.id !== duplicateId))
        return { error: e instanceof Error ? e : new Error('Failed to queue duplicate list') }
      }
    } finally {
      catDup.endLocalCatalogPersistence()
    }

    return { data: optimisticList, error: null }
    } finally {
      mutationGate.end()
    }
  }

  const importList = async (name: string, label?: string, categoryNames?: string, rows?: Json, hasTargets?: boolean) => {
    if (!user) return { error: new Error('Not authenticated') }
    const importDup = validateImportSheetRowTextsUnique(rows)
    if (!importDup.ok) {
      return { error: new Error(importDup.message) }
    }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
    const importedId = crypto.randomUUID()
    const now = new Date().toISOString()
    const sync = syncFieldsForLocalInsert()
    const itemCount = Array.isArray(rows) ? rows.length : 0
    const existingMembershipsImp = await db.list_users.where('user_id').equals(user.id).toArray()
    const nextSortImp = nextListCatalogSortOrderFromMembershipRows(existingMembershipsImp, importedId)
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
      last_content_update: now,
      role: 'owner',
      userArchived: false,
      memberCount: hasTargets ? 1 : 0,
      activeItemCount: itemCount,
      archivedItemCount: 0,
      sumScope: 'none',
      label: label || '',
      last_viewed: now,
      sort_order: nextSortImp,
    }

    catalogMutationVersionRef.current += 1
    catalogSkipRealtimeUntilRef.current = Date.now() + 2000
    const catImp = useListsCatalogStore.getState()
    catImp.beginLocalCatalogPersistence()
    try {
      catImp.setCatalogLists((prev) => [optimisticList, ...prev])
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
            sort_order: nextSortImp,
            ...syncFieldsForLocalInsert(),
            member_filter: 'all',
            item_text_width: 'auto',
            label: label || '',
            last_viewed_members: null,
            last_viewed: now,
            show_targets: false,
            item_name_font_step: 3,
            sum_scope: 'none',
            sync_error: false,
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
              p_client_created_at: sync.client_created_at,
            },
            ...listQueueParent(importedId),
            status: 'queued',
          })
        })
      } catch (e) {
        catImp.setCatalogLists((prev) => prev.filter((list) => list.id !== importedId))
        return { error: e instanceof Error ? e : new Error('Failed to queue import') }
      }
    } finally {
      catImp.endLocalCatalogPersistence()
    }

    void fetchLists()
    window.setTimeout(() => void fetchLists(), 800)
    window.setTimeout(() => void fetchLists(), 2500)

    return { data: optimisticList, error: null }
    } finally {
      mutationGate.end()
    }
  }

  const persistListLabelOnly = async (listId: string, label: string) => {
    catalogMutationVersionRef.current += 1
    catalogSkipRealtimeUntilRef.current = Date.now() + 2000
    const catLbl = useListsCatalogStore.getState()
    catLbl.beginLocalCatalogPersistence()
    try {
      catLbl.setCatalogLists((prev) => prev.map((list) => (list.id === listId ? { ...list, label } : list)))

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
    } finally {
      catLbl.endLocalCatalogPersistence()
    }
    appendMutationDiagnostic(`[mutation:list.label] local:queued listId=${listId} label="${label}" server:queued`)
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
      catalogMutationVersionRef.current += 1
      catalogSkipRealtimeUntilRef.current = Date.now() + 2000
      const catBatch = useListsCatalogStore.getState()
      catBatch.beginLocalCatalogPersistence()
      try {
        catBatch.setCatalogLists((prev) =>
          prev.map((list) =>
            nextLabelById.has(list.id) ? { ...list, label: nextLabelById.get(list.id) ?? '' } : list,
          ),
        )

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
      } finally {
        catBatch.endLocalCatalogPersistence()
      }
      appendMutationDiagnostic(
        `[mutation:list.label.batch] local:queued count=${changes.length} server:queued`,
      )
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
    catalogMutationVersionRef.current += 1
    catalogSkipRealtimeUntilRef.current = Date.now() + 2000
    const catOrd = useListsCatalogStore.getState()
    catOrd.beginLocalCatalogPersistence()
    try {
      catOrd.setCatalogLists(reorderedLists)
      await persistListOrder(reorderedLists)
    } finally {
      catOrd.endLocalCatalogPersistence()
    }
    appendMutationDiagnostic('[mutation:list.reorder] local:queued server:queued')
    } finally {
      mutationGate.end()
    }
  }

  const loading = useMemo(
    () => Boolean(userId && lists.length === 0 && listsCatalogStatus !== 'ready' && !error),
    [userId, lists.length, listsCatalogStatus, error],
  )

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
