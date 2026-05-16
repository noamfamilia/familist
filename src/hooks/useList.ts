'use client'

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react'
import Dexie from 'dexie'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { getActiveCacheUserId, getCachedList, setCachedList, removeCachedList } from '@/lib/cache'
import { useShallow } from 'zustand/react/shallow'
import { normalizeItemsCategory } from '@/lib/items/normalizeItemsCategory'
import { computeItemsReorderedByCategory } from '@/lib/items/categoryItemReorder'
import { replaceListPreservingClientMirror, subscribeListDataL2Bridge, useListDataStore, warmListData } from '@/stores/listDataStore'
import {
  addItemMutation,
  addMemberMutation,
  bulkSoftDeleteArchivedItemsMutation,
  seedItemMemberStatesForMemberMutation,
  softDeleteItemMutation,
  toggleItemMemberStateMutation,
} from '@/lib/data/mutations'
import { withDeletionNameSuffix } from '@/lib/data/deletionRename'
import { db, type DbItemRow } from '@/lib/db'
import {
  normalizeServerSyncableFields,
  reportServerDexieParityDiagnostics,
  upsertListDataPayloadFromServer,
  upsertListPrefsFromServer,
} from '@/lib/data/serverDexieParity'
import { LIST_MIRROR_SESSION_OWNER, setLastMirroredListDetailVersion } from '@/lib/data/listMirror'
import { releaseListMirrorLock, waitForListMirrorLock } from '@/lib/data/listMirrorLock'
import { perfLog } from '@/lib/startupPerfLog'
import { formatQuotedListName, logServerRoundTrip } from '@/lib/serverActionLog'
import { appendMutationDiagnostic, appendOfflineNavDiagnostic } from '@/lib/offlineNavDiagnostics'
import { serverListDetailDiffersFromDexie } from '@/lib/data/listDetailServerDexieDiff'
import {
  isLikelyConnectivityError,
  resolveServerWorkOutcomeFromResult,
  resolveServerWorkOutcomeFromThrown,
  type ServerWorkOutcome,
} from '@/lib/connectivityErrors'
import { clearSyncQueueForList, enqueueSyncQueueRecord, listQueueParent, newBatchEntityId } from '@/lib/data/syncQueue'
import {
  isoNow,
  isTombstoned,
  syncFieldsForLocalInsert,
  withLastSyncedNow,
} from '@/lib/data/base_sync_fields'
import { validateBulkItemLinesUniqueness, validateSingleNewItemTextUniqueness } from '@/lib/data/localItemTextUniqueness'
import { validateMemberNameForList } from '@/lib/data/localListMemberNameUniqueness'
import { APP_VERSION } from '@/lib/appVersion'
import { ITEM_TEXT_WIDTH_MAX, ITEM_TEXT_WIDTH_MIN, measureFitItemTextWidthPx } from '@/lib/itemTextWidthFit'
import {
  ITEM_NAME_FONT_DEFAULT,
  ITEM_NAME_FONT_MAX,
  ITEM_NAME_FONT_MIN,
  parseItemNameFontStep,
} from '@/lib/itemNameFontStep'
import {
  normalizeItemCategory,
  type CategoryNames,
  type Database,
  type Item,
  type ItemMemberState,
  type ItemWithState,
  type List,
  type ListWithRole,
  type Member,
  type MemberWithCreator,
  type ListUserSumScope,
} from '@/lib/supabase/types'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useToast } from '@/components/ui/Toast'
import { createUserMutationGate } from '@/lib/userMutationGate'
import { reportConnectivityFailure } from '@/lib/connectivityFailureBridge'
import {
  canFetchFromServer,
  captureReadFlightGeneration,
  shouldDiscardReadFlightResult,
} from '@/lib/data/serverReadPolicy'
import { markListViewedLocally } from '@/lib/data/listActivity'
import { useListSyncErrorToast } from '@/hooks/useListSyncErrorToast'

const supabase = createClient()

// Helper to get cached preferences from localStorage
function getPrefsKey(listId: string, userId?: string | null) {
  const scopedUserId = userId || getActiveCacheUserId()
  return scopedUserId ? `list_${scopedUserId}_${listId}_prefs` : null
}

type WidthMode = 'auto' | 'manual'

function parseWidthValue(raw: string | number | null | undefined): { mode: WidthMode; width: number } {
  if (raw == null || raw === 'auto' || typeof raw === 'number') {
    return { mode: 'auto', width: ITEM_TEXT_WIDTH_MIN }
  }
  const num = parseInt(String(raw), 10)
  if (isNaN(num)) return { mode: 'auto', width: ITEM_TEXT_WIDTH_MIN }
  if (num < ITEM_TEXT_WIDTH_MIN) return { mode: 'manual', width: ITEM_TEXT_WIDTH_MIN }
  return { mode: 'manual', width: Math.min(ITEM_TEXT_WIDTH_MAX, num) }
}

const EMPTY_CATEGORY_NAMES: CategoryNames = { '1': '', '2': '', '3': '', '4': '', '5': '', '6': '' }

function parseCategoryNames(raw: string | null | undefined): CategoryNames {
  if (!raw) return { ...EMPTY_CATEGORY_NAMES }
  try {
    const parsed = JSON.parse(raw) as Record<string, string>
    const result = { ...EMPTY_CATEGORY_NAMES }
    for (const k of Object.keys(result)) {
      if (typeof parsed[k] === 'string') result[k] = parsed[k]
    }
    return result
  } catch {
    return { ...EMPTY_CATEGORY_NAMES }
  }
}

const DEFAULT_CATEGORY_ORDER: number[] = [1, 2, 3, 4, 5, 6]

function parseCategoryOrder(raw: string | null | undefined): number[] {
  if (!raw) return [...DEFAULT_CATEGORY_ORDER]
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed) && parsed.length === 6 && parsed.every((v: unknown) => typeof v === 'number' && v >= 1 && v <= 6)) {
      return parsed as number[]
    }
  } catch { /* ignore */ }
  return [...DEFAULT_CATEGORY_ORDER]
}

type MemberFilter = 'all' | 'mine' | 'hide'

const VALID_MEMBER_FILTERS: MemberFilter[] = ['all', 'mine', 'hide']

function parseListUserSumScope(raw: unknown): ListUserSumScope {
  if (raw == null || raw === '') return 'none'
  if (raw === 'none' || raw === 'all' || raw === 'active' || raw === 'archived') return raw
  return 'none'
}

/** Next mode when cycling the sum row title (all → active → archived → all). */
export function nextListUserSumScope(current: ListUserSumScope): ListUserSumScope {
  if (current === 'all') return 'active'
  if (current === 'active') return 'archived'
  if (current === 'archived') return 'all'
  return 'all'
}

/** Single sum label for auto name-width when the sum row is visible (matches selected mode only). */
function sumRowTitlesForAutoWidth(sumScope: ListUserSumScope, items: ItemWithState[]): string[] {
  if (sumScope === 'none') return []
  const nAll = items.length
  const nActive = items.filter(i => !i.archived).length
  const nArchived = items.filter(i => i.archived).length
  if (sumScope === 'all') return [`${nAll} items`]
  if (sumScope === 'active') return [`${nActive} active items`]
  return [`${nArchived} archived item`]
}

function getCachedPrefs(listId: string, userId?: string | null) {
  const defaults = {
    memberFilter: 'all' as MemberFilter,
    itemTextWidth: 'auto' as string,
    itemNameFontStep: ITEM_NAME_FONT_DEFAULT,
    sumScope: 'none' as ListUserSumScope,
  }
  if (typeof window === 'undefined') return defaults
  const prefsKey = getPrefsKey(listId, userId)
  if (!prefsKey) return defaults

  const cached = localStorage.getItem(prefsKey)
  if (cached) {
    try {
      const parsed = JSON.parse(cached)
      return {
        memberFilter: VALID_MEMBER_FILTERS.includes(parsed.memberFilter) ? parsed.memberFilter as MemberFilter : 'all' as MemberFilter,
        itemTextWidth: typeof parsed.itemTextWidth === 'string' ? parsed.itemTextWidth : 'auto',
        itemNameFontStep: parseItemNameFontStep(parsed.itemNameFontStep),
        sumScope: parseListUserSumScope(parsed.sumScope),
      }
    } catch { /* ignore */ }
  }
  return defaults
}

function setCachedPrefsLocalOnly(
  listId: string,
  prefs: { memberFilter?: MemberFilter; itemTextWidth?: string; itemNameFontStep?: number; sumScope?: ListUserSumScope },
  userId?: string | null,
) {
  if (typeof window === 'undefined') return
  const prefsKey = getPrefsKey(listId, userId)
  if (!prefsKey) return
  try {
    const current = getCachedPrefs(listId, userId)
    const updated = { ...current, ...prefs }
    localStorage.setItem(prefsKey, JSON.stringify(updated))
  } catch { /* ignore */ }
}

function setCachedPrefs(
  listId: string,
  prefs: { memberFilter?: MemberFilter; itemTextWidth?: string; itemNameFontStep?: number; sumScope?: ListUserSumScope },
  userId?: string | null,
) {
  setCachedPrefsLocalOnly(listId, prefs, userId)
  if (userId) {
    void upsertListPrefsFromServer(userId, listId, {
      member_filter: prefs.memberFilter ?? null,
      item_text_width: prefs.itemTextWidth ?? null,
      item_name_font_step: prefs.itemNameFontStep ?? null,
      sum_scope: prefs.sumScope ?? null,
    })
  }
}

type DisplayPrefsBaseline = { widthValue: string; fontStep: number }

const FETCH_TIMEOUT_MS = 10_000
const SAVE_TIMEOUT_MS = 10_000
/** Pending item ids: `create` rows use `entity_id`; bulk adds use `rpc` payload `items`. */
function mergePendingItemCreatesIntoServerItems(
  serverItems: ItemWithState[],
  prev: ItemWithState[],
  pendingCreates: Array<{ itemKey: string; payload: Record<string, unknown> }>,
): ItemWithState[] {
  const pendingIds = new Set(pendingCreates.map((c) => c.itemKey))
  const serverIds = new Set(serverItems.map((i) => i.id))
  const merged: ItemWithState[] = []
  for (const srv of serverItems) {
    const prevSame = prev.find((p) => p.id === srv.id)
    if (prevSame) {
      const msSrv = srv.memberStates ?? {}
      const msPrev = prevSame.memberStates ?? {}
      const memberStates = { ...msPrev, ...msSrv }
      merged.push({ ...srv, memberStates })
    } else {
      merged.push(srv)
    }
  }
  for (const p of prev) {
    if (!pendingIds.has(p.id)) continue
    if (serverIds.has(p.id)) continue
    merged.push(p)
  }
  const byId = new Map<string, ItemWithState>()
  for (const row of merged) {
    const existing = byId.get(row.id)
    if (!existing) {
      byId.set(row.id, row)
      continue
    }
    const preferNew =
      Object.keys(row.memberStates ?? {}).length > Object.keys(existing.memberStates ?? {}).length
    byId.set(row.id, preferNew ? row : existing)
  }
  return Array.from(byId.values())
}

function mergePendingMembersIntoServerMembers(
  serverMembers: MemberWithCreator[],
  prev: MemberWithCreator[],
  pendingMemberIds: Set<string>,
): MemberWithCreator[] {
  const serverIds = new Set(serverMembers.map((m) => m.id))
  const merged = [...serverMembers]
  for (const m of prev) {
    if (!pendingMemberIds.has(m.id)) continue
    if (serverIds.has(m.id)) continue
    merged.push(m)
  }
  return merged
}

function rpcFailureMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message: unknown }).message
    if (typeof m === 'string' && m.length > 0) return m
  }
  return 'Unknown error'
}

/** `sort_order` for new rows so they sort after every existing item (L1, Dexie, cache, RPC). */
function nextItemSortOrdersAfterExisting(items: ItemWithState[], count: number): number[] {
  let max = 0
  for (const it of items) {
    const raw = it.sort_order
    const so = typeof raw === 'number' && !Number.isNaN(raw) ? raw : 0
    if (so > max) max = so
  }
  return Array.from({ length: count }, (_, i) => max + 1 + i)
}

/** `sort_order` for new members; must fit Postgres `integer` (not `Date.now()` ms). */
function nextMemberSortOrdersAfterExisting(members: MemberWithCreator[], count: number): number[] {
  let max = 0
  for (const m of members) {
    const raw = m.sort_order
    const so = typeof raw === 'number' && !Number.isNaN(raw) ? raw : 0
    if (so > max) max = so
  }
  return Array.from({ length: count }, (_, i) => max + 1 + i)
}

function persistListSnapshotToDetailCache(userId: string, listId: string) {
  const st = useListDataStore.getState()
  if (!st.list) return
  setCachedList(userId, listId, { list: st.list, items: st.items, members: st.members })
}

export function useList(listId: string) {
  const { user, profile, loading: authLoading, bootstrapUserId } = useAuth()
  const cached = getCachedList(undefined, listId)
  const userId = user?.id ?? (authLoading ? bootstrapUserId : null)

  const list = useListDataStore((s) => s.list)
  const listDataStatus = useListDataStore((s) => s.listDataStatus)
  const prefsMirrorReady = useListDataStore((s) => s.prefsMirrorReady)
  const mirroredListUserRow = useListDataStore((s) => s.mirroredListUserRow)
  const { items, members } = useListDataStore(
    useShallow((s) => ({
      items: s.items,
      members: s.members,
    })),
  )

  useListSyncErrorToast(list, listId)
  const [loading, setLoading] = useState(true)
  const [isFetching, setIsFetching] = useState(true)
  const [hasCompletedInitialFetch, setHasCompletedInitialFetch] = useState(false)
  const [fetchTimedOut, setFetchTimedOut] = useState(false)
  const [saveTimedOut, setSaveTimedOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const [memberFilter, setMemberFilter] = useState<MemberFilter>(() => getCachedPrefs(listId).memberFilter)
  const [itemTextWidthMode, setItemTextWidthMode] = useState<WidthMode>(() => parseWidthValue(getCachedPrefs(listId).itemTextWidth).mode)
  const [itemTextWidth, setItemTextWidth] = useState(() => parseWidthValue(getCachedPrefs(listId).itemTextWidth).width)
  const [itemNameFontStep, setItemNameFontStep] = useState(() => getCachedPrefs(listId).itemNameFontStep)
  const itemNameFontStepRef = useRef(itemNameFontStep)
  itemNameFontStepRef.current = itemNameFontStep
  const displayPrefsSessionActiveRef = useRef(false)
  const displayPrefsBaselineRef = useRef<DisplayPrefsBaseline | null>(null)
  const [categoryNames, setCategoryNames] = useState<CategoryNames>(() => parseCategoryNames(cached?.list?.category_names))
  const [categoryOrder, setCategoryOrder] = useState<number[]>(() => parseCategoryOrder(cached?.list?.category_order))
  const categoryNamesRef = useRef(categoryNames)
  const categoryOrderRef = useRef(categoryOrder)
  categoryNamesRef.current = categoryNames
  categoryOrderRef.current = categoryOrder
  /** >0 while applying optimistic category list-row updates; blocks mirror useEffect from overwriting. */
  const categoryListMirrorSuppressCountRef = useRef(0)
  const [categorySettingsMutationPending, setCategorySettingsMutationPending] = useState(false)
  const [lastViewedMembers, setLastViewedMembers] = useState<string | null>(null)
  const [sumScope, setSumScope] = useState<ListUserSumScope>(() =>
    parseListUserSumScope(getCachedPrefs(listId).sumScope),
  )
  const fetchingRef = useRef(false)
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingSaveOpsRef = useRef(0)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const hadAccessRef = useRef(false)
  const hasInitialDataRef = useRef(false)
  const prefsFetchedRef = useRef(false)
  const skipRealtimeUntilRef = useRef(0)
  const realtimeDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const pendingRealtimeRef = useRef(false)
  /** Bumped at the start of every mutation that optimistically changes list data a delayed `fetchList` could overwrite. */
  const mutationVersionRef = useRef(0)
  /** First mutation version captured when a debounced realtime fetch is scheduled; preserved across reschedules until that fetch completes. */
  const realtimeScheduleCaptureVersionRef = useRef<number | null>(null)
  const scheduleRealtimeFetchRef = useRef<(delayMs: number) => void>(() => {})
  useEffect(() => {
    reportServerDexieParityDiagnostics()
  }, [])

  useEffect(() => {
    if (!list || isTombstoned(list.deleted_at ?? null)) return
    setLoading(false)
    hasInitialDataRef.current = true
  }, [list])

  // Re-parse category prefs only when serialized list fields change (not on every `list`
  // identity change). Skipped during local category mutations to avoid echo reverts.
  useEffect(() => {
    if (categoryListMirrorSuppressCountRef.current > 0) return
    const st = useListDataStore.getState()
    if (st.activeUserId !== userId || st.activeListId !== listId) return
    const row = st.list
    if (!row || isTombstoned(row.deleted_at ?? null)) return
    setCategoryNames(parseCategoryNames(row.category_names))
    setCategoryOrder(parseCategoryOrder(row.category_order))
  }, [userId, listId, list?.category_names, list?.category_order])

  const { showToast, dismissToast, error: showErrorToast } = useToast()
  const {
    status: connectivityStatus,
    isOfflineActionsDisabled,
    allowItemMutationQueue,
    beginServerWork,
    endServerWork,
    pulseServerWorkProgress,
    canMutateNow,
    blockedMutationMessage,
    offlineAssetsReady,
    swControlled,
  } = useConnectivity()
  const archiveUndoToastIdRef = useRef<string | null>(null)
  /** User intent while archive / undo requests settle (`true` = archived, `false` = not). Read after awaits, not from closures. */
  const desiredArchivedByItemRef = useRef<Record<string, boolean>>({})
  const archiveDbWriteInflightRef = useRef<Record<string, boolean>>({})
  const updateItemRef = useRef<
    (itemId: string, updates: Partial<Item>) => Promise<{ error: { message?: string } | null }>
  >(async () => ({ error: null }))
  const mutationGate = useMemo(() => createUserMutationGate(), [])
  const markCurrentListViewed = useCallback(
    async (nowIso?: string) => {
      try {
        await markListViewedLocally(userId, listId, { nowIso })
      } catch {
        // Best effort only; read-cursor failures should not block item mutations.
      }
    },
    [listId, userId],
  )

  const tryBeginMutation = useCallback((): boolean => {
    const browserOffline = typeof navigator !== 'undefined' && !navigator.onLine
    const offlineCatalogOk = browserOffline && swControlled && offlineAssetsReady
    if (!canMutateNow() && !offlineCatalogOk) return false
    return mutationGate.tryBegin()
  }, [canMutateNow, mutationGate, offlineAssetsReady, swControlled])

  /** Add / archive-restore item queue: allowed while offline or recovering. */
  const tryBeginItemQueueableMutation = useCallback((): boolean => {
    if (!mutationGate.tryBegin()) return false
    if (canMutateNow() || allowItemMutationQueue) return true
    mutationGate.end()
    return false
  }, [allowItemMutationQueue, canMutateNow, mutationGate])

  const connectivityStatusRef = useRef(connectivityStatus)
  useEffect(() => {
    connectivityStatusRef.current = connectivityStatus
  }, [connectivityStatus])

  /** After offline/recovering → online, show last snapshot until `fetchList` applies server archive state (avoids flicker). */
  const [itemsUntilReconnectReconciled, setItemsUntilReconnectReconciled] = useState<ItemWithState[] | null>(null)
  const itemsRef = useRef<ItemWithState[]>(items)
  itemsRef.current = items
  const prevConnectivityForItemFreezeRef = useRef(connectivityStatus)
  useEffect(() => {
    const prev = prevConnectivityForItemFreezeRef.current
    prevConnectivityForItemFreezeRef.current = connectivityStatus
    if (connectivityStatus !== 'online') {
      setItemsUntilReconnectReconciled(null)
      return
    }
    if (prev === 'offline' || prev === 'recovering') {
      setItemsUntilReconnectReconciled(itemsRef.current.map(i => ({ ...i, memberStates: { ...i.memberStates } })))
    }
  }, [connectivityStatus])

  useEffect(() => {
    perfLog('localStorage read start')
    const lsT0 = performance.now()
    let approxStorageChars = 0
    try {
      if (userId && listId && typeof localStorage !== 'undefined') {
        approxStorageChars = localStorage.getItem(`cached_list_${userId}_${listId}`)?.length ?? 0
      }
    } catch {
      // ignore
    }
    const cachedData = getCachedList(userId, listId)
    const cachedPrefs = getCachedPrefs(listId, userId)
    const itemCount = (cachedData?.items || []).length
    perfLog('localStorage read end', {
      durationMs: Math.round(performance.now() - lsT0),
      listCount: cachedData?.list ? 1 : 0,
      itemCount,
      approxStorageChars,
    })

    if (userId && listId) {
      useListDataStore.getState().beginListSession(userId, listId, cachedData)
    } else {
      useListDataStore.getState().clearActiveListData()
    }
    setMemberFilter(cachedPrefs.memberFilter)
    setItemNameFontStep(cachedPrefs.itemNameFontStep)
    const parsed = parseWidthValue(cachedPrefs.itemTextWidth)
    setItemTextWidthMode(parsed.mode)
    setItemTextWidth(parsed.width)
    setCategoryNames(parseCategoryNames(cachedData?.list?.category_names))
    setCategoryOrder(parseCategoryOrder(cachedData?.list?.category_order))
    setSumScope(parseListUserSumScope(cachedPrefs.sumScope))
    setLoading(!!userId && !cachedData?.list)
    setHasCompletedInitialFetch(false)
    hasInitialDataRef.current = !!cachedData?.list
    prefsFetchedRef.current = false
  }, [listId, userId])

  useEffect(() => {
    if (!userId || !listId) return
    void warmListData(userId, listId)
    const unsub = subscribeListDataL2Bridge(userId, listId)
    return () => {
      unsub()
    }
  }, [userId, listId])

  useEffect(() => {
    if (!userId || !listId) return
    return () => {
      void markListViewedLocally(userId, listId)
    }
  }, [userId, listId])

  /** Apply `list_users` prefs from the Dexie-backed Zustand mirror before paint (avoids font/prefs flash after gate). */
  useLayoutEffect(() => {
    if (!userId || !listId || !prefsMirrorReady) return
    const dexiePrefs = mirroredListUserRow
    if (!dexiePrefs) {
      setMemberFilter('all')
      setItemTextWidthMode('auto')
      setItemTextWidth(ITEM_TEXT_WIDTH_MIN)
      itemNameFontStepRef.current = ITEM_NAME_FONT_DEFAULT
      setItemNameFontStep(ITEM_NAME_FONT_DEFAULT)
      setLastViewedMembers(null)
      setSumScope('none')
      return
    }
    const dexieFilter = VALID_MEMBER_FILTERS.includes(dexiePrefs.member_filter as MemberFilter)
      ? (dexiePrefs.member_filter as MemberFilter)
      : ('all' as MemberFilter)
    const parsed = parseWidthValue(dexiePrefs.item_text_width)
    setMemberFilter(dexieFilter)
    setItemTextWidthMode(parsed.mode)
    if (parsed.mode === 'manual') {
      setItemTextWidth(parsed.width)
    }
    const dexieFontStep = parseItemNameFontStep(dexiePrefs.item_name_font_step)
    itemNameFontStepRef.current = dexieFontStep
    setItemNameFontStep(dexieFontStep)
    setLastViewedMembers(dexiePrefs.last_viewed_members ?? null)
    setSumScope(parseListUserSumScope(dexiePrefs.sum_scope))
  }, [listId, userId, prefsMirrorReady, mirroredListUserRow])

  const sessionMirrorReady = useMemo(
    () => !userId || !listId || (listDataStatus === 'ready' && prefsMirrorReady),
    [userId, listId, listDataStatus, prefsMirrorReady],
  )

  const trackSaveOperation = useCallback(async <T>(operation: PromiseLike<T>): Promise<T> => {
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
  }, [beginServerWork, endServerWork])

  const setLocalMemberState = (itemId: string, memberId: string, nextState: ItemMemberState | null) => {
    useListDataStore.getState().setItems((prev) => prev.map((item) => {
      if (item.id !== itemId) return item

      const memberStates = { ...item.memberStates }
      if (nextState) {
        memberStates[memberId] = nextState
      } else {
        delete memberStates[memberId]
      }

      return {
        ...item,
        memberStates,
      }
    }))
  }

  const fetchList = useCallback(async (options?: { staleCheckVersion?: number | null }) => {
    const staleCheck = options?.staleCheckVersion
    let staleDiscarded = false
    let connectivityDiscarded = false
    let listMirrorLockHeld = false

    if (!userId || !listId) {
      perfLog('fetchList start', { note: 'no user or list' })
      useListDataStore.getState().setList(null)
      useListDataStore.getState().setItems([])
      useListDataStore.getState().setMembers([])
      setLoading(false)
      setIsFetching(false)
      setHasCompletedInitialFetch(true)
      perfLog('fetchList end', { durationMs: 0, listCount: 0, itemCount: 0 })
      return
    }

    // Not online: hydrate from Dexie + L1 only (may run while a stale server read is still in flight).
    if (!canFetchFromServer(connectivityStatus)) {
      const ownedFetch = !fetchingRef.current
      if (ownedFetch) {
        fetchingRef.current = true
        setIsFetching(true)
        setFetchTimedOut(false)
      }
      setError(null)
      appendOfflineNavDiagnostic(
        `[fetchList] dexie-only status=${connectivityStatus} listId=${listId} ownedFetch=${ownedFetch ? 1 : 0}`,
      )
      if (
        !(await waitForListMirrorLock(listId, LIST_MIRROR_SESSION_OWNER, { maxWaitMs: 5_000, pollMs: 80 }))
      ) {
        if (ownedFetch) {
          fetchingRef.current = false
          setIsFetching(false)
        }
        appendOfflineNavDiagnostic(`[fetchList] dexie deferred — mirror lock busy listId=${listId}`)
        queueMicrotask(() => void fetchList(options))
        return
      }
      listMirrorLockHeld = true
      let hadList = false
      try {
        await warmListData(userId, listId)
        const st = useListDataStore.getState()
        if (st.activeUserId === userId && st.activeListId === listId && st.list) {
          hadList = true
          hadAccessRef.current = true
          hasInitialDataRef.current = true
          setCategoryNames(parseCategoryNames(st.list.category_names))
          setCategoryOrder(parseCategoryOrder(st.list.category_order))
          setCachedList(userId, listId, { list: st.list, items: st.items, members: st.members })
        } else {
          const fromLs = getCachedList(userId, listId)
          if (fromLs?.list) {
            useListDataStore.getState().setList(fromLs.list)
            useListDataStore.getState().setItems(fromLs.items)
            useListDataStore.getState().setMembers(fromLs.members)
            hadList = true
            hadAccessRef.current = true
            hasInitialDataRef.current = true
            setCategoryNames(parseCategoryNames(fromLs.list.category_names))
            setCategoryOrder(parseCategoryOrder(fromLs.list.category_order))
          } else {
            setError(
              'This list is not on this device yet. Open it online once to use it offline.',
            )
          }
        }
      } finally {
        if (listMirrorLockHeld) {
          await releaseListMirrorLock(listId, LIST_MIRROR_SESSION_OWNER)
          listMirrorLockHeld = false
        }
        if (ownedFetch) {
          setFetchTimedOut(false)
          setLoading(false)
          setIsFetching(false)
          setHasCompletedInitialFetch(true)
          fetchingRef.current = false
          setItemsUntilReconnectReconciled(null)
        }
        appendOfflineNavDiagnostic(
          `[fetchList] dexie-only finished listId=${listId} hadList=${hadList ? 1 : 0}`,
        )
      }
      return
    }

    if (fetchingRef.current) {
      appendOfflineNavDiagnostic(`[fetchList] skipped listId=${listId} (already fetching)`)
      return
    }
    if (
      !(await waitForListMirrorLock(listId, LIST_MIRROR_SESSION_OWNER, { maxWaitMs: 5_000, pollMs: 80 }))
    ) {
      appendOfflineNavDiagnostic(`[fetchList] deferred — list mirror lock busy listId=${listId}`)
      queueMicrotask(() => void fetchList(options))
      return
    }
    listMirrorLockHeld = true
    const fetchT0 = performance.now()
    let serverDetailLogged = false
    let parallelT0 = 0
    let rpcDurationMs = 0
    let prefsDurationMs: number | null = null
    perfLog('fetchList start', { listId })
    let listCount = 0
    let itemCountResult = 0
    let fetchErr: string | undefined
    fetchingRef.current = true
    setIsFetching(true)
    setFetchTimedOut(false)

    appendOfflineNavDiagnostic(
      `[fetchList] start listId=${listId} navigator.onLine=${typeof navigator !== 'undefined' && navigator.onLine ? 1 : 0} hadCachedListRow=${getCachedList(userId, listId)?.list ? 1 : 0}`,
    )

    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current)
    fetchTimeoutRef.current = setTimeout(() => {
      if (fetchingRef.current) {
        setFetchTimedOut(true)
      }
    }, FETCH_TIMEOUT_MS)

    setError(null)

    beginServerWork()
    const readFlightGen = captureReadFlightGeneration()
    let serverOutcome: ServerWorkOutcome = 'success'
    try {
      appendOfflineNavDiagnostic(
        `[fetchList] invoking get_list_data + list_users prefs in parallel listId=${listId}`,
      )
      const willFetchPrefs = !prefsFetchedRef.current
      parallelT0 = performance.now()

      const rpcPromise = (async () => {
        const rpcT0 = performance.now()
        appendOfflineNavDiagnostic(`[db-read] target=supabase rpc=get_list_data action=start listId=${listId}`)
        let data: Awaited<ReturnType<typeof supabase.rpc<'get_list_data'>>>['data']
        let rpcError: Awaited<ReturnType<typeof supabase.rpc<'get_list_data'>>>['error']
        try {
          const r = await supabase.rpc('get_list_data', {
            p_list_id: listId,
          })
          data = r.data
          rpcError = r.error
        } finally {
          rpcDurationMs = Math.round(performance.now() - rpcT0)
          appendOfflineNavDiagnostic(
            `[db-read] target=supabase rpc=get_list_data action=end listId=${listId} durationMs=${rpcDurationMs}`,
          )
        }
        perfLog('fetchList get_list_data', {
          listId,
          durationMs: rpcDurationMs,
          ok: !rpcError,
          code: rpcError?.code ?? null,
          errMsg: rpcError?.message ? String(rpcError.message).slice(0, 120) : null,
          hasListRow: !!(data && data.list),
          itemCount: data?.items?.length ?? 0,
          memberCount: data?.members?.length ?? 0,
        })
        return { data, rpcError }
      })()

      const prefsPromise = (async () => {
        if (!willFetchPrefs) {
          perfLog('fetchList list_users prefs skip', { listId, reason: 'already_fetched' })
          return { listUserData: null }
        }
        perfLog('fetchList list_users prefs start', { listId })
        appendOfflineNavDiagnostic(`[db-read] target=supabase table=list_users action=start listId=${listId}`)
        prefsFetchedRef.current = true
        const prefsT0 = performance.now()
        const { data: listUserData } = await supabase
          .from('list_users')
          .select(
            'member_filter, item_text_width, last_viewed_members, last_viewed, item_name_font_step, sum_scope',
          )
          .eq('list_id', listId)
          .eq('user_id', userId)
          .single()
        prefsDurationMs = Math.round(performance.now() - prefsT0)
        perfLog('fetchList list_users prefs end', {
          listId,
          durationMs: prefsDurationMs,
          hasRow: !!listUserData,
        })
        appendOfflineNavDiagnostic(
          `[db-read] target=supabase table=list_users action=end listId=${listId} durationMs=${prefsDurationMs ?? 'n/a'} hasRow=${listUserData ? 1 : 0}`,
        )
        return { listUserData }
      })()

      const [{ data, rpcError }, { listUserData }] = await Promise.all([rpcPromise, prefsPromise])
      pulseServerWorkProgress()
      perfLog('fetchList parallel await', {
        listId,
        wallMs: Math.round(performance.now() - parallelT0),
        rpcDurationMs,
        prefsDurationMs,
      })

      if (shouldDiscardReadFlightResult(readFlightGen)) {
        connectivityDiscarded = true
        appendOfflineNavDiagnostic(
          `[fetchList] connectivity-discard listId=${listId} status=${connectivityStatusRef.current}`,
        )
        logServerRoundTrip({
          description: `Fetched list ${formatQuotedListName(data?.list?.name, listId)} (${data?.items?.length ?? 0} items, ${data?.members?.length ?? 0} members)`,
          ok: true,
          durationMs: rpcDurationMs,
          respondsTo: 'Open list · get_list_data (discarded: not online)',
        })
        serverOutcome = 'success'
        return
      }

      const staleNow = staleCheck != null && staleCheck !== mutationVersionRef.current
      const listTitleForLog = formatQuotedListName(data?.list?.name, listId)
      logServerRoundTrip({
        description: `Fetched list ${listTitleForLog} (${data?.items?.length ?? 0} items, ${data?.members?.length ?? 0} members)`,
        ok: !rpcError && !!(data?.list),
        durationMs: rpcDurationMs,
        respondsTo: staleNow
          ? 'Open list · get_list_data (discarded: newer local edits)'
          : 'Open list · get_list_data',
        failure: rpcError?.message ?? (!data?.list && !rpcError ? 'Missing list payload' : undefined),
      })
      if (willFetchPrefs && !rpcError) {
        logServerRoundTrip({
          description: `Fetched list preferences for ${listTitleForLog}`,
          ok: true,
          durationMs: prefsDurationMs ?? 0,
          respondsTo: staleNow
            ? 'Open list · list_users (page may discard)'
            : 'Open list · list_users',
        })
      }
      serverDetailLogged = true

      if (rpcError) {
        // If we previously had access but now get an error, access was revoked
        if (hadAccessRef.current && (rpcError.code === 'P0001' || rpcError.message?.includes('Access denied'))) {
          setAccessDenied(true)
          serverOutcome = 'application_error'
          return
        }
        throw rpcError
      }

      if (!data || !data.list) {
        if (hadAccessRef.current) {
          setAccessDenied(true)
          serverOutcome = 'application_error'
          return
        }
        throw new Error('List not found')
      }

      if (isTombstoned(data.list.deleted_at ?? null)) {
        if (hadAccessRef.current) {
          setAccessDenied(true)
          serverOutcome = 'application_error'
          return
        }
        throw new Error('List not found')
      }

      if (staleNow) {
        staleDiscarded = true
        perfLog('fetchList stale_discard', {
          listId,
          rpcDurationMs,
          capturedVersion: staleCheck,
          mutationVersion: mutationVersionRef.current,
        })
        return
      }

      const serverMembers = (data.members || []).filter((m) => !isTombstoned(m.deleted_at ?? null))
      const nextItems = normalizeItemsCategory(
        (data.items || []).filter((i) => !isTombstoned(i.deleted_at ?? null)),
      )
      const differsFromDexie = await serverListDetailDiffersFromDexie(userId, listId, {
        list: data.list,
        items: nextItems,
        members: serverMembers,
      })
      appendMutationDiagnostic(
        `[fetchList] get_list_data vs_dexie listId=${listId} diff=${differsFromDexie ? 1 : 0} items=${nextItems.length} members=${serverMembers.length}`,
      )

      // Mark that we have access
      hadAccessRef.current = true
      useListDataStore.getState().setList((prev) => replaceListPreservingClientMirror(prev, data.list))
      const pendingMutations = await db.sync_queue
        .filter(
          (m) =>
            (m.parent1_type === 'list' && m.parent1_id === listId) ||
            String((m.payload as { list_id?: string }).list_id ?? '') === listId,
        )
        .toArray()
      const pendingCreates: Array<{ itemKey: string; payload: Record<string, unknown> }> = []
      for (const m of pendingMutations) {
        if (m.kind === 'create' && m.entity === 'item') {
          pendingCreates.push({ itemKey: m.entity_id, payload: m.payload as Record<string, unknown> })
        }
        if (m.kind === 'rpc') {
          const p = m.payload as { method?: string; items?: Array<Record<string, unknown> & { id?: string }> }
          if (p.method === 'bulkAddListItems' && Array.isArray(p.items)) {
            for (const it of p.items) {
              if (it.id) pendingCreates.push({ itemKey: it.id, payload: it })
            }
          }
        }
      }
      const pendingMemberIds = new Set<string>()
      for (const m of pendingMutations) {
        if (m.entity !== 'member') continue
        if (m.kind === 'create') {
          const id = String((m.payload as { id?: string }).id ?? m.entity_id)
          if (id) pendingMemberIds.add(id)
          continue
        }
        if (m.kind === 'patch') {
          const memberId = String((m.payload as { memberId?: string }).memberId ?? m.entity_id ?? '')
          if (memberId) pendingMemberIds.add(memberId)
        }
      }

      let mergedItemsForCache = nextItems
      let mergedMembersForCache = serverMembers

      useListDataStore.getState().setItems((prev) => {
        mergedItemsForCache = mergePendingItemCreatesIntoServerItems(nextItems, prev, pendingCreates)
        return mergedItemsForCache
      })
      useListDataStore.getState().setMembers((prev) => {
        mergedMembersForCache = mergePendingMembersIntoServerMembers(serverMembers, prev, pendingMemberIds)
        return mergedMembersForCache
      })
      setCategoryNames(parseCategoryNames(data.list.category_names))
      setCategoryOrder(parseCategoryOrder(data.list.category_order))
      hasInitialDataRef.current = true

      // Cache the list data for instant load next time
      setCachedList(userId, listId, {
        list: data.list,
        items: mergedItemsForCache,
        members: mergedMembersForCache,
      })
      await upsertListDataPayloadFromServer(userId, listId, {
        list: data.list,
        items: mergedItemsForCache,
        members: mergedMembersForCache,
      })
      await setLastMirroredListDetailVersion(listId, data.list.version ?? 1, data.list.last_content_update ?? null)
      listCount = 1
      itemCountResult = mergedItemsForCache.length

      if (listUserData) {
        void upsertListPrefsFromServer(userId, listId, listUserData)
        const serverFilter = VALID_MEMBER_FILTERS.includes(listUserData.member_filter as MemberFilter)
          ? listUserData.member_filter as MemberFilter
          : 'all' as MemberFilter
        setMemberFilter(serverFilter)
        setCachedPrefs(listId, { memberFilter: serverFilter }, userId)
        const serverVal = listUserData.item_text_width
        const parsed = parseWidthValue(serverVal)
        setItemTextWidthMode(parsed.mode)
        setCachedPrefs(listId, { itemTextWidth: serverVal ?? 'auto' }, userId)
        if (parsed.mode === 'manual') {
          setItemTextWidth(parsed.width)
        }
        const serverFontStep = parseItemNameFontStep(listUserData.item_name_font_step)
        itemNameFontStepRef.current = serverFontStep
        setItemNameFontStep(serverFontStep)
        setCachedPrefs(listId, { itemNameFontStep: serverFontStep }, userId)
        setLastViewedMembers(listUserData.last_viewed_members ?? null)
        const serverSumScope = parseListUserSumScope(listUserData.sum_scope)
        setSumScope(serverSumScope)
        setCachedPrefs(listId, { sumScope: serverSumScope }, userId)
      }
      setFetchTimedOut(false)
      appendOfflineNavDiagnostic(
        `[fetchList] RPC success listId=${listId} items=${(data.items || []).length} members=${(data.members || []).length}`,
      )
      serverOutcome = 'success'
    } catch (err) {
      serverOutcome = isLikelyConnectivityError(err) ? 'connectivity_failure' : 'application_error'
      if (serverOutcome === 'connectivity_failure' && connectivityStatusRef.current === 'online') {
        reportConnectivityFailure('fetchList-connectivity-error')
      }
      fetchErr = rpcFailureMessage(err)
      setError(rpcFailureMessage(err))
      appendOfflineNavDiagnostic(
        `[fetchList] catch listId=${listId} connectivity-ish=${isLikelyConnectivityError(err) ? 1 : 0} msg=${fetchErr}`,
      )
      if (!serverDetailLogged) {
        logServerRoundTrip({
          description: `Fetched list ${formatQuotedListName(null, listId)}`,
          ok: false,
          durationMs: Math.round(performance.now() - fetchT0),
          respondsTo: 'Open list page',
          failure: err,
        })
      }
    } finally {
      if (listMirrorLockHeld) {
        await releaseListMirrorLock(listId, LIST_MIRROR_SESSION_OWNER)
        listMirrorLockHeld = false
      }
      endServerWork(serverOutcome)
      perfLog('fetchList end', {
        durationMs: Math.round(performance.now() - fetchT0),
        rpcDurationMs,
        prefsDurationMs,
        listCount,
        itemCount: itemCountResult,
        error: fetchErr,
        staleDiscarded,
        connectivityDiscarded,
        listId,
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
      if (connectivityDiscarded && !canFetchFromServer(connectivityStatusRef.current)) {
        queueMicrotask(() => {
          void fetchList()
        })
      }
      appendOfflineNavDiagnostic(
        [
          `[fetchList] finally listId=${listId} totalMs=${Math.round(performance.now() - fetchT0)}`,
          `rpcMs=${rpcDurationMs} prefsMs=${prefsDurationMs == null ? 'n/a' : String(prefsDurationMs)}`,
          `fetchErr=${fetchErr ?? '(none)'}`,
        ].join(' '),
      )
      setItemsUntilReconnectReconciled(null)
    }
  }, [
    beginServerWork,
    connectivityStatus,
    endServerWork,
    listId,
    pulseServerWorkProgress,
    userId,
  ])

  const isInitialSyncing = isFetching && !hasCompletedInitialFetch && !!list

  const refreshList = useCallback(() => {
    void fetchList()
  }, [fetchList])

  // Initial fetch
  useEffect(() => {
    fetchList()
  }, [fetchList])

  // Keep local cache in sync with optimistic updates too.
  useEffect(() => {
    if (!list) return
    setCachedList(userId, listId, { list, items, members })
    if (userId) {
      void upsertListDataPayloadFromServer(userId, listId, { list, items, members })
    }
  }, [userId, listId, list, items, members])

  useEffect(() => {
    if (!accessDenied) return
    removeCachedList(userId, listId)
    void clearSyncQueueForList(listId)
    if (userId) {
      void db.transaction('rw', db.items, db.members, db.item_member_state, db.list_users, async () => {
        const listUser = await db.list_users.where('[list_id+user_id]').equals([listId, userId]).first()
        if (listUser) await db.list_users.delete(listUser.id)
        const itemsToDelete = await db.items.where('list_id').equals(listId).toArray()
        const membersToDelete = await db.members.where('list_id').equals(listId).toArray()
        const imsToDelete = await db.item_member_state
          .where('[list_id+item_id]')
          .between([listId, Dexie.minKey], [listId, Dexie.maxKey])
          .toArray()
        for (const row of itemsToDelete) await db.items.delete(row.id)
        for (const row of membersToDelete) await db.members.delete(row.id)
        for (const ims of imsToDelete) await db.item_member_state.delete(ims.id)
      })
    }
  }, [accessDenied, userId, listId])

  // Real-time subscriptions
  useEffect(() => {
    if (!userId || !listId) return

    const scheduleRealtimeFetch = (delayMs: number) => {
      if (realtimeScheduleCaptureVersionRef.current === null) {
        realtimeScheduleCaptureVersionRef.current = mutationVersionRef.current
      }

      if (realtimeDebounceRef.current) {
        clearTimeout(realtimeDebounceRef.current)
      }

      realtimeDebounceRef.current = setTimeout(() => {
        realtimeDebounceRef.current = null

        if (fetchingRef.current) {
          pendingRealtimeRef.current = true
          scheduleRealtimeFetch(250)
          return
        }

        const remainingSkipMs = skipRealtimeUntilRef.current - Date.now()
        if (remainingSkipMs > 0) {
          pendingRealtimeRef.current = true
          scheduleRealtimeFetch(remainingSkipMs)
          return
        }

        pendingRealtimeRef.current = false
        const cap = realtimeScheduleCaptureVersionRef.current
        if (cap == null) {
          void fetchList()
        } else {
          void fetchList({ staleCheckVersion: cap })
        }
      }, Math.max(delayMs, 0))
    }

    scheduleRealtimeFetchRef.current = scheduleRealtimeFetch

    const handleRealtimeChange = () => {
      if (fetchingRef.current) {
        pendingRealtimeRef.current = true
        scheduleRealtimeFetch(250)
        return
      }

      const remainingSkipMs = skipRealtimeUntilRef.current - Date.now()
      if (remainingSkipMs > 0) {
        pendingRealtimeRef.current = true
        scheduleRealtimeFetch(remainingSkipMs)
        return
      }

      void fetchList({ staleCheckVersion: mutationVersionRef.current })
    }

    const subscribeT0 = performance.now()
    perfLog('realtime subscribe start', { listId })
    let subscribeEndLogged = false
    const logRealtimeSubscribeEnd = (extra: Record<string, unknown> = {}) => {
      if (subscribeEndLogged) return
      subscribeEndLogged = true
      perfLog('realtime subscribe end', {
        durationMs: Math.round(performance.now() - subscribeT0),
        listId,
        ...extra,
      })
    }

    const channel = supabase
      .channel(`list-${listId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lists', filter: `id=eq.${listId}` },
        handleRealtimeChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'items', filter: `list_id=eq.${listId}` },
        handleRealtimeChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'members', filter: `list_id=eq.${listId}` },
        handleRealtimeChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'list_users', filter: `list_id=eq.${listId}` },
        (payload) => {
          const oldRow = payload.old as Database['public']['Tables']['list_users']['Row'] | null

          // If our own membership was deleted, leave the page immediately.
          if (payload.eventType === 'DELETE' && oldRow?.user_id === userId) {
            setAccessDenied(true)
            return
          }

          handleRealtimeChange()
        }
      )
      .on(
        'broadcast',
        { event: 'item_updated' },
        handleRealtimeChange
      )
      .on(
        'broadcast',
        { event: 'item_deleted' },
        handleRealtimeChange
      )
      .on(
        'broadcast',
        { event: 'member_added' },
        handleRealtimeChange
      )
      .on(
        'broadcast',
        { event: 'member_deleted' },
        handleRealtimeChange
      )
      .on(
        'broadcast',
        { event: 'member_updated' },
        handleRealtimeChange
      )
      .on(
        'broadcast',
        { event: 'member_state_updated' },
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
      if (realtimeDebounceRef.current) {
        clearTimeout(realtimeDebounceRef.current)
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
    }
  }, [fetchList, listId, userId])

  const addItem = async (text: string, category?: number, comment?: string | null) => {
    if (!userId) {
      return { data: null, error: { message: 'Not authenticated' } }
    }
    if (!tryBeginItemQueueableMutation()) {
      return { data: null, error: { message: blockedMutationMessage() } }
    }
    const id = crypto.randomUUID()
    const t = isoNow()
    const cat = normalizeItemCategory(category ?? 1)
    const sortOrder = nextItemSortOrdersAfterExisting(useListDataStore.getState().items, 1)[0]!
    const base = {
      id,
      list_id: listId,
      text,
      category: cat,
      comment: comment ?? null,
      archived: false,
      archived_at: null,
      sort_order: sortOrder,
      ...syncFieldsForLocalInsert({ client_created_at: t }),
      updated_at: t,
    }
    const sync = normalizeServerSyncableFields(base as unknown as Record<string, unknown>)
    const optimistic: ItemWithState = {
      ...(normalizeItemsCategory([{ ...base, ...sync } as ItemWithState])[0]),
      memberStates: {},
    }
    useListDataStore.getState().beginLocalListPersistence()
    try {
      useListDataStore.getState().setItems((prev) => [...prev, optimistic])
      await addItemMutation({
        user_id: userId,
        list_id: listId,
        text,
        category: cat,
        id,
        sort_order: sortOrder,
      })
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      await markCurrentListViewed(t)
      persistListSnapshotToDetailCache(userId, listId)
      return { data: { id } as Item, error: null }
    } catch (error) {
      useListDataStore.getState().setItems((prev) => prev.filter((i) => i.id !== id))
      return { data: null, error: { message: rpcFailureMessage(error) } }
    } finally {
      useListDataStore.getState().endLocalListPersistence()
      mutationGate.end()
    }
  }

  const MAX_BULK_ADD_LINES = 500

  const addItemsBulk = async (lines: string[], category: number) => {
    const trimmed = lines.map(l => l.trim()).filter(l => l.length > 0)
    if (trimmed.length === 0) {
      return { error: null as { message?: string; code?: string } | null, inserted: 0 }
    }
    if (trimmed.length > MAX_BULK_ADD_LINES) {
      return {
        error: { message: `Too many lines (max ${MAX_BULK_ADD_LINES})` },
        inserted: 0,
      }
    }
    const bulkDup = await validateBulkItemLinesUniqueness(listId, trimmed)
    if (!bulkDup.ok) {
      return { error: { message: bulkDup.message }, inserted: 0 }
    }
    if (!userId) {
      return { error: { message: 'Not authenticated' }, inserted: 0 }
    }
    if (!tryBeginItemQueueableMutation()) {
      return { error: { message: blockedMutationMessage() }, inserted: 0 }
    }
    try {
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Math.max(skipRealtimeUntilRef.current, Date.now() + 2000)
      const cat = normalizeItemCategory(category)
      const t = isoNow()
      const sortOrders = nextItemSortOrdersAfterExisting(useListDataStore.getState().items, trimmed.length)
      const rows: DbItemRow[] = trimmed.map((text, i) => {
        const base = {
          id: crypto.randomUUID(),
          list_id: listId,
          text,
          category: cat,
          comment: null,
          archived: false,
          archived_at: null,
          sort_order: sortOrders[i]!,
          ...syncFieldsForLocalInsert({ client_created_at: t }),
          updated_at: t,
        }
        const sync = normalizeServerSyncableFields(base as unknown as Record<string, unknown>)
        return { ...base, ...sync }
      })
      const optimisticRows: ItemWithState[] = normalizeItemsCategory(
        rows.map((r) => ({ ...r, memberStates: {} } as ItemWithState)),
      )
      const rollbackIds = new Set(rows.map((r) => r.id))
      useListDataStore.getState().beginLocalListPersistence()
      try {
        useListDataStore.getState().setItems((prev) => [...prev, ...optimisticRows])
        await db.transaction('rw', db.items, db.lists, db.sync_queue, db.list_users, async () => {
          await db.items.bulkAdd(rows)
          await enqueueSyncQueueRecord({
            entity: 'list',
            entity_id: newBatchEntityId(),
            kind: 'rpc',
            payload: {
              method: 'bulkAddListItems',
              list_id: listId,
              category: cat,
              lines: trimmed,
              items: rows.map((r) => ({ ...r })),
            },
            ...listQueueParent(listId),
            status: 'queued',
          })
        })
        await markCurrentListViewed(t)
        persistListSnapshotToDetailCache(userId, listId)
        return { error: null, inserted: trimmed.length }
      } catch (error) {
        useListDataStore.getState().setItems((prev) => prev.filter((i) => !rollbackIds.has(i.id)))
        return { error: { message: rpcFailureMessage(error) }, inserted: 0 }
      } finally {
        useListDataStore.getState().endLocalListPersistence()
      }
    } finally {
      mutationGate.end()
    }
  }

  const updateItem = async (itemId: string, updates: Partial<Item>) => {
    const previousItem = items.find((item) => item.id === itemId)
    if (!userId) {
      return { error: { message: 'Not authenticated' } }
    }
    if (!tryBeginItemQueueableMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    const persistedUpdates = { ...updates }
    if (persistedUpdates.text !== undefined) {
      const textTrimmed = String(persistedUpdates.text).trim()
      if (textTrimmed) {
        const textDup = await validateSingleNewItemTextUniqueness(listId, textTrimmed, itemId)
        if (!textDup.ok) {
          mutationGate.end()
          return { error: { message: textDup.message } }
        }
      }
      persistedUpdates.text = textTrimmed
    }
    const nowMs = Date.now()
    const nowIso = new Date(nowMs).toISOString()
    const dbPatch: Partial<Item> & { updated_at: string } = { updated_at: nowIso }
    if (persistedUpdates.text !== undefined) dbPatch.text = persistedUpdates.text
    if (persistedUpdates.comment !== undefined) dbPatch.comment = persistedUpdates.comment
    if (persistedUpdates.category !== undefined) dbPatch.category = persistedUpdates.category
    if (persistedUpdates.archived !== undefined) dbPatch.archived = persistedUpdates.archived
    if (persistedUpdates.archived_at !== undefined) dbPatch.archived_at = persistedUpdates.archived_at
    if (persistedUpdates.sort_order !== undefined) dbPatch.sort_order = persistedUpdates.sort_order

    const rollbackItem =
      previousItem != null
        ? {
            ...previousItem,
            memberStates: { ...previousItem.memberStates },
          }
        : null

    useListDataStore.getState().beginLocalListPersistence()
    try {
      useListDataStore.getState().setItems((prev) =>
        prev.map((item) =>
          item.id !== itemId
            ? item
            : {
                ...item,
                ...dbPatch,
              },
        ),
      )

      await db.transaction('rw', db.items, db.lists, db.sync_queue, db.list_users, async () => {
        await db.items.update(itemId, dbPatch)
        const payload: Record<string, unknown> = { id: itemId }
        if (persistedUpdates.text !== undefined) payload.text = persistedUpdates.text
        if (persistedUpdates.comment !== undefined) payload.comment = persistedUpdates.comment
        if (persistedUpdates.category !== undefined) payload.category = persistedUpdates.category
        if (persistedUpdates.archived !== undefined) payload.archived = persistedUpdates.archived
        if (persistedUpdates.archived_at !== undefined) payload.archived_at = persistedUpdates.archived_at
        if (persistedUpdates.sort_order !== undefined) payload.sort_order = persistedUpdates.sort_order
        await enqueueSyncQueueRecord({
          entity: 'item',
          entity_id: itemId,
          kind: 'patch',
          payload,
          ...listQueueParent(listId),
          status: 'queued',
        })
      })

      const becameArchived = previousItem && !previousItem.archived && persistedUpdates.archived === true
      if (becameArchived) {
        if (archiveUndoToastIdRef.current) dismissToast(archiveUndoToastIdRef.current)
        const label =
          previousItem.text.length > 48 ? `${previousItem.text.slice(0, 45)}...` : previousItem.text
        const toastId = showToast(`Archived "${label}"`, 'info', {
          durationMs: 8000,
          action: {
            label: 'Undo',
            onClick: () => {
              dismissToast(toastId)
              if (archiveUndoToastIdRef.current === toastId) archiveUndoToastIdRef.current = null
              void updateItemRef.current(itemId, { archived: false, archived_at: null }).then(({ error: undoErr }) => {
                if (undoErr?.message) showErrorToast(undoErr.message)
              })
            },
          },
        })
        archiveUndoToastIdRef.current = toastId
      }

      mutationVersionRef.current += 1
      const skipMs = persistedUpdates.category !== undefined ? 4500 : 2000
      skipRealtimeUntilRef.current = Math.max(skipRealtimeUntilRef.current, Date.now() + skipMs)
      await markCurrentListViewed(nowIso)
      return { error: null }
    } catch (error) {
      if (rollbackItem) {
        useListDataStore.getState().setItems((prev) =>
          prev.map((it) => (it.id === itemId ? { ...rollbackItem, memberStates: { ...rollbackItem.memberStates } } : it)),
        )
      }
      return { error: { message: rpcFailureMessage(error) } }
    } finally {
      useListDataStore.getState().endLocalListPersistence()
      mutationGate.end()
    }
  }

  updateItemRef.current = updateItem

  const deleteItem = async (itemId: string) => {
    if (!userId) {
      return { error: new Error('Not authenticated') }
    }
    if (!tryBeginItemQueueableMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    const itemsSnapshot = [...useListDataStore.getState().items]
    useListDataStore.getState().beginLocalListPersistence()
    try {
      useListDataStore.getState().setItems((prev) => prev.filter((i) => i.id !== itemId))
      await softDeleteItemMutation(userId, listId, itemId)
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      delete desiredArchivedByItemRef.current[itemId]
      await markCurrentListViewed()
      return { error: null }
    } catch (error) {
      useListDataStore.getState().setItems(itemsSnapshot)
      return { error: new Error(rpcFailureMessage(error)) }
    } finally {
      useListDataStore.getState().endLocalListPersistence()
      mutationGate.end()
    }
  }

  const addMember = async (name: string, creatorNickname?: string) => {
    if (isOfflineActionsDisabled) {
      return { error: { message: blockedMutationMessage() } }
    }
    if (!userId) return { error: new Error('Not authenticated') }
    if (!tryBeginItemQueueableMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    const memberId = crypto.randomUUID()
    const t = isoNow()
    const sortOrder = nextMemberSortOrdersAfterExisting(useListDataStore.getState().members, 1)[0]!
    const sync = syncFieldsForLocalInsert({ client_created_at: t })
    const optimistic: MemberWithCreator = {
      id: memberId,
      list_id: listId,
      name,
      created_by: userId,
      sort_order: sortOrder,
      is_public: false,
      is_target: false,
      ...sync,
      updated_at: t,
      creator: creatorNickname ? { nickname: creatorNickname } : null,
    }
    useListDataStore.getState().beginLocalListPersistence()
    try {
      useListDataStore.getState().setMembers((prev) => [...prev, optimistic])
      await addMemberMutation({
        id: memberId,
        user_id: userId,
        list_id: listId,
        name,
        sort_order: sortOrder,
      })
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      await markCurrentListViewed(t)
      return { data: { id: memberId, creator: creatorNickname ? { nickname: creatorNickname } : null }, error: null }
    } catch (error) {
      useListDataStore.getState().setMembers((prev) => prev.filter((m) => m.id !== memberId))
      return { data: null, error: { message: rpcFailureMessage(error) } }
    } finally {
      useListDataStore.getState().endLocalListPersistence()
      mutationGate.end()
    }
  }

  const updateMember = async (memberId: string, updates: Partial<Member>) => {
    if (!userId) return { error: { message: 'Not authenticated' } }
    if (!tryBeginItemQueueableMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    const normalizedMemberUpdates: Partial<Member> = { ...updates }
    if (normalizedMemberUpdates.name !== undefined) {
      const nameTrimmed = String(normalizedMemberUpdates.name).trim()
      if (!nameTrimmed) {
        mutationGate.end()
        return { error: { message: 'Member name cannot be empty.' } }
      }
      const memberDup = await validateMemberNameForList(listId, nameTrimmed, memberId)
      if (!memberDup.ok) {
        mutationGate.end()
        return { error: { message: memberDup.message } }
      }
      normalizedMemberUpdates.name = nameTrimmed
    }
    const membersSnapshot = [...useListDataStore.getState().members]
    const nowMs = Date.now()
    const nowIso = new Date(nowMs).toISOString()
    useListDataStore.getState().beginLocalListPersistence()
    try {
      useListDataStore.getState().setMembers((prev) =>
        prev.map((m) =>
          m.id !== memberId
            ? m
            : {
                ...m,
                ...normalizedMemberUpdates,
                updated_at: nowIso,
              },
        ),
      )
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      await db.transaction('rw', db.members, db.lists, db.sync_queue, db.list_users, async () => {
        const memberPatch: Record<string, unknown> = { updated_at: nowIso }
        if (normalizedMemberUpdates.name !== undefined) memberPatch.name = normalizedMemberUpdates.name
        if (normalizedMemberUpdates.is_public !== undefined) memberPatch.is_public = normalizedMemberUpdates.is_public
        if (normalizedMemberUpdates.is_target !== undefined) memberPatch.is_target = normalizedMemberUpdates.is_target
        if (normalizedMemberUpdates.sort_order !== undefined) memberPatch.sort_order = normalizedMemberUpdates.sort_order
        await db.members.update(memberId, memberPatch)
        await enqueueSyncQueueRecord({
          entity: 'member',
          entity_id: memberId,
          kind: 'patch',
          payload: {
            memberId,
            ...(normalizedMemberUpdates.name !== undefined ? { name: normalizedMemberUpdates.name } : {}),
            ...(normalizedMemberUpdates.is_public !== undefined ? { is_public: normalizedMemberUpdates.is_public } : {}),
          },
          ...listQueueParent(listId),
          status: 'queued',
        })
      })
      await markCurrentListViewed(nowIso)
      return { error: null }
    } catch (error) {
      useListDataStore.getState().setMembers(membersSnapshot)
      return { error: { message: rpcFailureMessage(error) } }
    } finally {
      useListDataStore.getState().endLocalListPersistence()
      mutationGate.end()
    }
  }

  const deleteMember = async (memberId: string) => {
    if (!userId) return { error: { message: 'Not authenticated' } }
    if (!tryBeginItemQueueableMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    const itemsSnapshot = [...useListDataStore.getState().items]
    const membersSnapshot = [...useListDataStore.getState().members]
    const nowIso = isoNow()
    useListDataStore.getState().beginLocalListPersistence()
    try {
      useListDataStore.getState().setMembers((prev) => prev.filter((m) => m.id !== memberId))
      useListDataStore.getState().setItems((prev) =>
        prev.map((item) => {
          if (!item.memberStates[memberId]) return item
          const { [memberId]: _, ...rest } = item.memberStates
          return { ...item, memberStates: rest }
        }),
      )
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      await db.transaction('rw', [db.members, db.item_member_state, db.lists, db.sync_queue, db.list_users], async () => {
        const memberRow = await db.members.get(memberId)
        const renamedName = withDeletionNameSuffix(memberRow?.name ?? '')
        await db.members.update(memberId, {
          name: renamedName,
          deleted_at: nowIso,
          updated_at: nowIso,
        })
        const memberStates = await db.item_member_state
          .where('member_id')
          .equals(memberId)
          .toArray()
        for (const state of memberStates) {
          await db.item_member_state.update(state.id, {
            deleted_at: nowIso,
          })
        }
        await enqueueSyncQueueRecord({
          entity: 'member',
          entity_id: memberId,
          kind: 'delete',
          payload: { id: memberId },
          ...listQueueParent(listId),
          status: 'queued',
        })
      })
      await markCurrentListViewed(nowIso)
      return { error: null }
    } catch (error) {
      useListDataStore.getState().setItems(itemsSnapshot)
      useListDataStore.getState().setMembers(membersSnapshot)
      return { error: { message: rpcFailureMessage(error) } }
    } finally {
      useListDataStore.getState().endLocalListPersistence()
      mutationGate.end()
    }
  }

  const ownMember = async (memberId: string, creatorNickname?: string) => {
    if (!userId) return { error: { message: 'Not authenticated' } }
    if (!tryBeginItemQueueableMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    let membersSnapshot: MemberWithCreator[] | undefined
    try {
      const existing = members.find((m) => m.id === memberId)
      if (existing && existing.created_by === userId) {
        return { error: null, newMemberId: memberId }
      }
      membersSnapshot = [...useListDataStore.getState().members]
      const nowIso = isoNow()
      useListDataStore.getState().beginLocalListPersistence()
      try {
        useListDataStore.getState().setMembers((prev) =>
          prev.map((m) =>
            m.id === memberId
              ? {
                  ...m,
                  created_by: userId,
                  creator: creatorNickname ? { nickname: creatorNickname } : m.creator,
                  updated_at: nowIso,
                }
              : m,
          ),
        )
        await db.transaction('rw', db.members, db.lists, db.sync_queue, db.list_users, async () => {
          await db.members.update(memberId, {
            created_by: userId,
            updated_at: nowIso,
          })
          await enqueueSyncQueueRecord({
            entity: 'list',
            entity_id: newBatchEntityId(),
            kind: 'rpc',
            payload: {
              method: 'ownMember',
              member_id: memberId,
              user_id: userId,
            },
            ...listQueueParent(listId),
            status: 'queued',
          })
        })
        mutationVersionRef.current += 1
        skipRealtimeUntilRef.current = Date.now() + 2000
        await markCurrentListViewed(nowIso)
        return { error: null, newMemberId: memberId }
      } finally {
        useListDataStore.getState().endLocalListPersistence()
      }
    } catch (error) {
      if (membersSnapshot) {
        useListDataStore.getState().setMembers(membersSnapshot)
      }
      return { error: { message: rpcFailureMessage(error) || 'Failed to take ownership' } }
    } finally {
      mutationGate.end()
    }
  }

  const updateMemberState = async (
    itemId: string,
    memberId: string,
    updates: { quantity?: number; done?: boolean; assigned?: boolean },
  ) => {
    if (isOfflineActionsDisabled) {
      return { error: { message: blockedMutationMessage() } }
    }
    const existingState = useListDataStore.getState().items.find((i) => i.id === itemId)?.memberStates[memberId]
    const t = isoNow()
    const syncBase =
      existingState != null
        ? {
            client_created_at: existingState.client_created_at,
            server_created_at: existingState.server_created_at,
            deleted_at: existingState.deleted_at ?? null,
            version: existingState.version ?? 1,
            last_synced_at: existingState.last_synced_at ?? null,
          }
        : syncFieldsForLocalInsert({ client_created_at: t })
    const optimisticState: ItemMemberState = {
      item_id: itemId,
      member_id: memberId,
      ...syncBase,
      quantity: updates.quantity ?? existingState?.quantity ?? 1,
      done: updates.done ?? existingState?.done ?? false,
      assigned: updates.assigned ?? existingState?.assigned ?? false,
      updated_at: t,
    }
    const itemsSnapshot = [...useListDataStore.getState().items]
    useListDataStore.getState().beginLocalListPersistence()
    try {
      useListDataStore.getState().setItems((prev) =>
        prev.map((item) =>
          item.id !== itemId
            ? item
            : {
                ...item,
                memberStates: {
                  ...item.memberStates,
                  [memberId]: optimisticState,
                },
              },
        ),
      )
      await toggleItemMemberStateMutation({
        list_id: listId,
        item_id: itemId,
        member_id: memberId,
        state: optimisticState,
      })
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      await markCurrentListViewed(t)
      return { error: null }
    } catch (error) {
      useListDataStore.getState().setItems(itemsSnapshot)
      return { error: { message: rpcFailureMessage(error) } }
    } finally {
      useListDataStore.getState().endLocalListPersistence()
    }
  }

  const changeQuantity = async (itemId: string, memberId: string, delta: number) => {
    if (isOfflineActionsDisabled) {
      return { data: null, error: { message: blockedMutationMessage() } }
    }
    const previousState = useListDataStore.getState().items.find((item) => item.id === itemId)?.memberStates[memberId]
    const t = isoNow()
    const syncBase =
      previousState != null
        ? {
            client_created_at: previousState.client_created_at,
            server_created_at: previousState.server_created_at,
            deleted_at: previousState.deleted_at ?? null,
            version: previousState.version ?? 1,
            last_synced_at: previousState.last_synced_at ?? null,
          }
        : syncFieldsForLocalInsert({ client_created_at: t })
    const optimisticState: ItemMemberState = {
      item_id: itemId,
      member_id: memberId,
      ...syncBase,
      quantity: Math.max(1, (previousState?.quantity || 1) + delta),
      done: previousState?.done || false,
      assigned: previousState?.assigned ?? true,
      updated_at: t,
    }
    const itemsSnapshot = [...useListDataStore.getState().items]
    useListDataStore.getState().beginLocalListPersistence()
    try {
      useListDataStore.getState().setItems((prev) =>
        prev.map((item) =>
          item.id !== itemId
            ? item
            : {
                ...item,
                memberStates: {
                  ...item.memberStates,
                  [memberId]: optimisticState,
                },
              },
        ),
      )
      await toggleItemMemberStateMutation({
        list_id: listId,
        item_id: itemId,
        member_id: memberId,
        state: optimisticState,
      })
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      await markCurrentListViewed(t)
      return { data: optimisticState.quantity, error: null }
    } catch (error) {
      useListDataStore.getState().setItems(itemsSnapshot)
      return { data: null, error: { message: rpcFailureMessage(error) } }
    } finally {
      useListDataStore.getState().endLocalListPersistence()
    }
  }

  const deleteArchivedItems = async () => {
    const archivedIds = new Set(items.filter((i) => i.archived).map((i) => i.id))
    if (archivedIds.size === 0) return { error: null, count: 0 }
    if (!userId) return { error: { message: 'Not authenticated' }, count: 0 }

    if (!tryBeginItemQueueableMutation()) {
      return { error: { message: blockedMutationMessage() }, count: 0 }
    }
    const itemsSnapshot = [...useListDataStore.getState().items]
    useListDataStore.getState().beginLocalListPersistence()
    try {
      useListDataStore.getState().setItems((prev) => prev.filter((i) => !archivedIds.has(i.id)))
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 3000
      await bulkSoftDeleteArchivedItemsMutation(listId, [...archivedIds])
      await markCurrentListViewed()
      persistListSnapshotToDetailCache(userId, listId)
      return { error: null, count: archivedIds.size }
    } catch (error) {
      useListDataStore.getState().setItems(itemsSnapshot)
      return { error: { message: rpcFailureMessage(error) }, count: 0 }
    } finally {
      useListDataStore.getState().endLocalListPersistence()
      mutationGate.end()
    }
  }

  const restoreArchivedItems = async () => {
    const archivedIds = items.filter(i => i.archived).map(i => i.id)
    if (archivedIds.length === 0) return { error: null, count: 0 }
    if (!userId) return { error: { message: 'Not authenticated' }, count: 0 }

    if (!tryBeginItemQueueableMutation()) {
      return { error: { message: blockedMutationMessage() }, count: 0 }
    }
    const archivedIdSet = new Set(archivedIds)
    const itemsSnapshot = [...useListDataStore.getState().items]
    const nowIso = new Date(Date.now()).toISOString()
    useListDataStore.getState().beginLocalListPersistence()
    try {
      useListDataStore.getState().setItems((prev) =>
        prev.map((i) =>
          archivedIdSet.has(i.id)
            ? { ...i, archived: false, archived_at: null, updated_at: nowIso }
            : i,
        ),
      )
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 3000
      await db.transaction('rw', [db.items, db.lists, db.sync_queue, db.list_users], async () => {
        for (const itemId of archivedIds) {
          await db.items.update(itemId, {
            archived: false,
            archived_at: null,
            updated_at: nowIso,
          })
        }
        await enqueueSyncQueueRecord({
          entity: 'list',
          entity_id: newBatchEntityId(),
          kind: 'rpc',
          payload: { method: 'restoreArchivedItems', list_id: listId },
          ...listQueueParent(listId),
          status: 'queued',
        })
      })
      await markCurrentListViewed(nowIso)
      persistListSnapshotToDetailCache(userId, listId)
      return { error: null, count: archivedIds.length }
    } catch (error) {
      useListDataStore.getState().setItems(itemsSnapshot)
      return { error: { message: rpcFailureMessage(error) }, count: 0 }
    } finally {
      useListDataStore.getState().endLocalListPersistence()
      mutationGate.end()
    }
  }

  const reorderItems = async (reorderedItems: ItemWithState[]) => {
    if (!userId) return { error: { message: 'Not authenticated' } }
    if (!tryBeginItemQueueableMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    const itemsSnapshot = [...useListDataStore.getState().items]
    const nowIso = new Date(Date.now()).toISOString()
    const reorderedWithTs = normalizeItemsCategory(
      reorderedItems.map((item, index) => ({
        ...item,
        sort_order: index,
        updated_at: nowIso,
      })),
    )
    useListDataStore.getState().beginLocalListPersistence()
    try {
      useListDataStore.getState().setItems(reorderedWithTs)
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Math.max(skipRealtimeUntilRef.current, Date.now() + 2000)
      const itemIds = reorderedItems.map((item) => item.id)
      await db.transaction('rw', db.items, db.lists, db.sync_queue, db.list_users, async () => {
        for (const [index, item] of reorderedItems.entries()) {
          await db.items.update(item.id, {
            sort_order: index,
            updated_at: nowIso,
          })
        }
        await enqueueSyncQueueRecord({
          entity: 'list',
          entity_id: newBatchEntityId(),
          kind: 'rpc',
          payload: { method: 'reorderListItems', list_id: listId, item_ids: itemIds },
          ...listQueueParent(listId),
          status: 'queued',
        })
      })
      await markCurrentListViewed(nowIso)
      return { error: null }
    } catch (error) {
      useListDataStore.getState().setItems(itemsSnapshot)
      return { error: { message: rpcFailureMessage(error) } }
    } finally {
      useListDataStore.getState().endLocalListPersistence()
      mutationGate.end()
    }
  }

  const updateMemberFilter = async (filter: MemberFilter) => {
    if (!tryBeginMutation()) {
      return
    }
    try {
      const prev = memberFilter
      const prevLastViewedSnapshot = lastViewedMembers
      setMemberFilter(filter)
      setCachedPrefs(listId, { memberFilter: filter }, userId)
      let lastVmPatch: string | undefined
      if (prev === 'all' && filter !== 'all') {
        lastVmPatch = new Date().toISOString()
        setLastViewedMembers(lastVmPatch)
      }
      if (userId) {
        useListDataStore.getState().beginPrefsPersistence()
        try {
          const luPatch: Record<string, unknown> = { member_filter: filter }
          if (lastVmPatch !== undefined) luPatch.last_viewed_members = lastVmPatch
          try {
            await db.transaction('rw', db.list_users, db.lists, db.sync_queue, async () => {
              const lu = await db.list_users.where('[list_id+user_id]').equals([listId, userId]).first()
              if (!lu) throw new Error('Missing list_users row')
              await db.list_users.update(lu.id, luPatch as never)
              await enqueueSyncQueueRecord({
                entity: 'list',
                entity_id: newBatchEntityId(),
                kind: 'rpc',
                payload: {
                  method: 'patchListUser',
                  id: listId,
                  user_id: userId,
                  ...luPatch,
                },
                ...listQueueParent(listId),
                status: 'queued',
              })
            })
          } catch {
            setMemberFilter(prev)
            setCachedPrefs(listId, { memberFilter: prev }, userId)
            setLastViewedMembers(prevLastViewedSnapshot)
          }
        } finally {
          useListDataStore.getState().endPrefsPersistence()
        }
      }
    } finally {
      mutationGate.end()
    }
  }

  const applyDisplayPrefsBaseline = useCallback(
    (baseline: DisplayPrefsBaseline) => {
      const parsed = parseWidthValue(baseline.widthValue)
      setItemTextWidthMode(parsed.mode)
      if (parsed.mode === 'manual') {
        setItemTextWidth(parsed.width)
      }
      itemNameFontStepRef.current = baseline.fontStep
      setItemNameFontStep(baseline.fontStep)
      setCachedPrefsLocalOnly(
        listId,
        { itemTextWidth: baseline.widthValue, itemNameFontStep: baseline.fontStep },
        userId,
      )
    },
    [listId, userId],
  )

  const previewItemTextWidth = useCallback(
    (width: number) => {
      const newWidth = Math.min(ITEM_TEXT_WIDTH_MAX, Math.max(ITEM_TEXT_WIDTH_MIN, width))
      setItemTextWidth(newWidth)
      setItemTextWidthMode('manual')
      setCachedPrefsLocalOnly(listId, { itemTextWidth: String(newWidth) }, userId)
    },
    [listId, userId],
  )

  const previewItemTextWidthMode = useCallback(
    (mode: WidthMode) => {
      let widthForValue = itemTextWidth
      if (mode === 'auto') {
        const texts = [
          ...items.map((i) => i.text ?? ''),
          ...sumRowTitlesForAutoWidth(sumScope, items),
        ]
        widthForValue = measureFitItemTextWidthPx(texts, itemNameFontStepRef.current)
        setItemTextWidth(widthForValue)
      }
      setItemTextWidthMode(mode)
      const value = mode === 'auto' ? 'auto' : String(widthForValue)
      setCachedPrefsLocalOnly(listId, { itemTextWidth: value }, userId)
    },
    [itemTextWidth, items, listId, sumScope, userId],
  )

  const previewItemNameFontStep = useCallback(
    (step: number) => {
      const s = Math.min(ITEM_NAME_FONT_MAX, Math.max(ITEM_NAME_FONT_MIN, Math.round(step)))
      if (s === itemNameFontStepRef.current) return
      itemNameFontStepRef.current = s
      setItemNameFontStep(s)
      setCachedPrefsLocalOnly(listId, { itemNameFontStep: s }, userId)
    },
    [listId, userId],
  )

  const beginDisplayPrefsSession = useCallback(() => {
    if (displayPrefsSessionActiveRef.current) return
    const widthValue = itemTextWidthMode === 'auto' ? 'auto' : String(itemTextWidth)
    displayPrefsBaselineRef.current = { widthValue, fontStep: itemNameFontStepRef.current }
    displayPrefsSessionActiveRef.current = true
    useListDataStore.getState().beginPrefsPersistence()
  }, [itemTextWidth, itemTextWidthMode])

  const commitDisplayPrefs = useCallback(async () => {
    if (!displayPrefsSessionActiveRef.current) return
    displayPrefsSessionActiveRef.current = false
    const baseline = displayPrefsBaselineRef.current
    displayPrefsBaselineRef.current = null

    const endDisplayPrefsSession = () => {
      useListDataStore.getState().endPrefsPersistence()
    }

    const widthValue = itemTextWidthMode === 'auto' ? 'auto' : String(itemTextWidth)
    const fontStep = itemNameFontStepRef.current

    if (!baseline || (widthValue === baseline.widthValue && fontStep === baseline.fontStep)) {
      endDisplayPrefsSession()
      return
    }

    if (!userId) {
      setCachedPrefs(listId, { itemTextWidth: widthValue, itemNameFontStep: fontStep }, userId)
      endDisplayPrefsSession()
      return
    }

    if (!tryBeginMutation()) {
      applyDisplayPrefsBaseline(baseline)
      endDisplayPrefsSession()
      return
    }

    try {
      const luPatch: Record<string, unknown> = {}
      if (widthValue !== baseline.widthValue) luPatch.item_text_width = widthValue
      if (fontStep !== baseline.fontStep) luPatch.item_name_font_step = fontStep
      try {
        await db.transaction('rw', db.list_users, db.lists, db.sync_queue, async () => {
          const lu = await db.list_users.where('[list_id+user_id]').equals([listId, userId]).first()
          if (!lu) throw new Error('Missing list_users row')
          await db.list_users.update(lu.id, luPatch as never)
          await enqueueSyncQueueRecord({
            entity: 'list',
            entity_id: newBatchEntityId(),
            kind: 'rpc',
            payload: {
              method: 'patchListUser',
              id: listId,
              user_id: userId,
              ...luPatch,
            },
            ...listQueueParent(listId),
            status: 'queued',
          })
        })
        setCachedPrefs(listId, { itemTextWidth: widthValue, itemNameFontStep: fontStep }, userId)
      } catch {
        applyDisplayPrefsBaseline(baseline)
      }
    } finally {
      mutationGate.end()
      endDisplayPrefsSession()
    }
  }, [
    applyDisplayPrefsBaseline,
    itemTextWidth,
    itemTextWidthMode,
    listId,
    mutationGate,
    tryBeginMutation,
    userId,
  ])

  /** Always latest commit fn — do not put `commitDisplayPrefs` in an effect deps array: its identity
   * changes when width/font preview updates state; cleanup would fire and commit mid-session (font + auto width). */
  const commitDisplayPrefsRef = useRef(commitDisplayPrefs)
  commitDisplayPrefsRef.current = commitDisplayPrefs

  useEffect(() => {
    return () => {
      void commitDisplayPrefsRef.current()
    }
  }, [listId])

  const updateListUserSumScope = async (next: ListUserSumScope) => {
    if (!userId) {
      return { error: new Error('Not signed in') }
    }
    if (!tryBeginMutation()) {
      return { error: new Error(blockedMutationMessage()) }
    }
    const prev = sumScope
    try {
      setSumScope(next)
      setCachedPrefs(listId, { sumScope: next }, userId)
      useListDataStore.getState().beginPrefsPersistence()
      try {
        try {
          await db.transaction('rw', db.list_users, db.lists, db.sync_queue, async () => {
            const lu = await db.list_users.where('[list_id+user_id]').equals([listId, userId]).first()
            if (!lu) throw new Error('Missing list_users row')
            await db.list_users.update(lu.id, { sum_scope: next })
            await enqueueSyncQueueRecord({
              entity: 'list',
              entity_id: newBatchEntityId(),
              kind: 'rpc',
              payload: {
                method: 'patchListUser',
                id: listId,
                user_id: userId,
                sum_scope: next,
              },
              ...listQueueParent(listId),
              status: 'queued',
            })
          })
          return { error: null }
        } catch (e) {
          setSumScope(prev)
          setCachedPrefs(listId, { sumScope: prev }, userId)
          return { error: e instanceof Error ? e : new Error('Failed to queue preference update') }
        }
      } finally {
        useListDataStore.getState().endPrefsPersistence()
      }
    } finally {
      mutationGate.end()
    }
  }


  const persistCategorySettingsToStorage = async (
    names: CategoryNames,
    order: number[],
    shouldReorderItems: boolean,
  ): Promise<{ error: Error | null }> => {
    const nonEmpty: Record<string, string> = {}
    for (const [k, v] of Object.entries(names)) {
      if (v) nonEmpty[k] = v
    }
    const serializedNames = Object.keys(nonEmpty).length > 0 ? JSON.stringify(nonEmpty) : '{}'
    const serializedOrder = JSON.stringify(order)

    const prevNames = categoryNamesRef.current
    const prevOrder = categoryOrderRef.current
    const prevList = useListDataStore.getState().list
    const itemsSnapshot =
      shouldReorderItems && useListDataStore.getState().items.length > 0
        ? [...useListDataStore.getState().items]
        : null

    mutationVersionRef.current += 1
    categoryListMirrorSuppressCountRef.current++
    try {
      setCategoryNames({ ...EMPTY_CATEGORY_NAMES, ...names })
      setCategoryOrder(order)
      useListDataStore.getState().setList((l) =>
        l ? { ...l, category_names: serializedNames, category_order: serializedOrder } : l,
      )

      let reorderedWithTs: ItemWithState[] | null = null
      const nowIso = new Date(Date.now()).toISOString()
      if (shouldReorderItems && itemsSnapshot) {
        const fullOrder = computeItemsReorderedByCategory(itemsSnapshot, order)
        reorderedWithTs = normalizeItemsCategory(
          fullOrder.map((item, index) => ({
            ...item,
            sort_order: index,
            updated_at: nowIso,
          })),
        )
        useListDataStore.getState().setItems(reorderedWithTs)
        skipRealtimeUntilRef.current = Math.max(skipRealtimeUntilRef.current, Date.now() + 2000)
      }

      const existing = await db.lists.get(listId)
      if (!existing || isTombstoned(existing.deleted_at ?? null)) {
        throw new Error('Missing list row')
      }
      const mergedList = {
        ...existing,
        category_names: serializedNames,
        category_order: serializedOrder,
        cached_at: Date.now(),
        app_version: APP_VERSION,
      }
      const sync = normalizeServerSyncableFields(mergedList as unknown as Record<string, unknown>)

      await db.transaction('rw', db.lists, db.items, db.sync_queue, db.list_users, async () => {
        await db.lists.put(withLastSyncedNow({ ...mergedList, ...sync }))
        await enqueueSyncQueueRecord({
          entity: 'list',
          entity_id: listId,
          kind: 'patch',
          payload: { id: listId, category_names: serializedNames, category_order: serializedOrder },
          ...listQueueParent(listId),
          status: 'queued',
        })
        if (shouldReorderItems && reorderedWithTs) {
          for (const [index, item] of reorderedWithTs.entries()) {
            await db.items.update(item.id, {
              sort_order: index,
              updated_at: nowIso,
            })
          }
          await enqueueSyncQueueRecord({
            entity: 'list',
            entity_id: newBatchEntityId(),
            kind: 'rpc',
            payload: {
              method: 'reorderListItems',
              list_id: listId,
              item_ids: reorderedWithTs.map((i) => i.id),
            },
            ...listQueueParent(listId),
            status: 'queued',
          })
        }
      })

      if (userId) {
        await markCurrentListViewed(nowIso)
      }
      return { error: null }
    } catch (err: unknown) {
      setCategoryNames(prevNames)
      setCategoryOrder(prevOrder)
      if (prevList) {
        useListDataStore.getState().setList(prevList)
      }
      if (shouldReorderItems && itemsSnapshot) {
        useListDataStore.getState().setItems(itemsSnapshot)
      }
      return { error: new Error(rpcFailureMessage(err)) }
    } finally {
      categoryListMirrorSuppressCountRef.current--
    }
  }

  const updateCategoryNames = async (names: CategoryNames) => {
    if (!tryBeginMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    setCategorySettingsMutationPending(true)
    try {
      const r = await persistCategorySettingsToStorage(names, categoryOrderRef.current, false)
      return r.error ? { error: r.error } : { error: null }
    } finally {
      mutationGate.end()
      setCategorySettingsMutationPending(false)
    }
  }

  const updateCategoryOrder = async (order: number[]) => {
    if (!tryBeginMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    setCategorySettingsMutationPending(true)
    try {
      const r = await persistCategorySettingsToStorage(categoryNamesRef.current, order, false)
      return r.error ? { error: r.error } : { error: null }
    } finally {
      mutationGate.end()
      setCategorySettingsMutationPending(false)
    }
  }

  const saveCategorySettings = async (
    names: CategoryNames,
    order: number[],
    options?: { reorderItems?: boolean },
  ) => {
    const reorder = !!options?.reorderItems
    if (reorder && !userId) {
      return { error: { message: 'Not authenticated' } }
    }
    if (reorder) {
      if (!tryBeginItemQueueableMutation()) {
        return { error: { message: blockedMutationMessage() } }
      }
    } else {
      if (!tryBeginMutation()) {
        return { error: { message: blockedMutationMessage() } }
      }
    }
    setCategorySettingsMutationPending(true)
    if (reorder) {
      useListDataStore.getState().beginLocalListPersistence()
    }
    try {
      const r = await persistCategorySettingsToStorage(names, order, reorder)
      return r.error ? { error: r.error } : { error: null }
    } finally {
      if (reorder) {
        useListDataStore.getState().endLocalListPersistence()
      }
      mutationGate.end()
      setCategorySettingsMutationPending(false)
    }
  }

  const createTargets = async () => {
    if (!userId) return
    const hasTarget = members.some(m => m.is_target)
    if (hasTarget) return

    if (!tryBeginItemQueueableMutation()) {
      return
    }
    useListDataStore.getState().beginLocalListPersistence()
    try {
      if (memberFilter !== 'all') {
        await updateMemberFilter('all')
      }

      const memberId = crypto.randomUUID()
      const now = isoNow()
      const sync = syncFieldsForLocalInsert({ client_created_at: now })
      const creatorFromProfile = profile?.nickname ? { nickname: profile.nickname } : null
      const optimisticTarget: MemberWithCreator = {
        id: memberId,
        list_id: listId,
        name: 'Qty',
        created_by: userId,
        sort_order: 0,
        is_public: false,
        is_target: true,
        ...sync,
        updated_at: now,
        creator: creatorFromProfile,
      }
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      useListDataStore.getState().setMembers((prev) => [optimisticTarget, ...prev])

      try {
        await addMemberMutation({
          id: memberId,
          user_id: userId,
          list_id: listId,
          name: 'Qty',
          is_target: true,
          sort_order: 0,
        })
      } catch {
        useListDataStore.getState().setMembers((prev) => prev.filter((m) => m.id !== memberId))
        return
      }

      const itemsForIms = useListDataStore.getState().items
      if (itemsForIms.length > 0) {
        const syncRow = syncFieldsForLocalInsert({ client_created_at: now })

        useListDataStore.getState().setItems((prev) =>
          prev.map((i) => ({
            ...i,
            memberStates: {
              ...i.memberStates,
              [memberId]: {
                item_id: i.id,
                member_id: memberId,
                quantity: 1,
                done: false,
                assigned: true,
                ...syncRow,
                updated_at: now,
              },
            },
          })),
        )

        await seedItemMemberStatesForMemberMutation({
          list_id: listId,
          member_id: memberId,
        })
      }
    } finally {
      useListDataStore.getState().endLocalListPersistence()
      mutationGate.end()
    }
  }

  const itemsForUi = itemsUntilReconnectReconciled ?? items

  // Auto-fit width when mode is 'auto' and items change (include sumScope so cycling all/active/archived recalculates)
  useEffect(() => {
    if (itemTextWidthMode !== 'auto') return
    const texts = [
      ...itemsForUi.map(i => i.text ?? ''),
      ...sumRowTitlesForAutoWidth(sumScope, itemsForUi),
    ]
    const fitWidth = measureFitItemTextWidthPx(texts, itemNameFontStep)
    setItemTextWidth(fitWidth)
  }, [itemTextWidthMode, itemNameFontStep, sumScope, itemsForUi])

  return {
    list,
    items: itemsForUi,
    members,
    listDataStatus,
    sessionMirrorReady,
    loading,
    isFetching,
    isInitialSyncing,
    fetchTimedOut,
    saveTimedOut,
    error,
    accessDenied,
    hasCompletedInitialFetch,
    memberFilter,
    itemTextWidth,
    itemTextWidthMode,
    itemNameFontStep,
    beginDisplayPrefsSession,
    commitDisplayPrefs,
    previewItemNameFontStep,
    categoryNames,
    categoryOrder,
    refresh: refreshList,
    addItem,
    addItemsBulk,
    updateItem,
    deleteItem,
    addMember,
    updateMember,
    deleteMember,
    ownMember,
    updateMemberState,
    changeQuantity,
    reorderItems,
    deleteArchivedItems,
    restoreArchivedItems,
    updateMemberFilter,
    previewItemTextWidth,
    previewItemTextWidthMode,
    updateCategoryNames,
    updateCategoryOrder,
    saveCategorySettings,
    categorySettingsMutationPending,
    lastViewedMembers,
    createTargets,
    sumScope,
    updateListUserSumScope,
    isOfflineActionsDisabled,
    allowItemMutationQueue,
  }
}
