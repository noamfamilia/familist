'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createUserMutationGate } from '@/lib/userMutationGate'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { getActiveCacheUserId, getCachedLists, setCachedLists, setCachedList, removeCachedList } from '@/lib/cache'
import { resolveCatalogMutationUserId } from '@/lib/catalogMutationUserId'
import { db } from '@/lib/db'
import {
  bootstrapListsCatalogSession,
  subscribeListsCatalogL2Bridge,
  useListsCatalogStore,
  warmListsCatalog,
} from '@/stores/listsCatalogStore'
import { APP_VERSION } from '@/lib/appVersion'
import { logServerRoundTrip } from '@/lib/serverActionLog'
import { upsertListsSummaryFromServer } from '@/lib/data/serverDexieParity'
import {
  catalogMutationVersionRef,
  catalogRealtimeScheduleCaptureVersionRef,
  catalogSkipRealtimeUntilRef,
  registerListsCatalogFetchHandler,
  requestListsCatalogRealtimeFlush,
} from '@/lib/data/listsCatalogRealtimeBridge'
import { enqueueListMirrorJobs } from '@/lib/data/listMirror'
import { rpcGetUserLists } from '@/lib/data/inFlightServerReads'
import { reportConnectivityFailure } from '@/lib/connectivityFailureBridge'
import {
  canFetchFromServer,
  canFetchFromServerNow,
  captureReadFlightGeneration,
  shouldDiscardReadFlightResult,
} from '@/lib/data/serverReadPolicy'
import { isGuestId } from '@/lib/guestSession'
import { GUEST_JOIN_SHARE_BLOCKED_MSG } from '@/lib/sessionPolicy'
import {
  clearSyncQueueForList,
  enqueueSyncQueueRecord,
  listQueueParent,
  CATALOG_RPC_COALESCE_ENTITY,
  newBatchEntityId,
  patchListUserOutboxKey,
  reorderListUsersOutboxKey,
  userQueueParent,
} from '@/lib/data/syncQueue'
import {
  applyCoalescedLabelChanges,
  finalizeCoalescedLabelOutbound,
  hasProcessingLabelOutbound,
  LABEL_CHANGES_SYNC_WAIT_MSG,
  normalizeCatalogLabel,
  bulkPatchListLabelsOutboxKey,
  type LabelEdit,
} from '@/lib/data/outboundLabelCoalesce'
import { isoNow, syncFieldsForLocalInsert } from '@/lib/data/base_sync_fields'
import { touchListContentUpdateInDexie } from '@/lib/data/listActivity'
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
  prependListToCatalogSorted,
  withListCatalogSortOrders,
} from '@/lib/data/listCatalogSort'
import {
  DuplicateListError,
  duplicateListLocalFirst,
} from '@/lib/data/duplicateListLocal'
import { ImportListError, importListLocalFirst } from '@/lib/data/importListLocalFirst'
import type { SheetImportItemRow } from '@/lib/sheetImport/parseSheetCsv'

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
  const nowMs = Date.now()
  const queueServerDelete = options?.queueServerDelete !== false
  const leaveRpc = options?.leaveRpc === true
  /**
   * Single Dexie write scope: list/members/items/IMS soft-delete and outbound `sync_queue` updates
   * (including `deleteOutboundQueueRowsTouchingList` inside list `delete` enqueue) must not interleave
   * with unrelated async work — only await Dexie tables in this store list.
   */
  await db.transaction(
    'rw',
    [db.lists, db.items, db.members, db.item_member_state, db.list_users, db.sync_queue],
    async () => {
      if (leaveRpc) {
        await clearSyncQueueForList(listId)
      }
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
      await touchListContentUpdateInDexie(listId, t)
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
  const { user, profile, loading: authLoading, activeActorId, guestId, bootstrapUserId, isGuest } =
    useAuth()
  const selectedActiveUserId = useListsCatalogStore((s) => s.activeUserId)
  const selectedStatus = useListsCatalogStore((s) => s.listsCatalogStatus)
  const selectedLists = useListsCatalogStore((s) => s.lists)
  const [isFetching, setIsFetching] = useState(true)
  const [hasCompletedInitialFetch, setHasCompletedInitialFetch] = useState(false)
  const [fetchTimedOut, setFetchTimedOut] = useState(false)
  const [saveTimedOut, setSaveTimedOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastFetchError, setLastFetchError] = useState<unknown>(null)
  const fetchingRef = useRef(false)
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingSaveOpsRef = useRef(0)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const hasInitialDataRef = useRef(false)
  const catalogActorEffectGenRef = useRef(0)
  const userId = activeActorId
  const catalogMatchesActor = !!userId && selectedActiveUserId === userId
  const actorLists = useMemo(
    () => (catalogMatchesActor ? selectedLists : []),
    [catalogMatchesActor, selectedLists],
  )
  /** Owner id for catalog mutations (authenticated user or local guest). */
  const mutationUserId = resolveCatalogMutationUserId(user?.id, guestId, bootstrapUserId)

  const {
    isOfflineActionsDisabled,
    recoveryFetchGeneration,
    status: connectivityStatus,
    beginServerWork,
    endServerWork,
    canMutateNow,
    blockedMutationMessage,
    swControlled,
    offlineAssetsReady,
  } = useConnectivity()
  const connectivityStatusRef = useRef(connectivityStatus)
  useEffect(() => {
    connectivityStatusRef.current = connectivityStatus
  }, [connectivityStatus])
  const mutationGate = useMemo(() => createUserMutationGate(), [])
  const tryBeginMutation = useCallback((): boolean => {
    const browserOffline = typeof navigator !== 'undefined' && !navigator.onLine
    const offlineCatalogOk = browserOffline && swControlled && offlineAssetsReady
    if (!canMutateNow() && !offlineCatalogOk) return false
    return mutationGate.tryBegin()
  }, [canMutateNow, mutationGate, offlineAssetsReady, swControlled])

  useEffect(() => {
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

    setError(null)
    setLastFetchError(null)
    fetchingRef.current = false
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current)
      fetchTimeoutRef.current = null
    }

    if (!userId) {
      useListsCatalogStore.getState().clearListsCatalog()
      setHasCompletedInitialFetch(false)
      hasInitialDataRef.current = false
      return
    }

    const store = useListsCatalogStore.getState()
    const actorChanged = store.activeUserId !== userId
    const previousActiveUserId = store.activeUserId
    const cachedLists = getCachedLists(userId)?.lists || []


    if (actorChanged) {
      setHasCompletedInitialFetch(false)
      hasInitialDataRef.current = cachedLists.length > 0
    }

    const effectGen = ++catalogActorEffectGenRef.current
    let cancelled = false
    void (async () => {
      if (actorChanged) {
        await bootstrapListsCatalogSession(userId, 'useLists-actor-effect')
      } else {
        const epoch = useListsCatalogStore.getState().catalogSessionEpoch
        await warmListsCatalog(userId, epoch, 'useLists-actor-effect')
      }
      if (cancelled || catalogActorEffectGenRef.current !== effectGen) {
        return
      }
      hasInitialDataRef.current = useListsCatalogStore.getState().lists.length > 0
      const sessionUserId = user?.id ?? null
      const pendingServerCatalogSync =
        !isGuest && sessionUserId != null && sessionUserId === userId
      if (!pendingServerCatalogSync) {
        setIsFetching(false)
        setHasCompletedInitialFetch(true)
      }
    })()

    const unsub = subscribeListsCatalogL2Bridge(userId)
    return () => {
      cancelled = true
      unsub()
    }
  }, [userId, user, isGuest])

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
    if (!mutationUserId) return null
    const nowMs = Date.now()
    const orderedIds = orderedLists.map((list) => list.id)
    await db.transaction('rw', db.list_users, db.lists, db.sync_queue, async () => {
      const n = orderedLists.length
      for (const [index, list] of orderedLists.entries()) {
        const row = await db.list_users.where('[list_id+user_id]').equals([list.id, mutationUserId]).first()
        if (row) await db.list_users.update(row.id, { sort_order: listCatalogSortOrderForVisualIndex(index, n) })
      }
      await enqueueSyncQueueRecord({
        entity: CATALOG_RPC_COALESCE_ENTITY,
        entity_id: reorderListUsersOutboxKey(mutationUserId),
        kind: 'rpc',
        payload: {
          method: 'reorderListUsers',
          user_id: mutationUserId,
          list_ids: orderedIds,
        },
        ...userQueueParent(mutationUserId),
        status: 'queued',
      })
    })
    return null
  }

  const fetchLists = useCallback(async (options?: { staleCheckVersion?: number | null }) => {
    const staleCheck = options?.staleCheckVersion
    const readStatus = connectivityStatusRef.current
    let staleDiscarded = false
    let connectivityDiscarded = false

    if (!userId) {
      useListsCatalogStore.getState().clearListsCatalog()
      setIsFetching(false)
      setHasCompletedInitialFetch(true)
      return
    }

    if (!canFetchFromServerNow()) {
      const fetchT0 = performance.now()
      fetchingRef.current = true
      setIsFetching(true)
      setFetchTimedOut(false)
      setError(null)
      setLastFetchError(null)
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current)
      fetchTimeoutRef.current = null
      try {
        const catalog = useListsCatalogStore.getState()
        if (catalog.activeUserId === userId) {
          await warmListsCatalog(userId, catalog.catalogSessionEpoch, 'fetchLists-dexie-only')
          hasInitialDataRef.current = true
        }
      } finally {
        setIsFetching(false)
        setHasCompletedInitialFetch(true)
        fetchingRef.current = false
        if (staleCheck != null) {
          catalogRealtimeScheduleCaptureVersionRef.current = null
        }
      }
      return
    }

    if (fetchingRef.current) return
    const fetchT0 = performance.now()
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
    setLastFetchError(null)

    beginServerWork()
    const readFlightGen = captureReadFlightGeneration()
    let serverOutcome: ServerWorkOutcome = 'success'
    const listsRpcT0 = performance.now()
    try {
      // Catalog: lists + list_users (counts come from Dexie liveQuery after mirror fills items/members)
      const { data, error: rpcError } = await rpcGetUserLists()

      if (rpcError) throw rpcError

      if (shouldDiscardReadFlightResult(readFlightGen)) {
        connectivityDiscarded = true
        const n = Array.isArray(data) ? data.length : 0
        logServerRoundTrip({
          description: `Fetched list catalog (${n} lists)`,
          ok: true,
          durationMs: performance.now() - listsRpcT0,
          respondsTo: 'Home lists refresh (discarded: not online)',
        })
        serverOutcome = 'success'
        return
      }

      if (staleCheck != null && staleCheck !== catalogMutationVersionRef.current) {
        staleDiscarded = true
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
        last_content_update_by: item.last_content_update_by ?? null,
        role: item.role,
        userArchived: item.userArchived,
        userArchivedAt: item.userArchivedAt ?? null,
        sort_order: item.sort_order ?? null,
        last_viewed: item.last_viewed ?? null,
        memberCount: 0,
        activeItemCount: 0,
        archivedItemCount: 0,
        sumScope: coalesceListUserSumScope(item.sumScope),
        ownerNickname: item.ownerNickname,
        label: item.label ?? '',
      }))

      setCachedLists(userId, listsData)
      await upsertListsSummaryFromServer(userId, rawRows)
      void enqueueListMirrorJobs(mirrorListIds, { forceFullDetail: true })
      const catalog = useListsCatalogStore.getState()
      if (catalog.activeUserId === userId) {
        await warmListsCatalog(userId, catalog.catalogSessionEpoch, 'fetchLists-rpc-success')
      }
      hasInitialDataRef.current = true
      setFetchTimedOut(false)
      listCount = listsData.length
      serverOutcome = 'success'
      logServerRoundTrip({
        description: `Fetched list catalog (${listsData.length} lists)`,
        ok: true,
        durationMs: performance.now() - listsRpcT0,
        respondsTo: 'Home lists refresh',
      })
    } catch (err) {
      if (shouldDiscardReadFlightResult(readFlightGen)) {
        connectivityDiscarded = true
        serverOutcome = 'success'
        return
      }
      serverOutcome = isLikelyConnectivityError(err) ? 'connectivity_failure' : 'application_error'
      if (serverOutcome === 'connectivity_failure' && connectivityStatusRef.current === 'online') {
        reportConnectivityFailure('fetchLists-connectivity-error')
      }
      const catalogActor = useListsCatalogStore.getState().activeUserId
      if (catalogActor && catalogActor !== userId) {
        serverOutcome = 'success'
        return
      }
      fetchErr = (err as Error).message
      setLastFetchError(err)
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
      if (connectivityDiscarded && !canFetchFromServerNow()) {
        queueMicrotask(() => {
          const catalog = useListsCatalogStore.getState()
          if (catalog.activeUserId === userId) {
            void warmListsCatalog(userId, catalog.catalogSessionEpoch, 'fetchLists-connectivity-discard')
          }
        })
      }
    }
  }, [beginServerWork, endServerWork, userId])

  const isInitialSyncing = isFetching && !hasCompletedInitialFetch && actorLists.length > 0

  const refreshLists = useCallback(() => {
    void fetchLists()
  }, [fetchLists])

  const sessionUserId = user?.id ?? null

  /** Server catalog sync (`get_user_lists` + mirror enqueue) — only after Supabase `user` exists. */
  useEffect(() => {
    if (!sessionUserId || !userId || sessionUserId !== userId) return
    void fetchLists()
  }, [fetchLists, sessionUserId, userId])

  const lastCatalogRefreshGenRef = useRef(0)
  useEffect(() => {
    if (!sessionUserId || !userId || sessionUserId !== userId) return
    if (recoveryFetchGeneration <= lastCatalogRefreshGenRef.current) return
    lastCatalogRefreshGenRef.current = recoveryFetchGeneration
    void fetchLists()
  }, [recoveryFetchGeneration, fetchLists, sessionUserId, userId])

  useEffect(() => {
    if (!userId || !catalogMatchesActor) return
    setCachedLists(userId, actorLists)
    // Do not write lists back into Dexie from this effect.
    // lists state is itself sourced from Dexie (useLiveQuery), so writing here creates
    // a feedback loop (especially with cachedAt updates) and can spam diagnostics.
  }, [userId, catalogMatchesActor, actorLists])

  useEffect(() => {
    if (!userId || !sessionUserId || sessionUserId !== userId) {
      registerListsCatalogFetchHandler(null)
      return
    }
    registerListsCatalogFetchHandler((opts) => {
      void fetchLists(opts)
    })
    return () => {
      registerListsCatalogFetchHandler(null)
    }
  }, [fetchLists, sessionUserId, userId])

  const createList = async (name: string, label?: string) => {
    if (!mutationUserId) return { error: new Error('Not authenticated') }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
    const trimmedName = name.trim()
    if (!trimmedName) {
      return { error: new Error('List name is required') }
    }
    const nameDup = await validateListNameForOwner(mutationUserId, trimmedName)
    if (!nameDup.ok) {
      return { error: new Error(nameDup.message) }
    }
    const listId = crypto.randomUUID()
    const now = new Date().toISOString()
    const sync = syncFieldsForLocalInsert()
    const cat = useListsCatalogStore.getState()
    const existingMemberships = await db.list_users.where('user_id').equals(mutationUserId).toArray()
    const nextSort = nextListCatalogSortOrderFromMembershipRows(existingMemberships, listId)
    const optimisticList: ListWithRole = {
      id: listId,
      name: trimmedName,
      owner_id: mutationUserId,
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
      last_content_update_by: mutationUserId,
      role: 'owner',
      userArchived: false,
      userArchivedAt: null,
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
      cat.setCatalogLists((prev) => prependListToCatalogSorted(prev, optimisticList))
      await db.transaction('rw', db.lists, db.list_users, db.sync_queue, async () => {
        await db.lists.put({
          ...extractListRowFields(optimisticList),
          cached_at: Date.now(),
          app_version: APP_VERSION,
        })
        await db.list_users.put({
          id: crypto.randomUUID(),
          list_id: listId,
          user_id: mutationUserId,
          role: 'owner',
          archived: false,
          archived_at: null,
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

      return { error: null }
    } finally {
      mutationGate.end()
    }
  }

  const deleteList = async (listId: string) => {
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
        await softDeleteListInDexie(userId, listId)
      } finally {
        cat.endLocalCatalogPersistence()
      }
      return { error: null }
    } finally {
      mutationGate.end()
    }
  }

  const updateUserListState = async (listId: string, updates: { archived?: boolean; sort_order?: number }) => {
    if (!mutationUserId) return { error: new Error('Not authenticated') }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
    const cat = useListsCatalogStore.getState()
    const previousLists = cat.lists
    const archiveFields =
      updates.archived !== undefined
        ? updates.archived
          ? { userArchived: true as const, userArchivedAt: new Date().toISOString() }
          : { userArchived: false as const, userArchivedAt: null }
        : null
    const nextLists = archiveFields
      ? cat.lists.map((list) => (list.id === listId ? { ...list, ...archiveFields } : list))
      : cat.lists.map((list) =>
          list.id === listId && updates.sort_order !== undefined
            ? { ...list, sort_order: updates.sort_order }
            : list,
        )

    catalogMutationVersionRef.current += 1
    catalogSkipRealtimeUntilRef.current = Date.now() + 2000
    cat.beginLocalCatalogPersistence()
    try {
      cat.setCatalogLists(nextLists)
      try {
        await db.transaction('rw', db.list_users, db.lists, db.sync_queue, async () => {
          const queueTs = Date.now()
          const row = await db.list_users.where('[list_id+user_id]').equals([listId, mutationUserId]).first()
          if (row) {
            await db.list_users.update(row.id, {
              ...(archiveFields
                ? { archived: archiveFields.userArchived, archived_at: archiveFields.userArchivedAt }
                : {}),
              ...(updates.sort_order !== undefined ? { sort_order: updates.sort_order } : {}),
            })
          }
          await enqueueSyncQueueRecord({
            entity: CATALOG_RPC_COALESCE_ENTITY,
            entity_id: patchListUserOutboxKey(listId, mutationUserId),
            kind: 'rpc',
            payload: {
              method: 'patchListUser',
              id: listId,
              user_id: mutationUserId,
              ...(archiveFields
                ? { archived: archiveFields.userArchived, archived_at: archiveFields.userArchivedAt }
                : {}),
              ...(updates.sort_order !== undefined ? { sort_order: updates.sort_order } : {}),
            },
            ...listQueueParent(listId),
            status: 'queued',
            updated_at: queueTs,
          })
        })
      } catch (e) {
        cat.setCatalogLists(previousLists)
        return { error: e instanceof Error ? e : new Error('Failed to update list state') }
      }
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
        return { data: null, error: new Error('Session still loading'), joinedListName: null as string | null }
      }
      if (!mutationUserId) {
        return { data: null, error: new Error('Not authenticated'), joinedListName: null as string | null }
      }
      if (isGuest || isGuestId(mutationUserId)) {
        return {
          data: null,
          error: new Error(GUEST_JOIN_SHARE_BLOCKED_MSG),
          joinedListName: null as string | null,
        }
      }
      if (!tryBeginMutation()) {
        const msg = blockedMutationMessage()
        return { data: null, error: new Error(msg), joinedListName: null as string | null }
      }
      try {
        if (!canMutateNow()) {
          return {
            data: null,
            error: new Error(blockedMutationMessage()),
            joinedListName: null as string | null,
          }
        }

        catalogMutationVersionRef.current += 1
        catalogSkipRealtimeUntilRef.current = Date.now() + 2000
        const { data: listIdRaw, error: rpcError } = await supabase.rpc('join_list_by_token', {
          p_token: token,
        } as never)
        if (rpcError) {
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
        await fetchLists()
        const joined = useListsCatalogStore.getState().lists.find((l) => l.id === listId)
        return { data: listId, error: null, joinedListName: joined?.name ?? null }
      } catch (e) {
        return { data: null, error: e instanceof Error ? e : new Error(String(e)), joinedListName: null as string | null }
      } finally {
        mutationGate.end()
      }
    },
    [
      authLoading,
      isGuest,
      mutationUserId,
      userId,
      bootstrapUserId,
      tryBeginMutation,
      mutationGate,
      blockedMutationMessage,
      fetchLists,
      canMutateNow,
    ],
  )

  const leaveList = async (listId: string) => {
    if (!mutationUserId) return { error: new Error('Not authenticated') }
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
    if (!mutationUserId) return { error: new Error('Not authenticated') }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
      catalogMutationVersionRef.current += 1
      catalogSkipRealtimeUntilRef.current = Date.now() + 2000
      const catDup = useListsCatalogStore.getState()
      catDup.beginLocalCatalogPersistence()
      let optimisticList: ListWithRole | null = null
      try {
        const result = await duplicateListLocalFirst({
          sourceListId: listId,
          newName,
          label,
          mutationUserId,
          duplicatorNickname: profile?.nickname ?? null,
        })
        optimisticList = result.optimisticList
        catDup.setCatalogLists((prev) => prependListToCatalogSorted(prev, optimisticList!))
        return { data: optimisticList, error: null }
      } catch (e) {
        if (e instanceof DuplicateListError) {
          return { error: new Error(e.userMessage) }
        }
        if (optimisticList) {
          catDup.setCatalogLists((prev) => prev.filter((list) => list.id !== optimisticList!.id))
        }
        return { error: e instanceof Error ? e : new Error('Failed to duplicate list') }
      } finally {
        catDup.endLocalCatalogPersistence()
      }
    } finally {
      mutationGate.end()
    }
  }

  const importList = async (name: string, label?: string, categoryNames?: string, rows?: Json, hasTargets?: boolean) => {
    if (!mutationUserId) return { error: new Error('Not authenticated') }
    const importDup = validateImportSheetRowTextsUnique(rows)
    if (!importDup.ok) {
      return { error: new Error(importDup.message) }
    }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    try {
      const sheetRows = Array.isArray(rows) ? (rows as SheetImportItemRow[]) : []
      catalogMutationVersionRef.current += 1
      catalogSkipRealtimeUntilRef.current = Date.now() + 2000
      const catImp = useListsCatalogStore.getState()
      catImp.beginLocalCatalogPersistence()
      let optimisticList: ListWithRole | null = null
      try {
        const result = await importListLocalFirst({
          name,
          label,
          categoryNamesJson: categoryNames,
          rows: sheetRows,
          hasTargets: hasTargets ?? false,
          mutationUserId,
        })
        optimisticList = result.optimisticList
        catImp.setCatalogLists((prev) => prependListToCatalogSorted(prev, optimisticList!))
        return { data: optimisticList, error: null }
      } catch (e) {
        if (e instanceof ImportListError) {
          return { error: new Error(e.userMessage) }
        }
        if (optimisticList) {
          catImp.setCatalogLists((prev) => prev.filter((list) => list.id !== optimisticList!.id))
        }
        return { error: e instanceof Error ? e : new Error('Failed to import list') }
      } finally {
        catImp.endLocalCatalogPersistence()
      }
    } finally {
      mutationGate.end()
    }
  }

  const enqueueLabelEditsInTransaction = async (
    edits: readonly LabelEdit[],
    listNameById: ReadonlyMap<string, string>,
  ): Promise<string[]> => {
    if (!mutationUserId) return []
    const result = await applyCoalescedLabelChanges(mutationUserId, edits, listNameById)
    await finalizeCoalescedLabelOutbound(mutationUserId, result.action)
    if (result.action === 'enqueue') {
      await enqueueSyncQueueRecord({
        entity: CATALOG_RPC_COALESCE_ENTITY,
        entity_id: bulkPatchListLabelsOutboxKey(mutationUserId),
        kind: 'rpc',
        payload: result.payload,
        ...userQueueParent(mutationUserId),
        status: 'queued',
      })
    }
    return result.historyLines
  }

  const persistListLabelOnly = async (listId: string, label: string) => {
    if (!mutationUserId) return { error: new Error('Not authenticated') }
    if (await hasProcessingLabelOutbound(mutationUserId)) {
      return { error: new Error(LABEL_CHANGES_SYNC_WAIT_MSG) }
    }
    const catLbl = useListsCatalogStore.getState()
    const list = catLbl.lists.find((l) => l.id === listId)
    const baseline = normalizeCatalogLabel(list?.label)
    const target = normalizeCatalogLabel(label)
    if (baseline === target) return { error: null }

    catalogMutationVersionRef.current += 1
    catalogSkipRealtimeUntilRef.current = Date.now() + 2000
    catLbl.beginLocalCatalogPersistence()
    try {
      catLbl.setCatalogLists((prev) => prev.map((l) => (l.id === listId ? { ...l, label: target } : l)))

      await db.transaction('rw', db.list_users, db.lists, db.sync_queue, async () => {
        const row = await db.list_users.where('[list_id+user_id]').equals([listId, mutationUserId]).first()
        if (row) await db.list_users.update(row.id, { label: target })
        const listNameById = new Map(catLbl.lists.map((l) => [l.id, l.name]))
        await enqueueLabelEditsInTransaction([{ listId, baseline, target }], listNameById)
      })
    } finally {
      catLbl.endLocalCatalogPersistence()
    }
    return { error: null }
  }

  const updateListLabel = async (listId: string, label: string) => {
    if (!mutationUserId) return { error: new Error('Not authenticated') }
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
    if (!mutationUserId) return { error: new Error('Not authenticated'), historyLines: [] as string[] }
    if (await hasProcessingLabelOutbound(mutationUserId)) {
      return { error: new Error(LABEL_CHANGES_SYNC_WAIT_MSG), historyLines: [] }
    }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()), historyLines: [] }
    }
    try {
      const catBatch = useListsCatalogStore.getState()
      const listsSnapshot = catBatch.lists
      const listNameById = new Map(listsSnapshot.map((l) => [l.id, l.name]))
      const edits: LabelEdit[] = []
      const nextLabelById = new Map<string, string>()
      for (const { listId, label } of changes) {
        const list = listsSnapshot.find((l) => l.id === listId)
        if (!list) continue
        const baseline = normalizeCatalogLabel(list.label)
        const target = normalizeCatalogLabel(label)
        if (baseline === target) continue
        edits.push({ listId, baseline, target })
        nextLabelById.set(listId, target)
      }
      if (edits.length === 0) {
        return { error: null, historyLines: [] }
      }

      catalogMutationVersionRef.current += 1
      catalogSkipRealtimeUntilRef.current = Date.now() + 2000
      catBatch.beginLocalCatalogPersistence()
      let historyLines: string[] = []
      try {
        catBatch.setCatalogLists((prev) =>
          prev.map((list) =>
            nextLabelById.has(list.id) ? { ...list, label: nextLabelById.get(list.id) ?? '' } : list,
          ),
        )

        await db.transaction('rw', db.list_users, db.lists, db.sync_queue, async () => {
          for (const { listId, target } of edits.map((e) => ({ listId: e.listId, target: e.target }))) {
            const row = await db.list_users.where('[list_id+user_id]').equals([listId, mutationUserId]).first()
            if (row) await db.list_users.update(row.id, { label: target })
          }
          historyLines = await enqueueLabelEditsInTransaction(edits, listNameById)
        })
      } finally {
        catBatch.endLocalCatalogPersistence()
      }
      return { error: null, historyLines }
    } finally {
      mutationGate.end()
    }
  }

  const labels = useMemo(() => {
    const set = new Set<string>()
    for (const list of actorLists) {
      if (list.label) set.add(list.label)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [actorLists])

  const reorderLists = async (reorderedLists: ListWithRole[]) => {
    if (!mutationUserId) {
      return
    }
    if (!tryBeginMutation()) {
      return
    }
    try {
    catalogMutationVersionRef.current += 1
    catalogSkipRealtimeUntilRef.current = Date.now() + 2000
    const catOrd = useListsCatalogStore.getState()
    const listsWithSortOrder = withListCatalogSortOrders(reorderedLists)
    catOrd.beginLocalCatalogPersistence()
    try {
      catOrd.setCatalogLists(listsWithSortOrder)
      await persistListOrder(listsWithSortOrder)
    } finally {
      catOrd.endLocalCatalogPersistence()
    }
    } finally {
      mutationGate.end()
    }
  }

  const loading = useMemo(() => {
    if (!userId || error) return false
    if (!catalogMatchesActor) return true
    return Boolean(actorLists.length === 0 && selectedStatus === 'loading')
  }, [userId, catalogMatchesActor, actorLists.length, selectedStatus, error])

  return {
    lists: actorLists,
    loading,
    isFetching,
    isInitialSyncing,
    fetchTimedOut,
    saveTimedOut,
    error,
    lastFetchError,
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
    mutationUserId,
  }
}
