'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Dexie from 'dexie'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { getActiveCacheUserId, getCachedList, setCachedList, removeCachedList } from '@/lib/cache'
import { useListDetailQuery } from '@/lib/data/queries'
import {
  addItemMutation,
  addMemberMutation,
  softDeleteItemMutation,
  toggleItemMemberStateMutation,
} from '@/lib/data/mutations'
import { db } from '@/lib/db'
import {
  readListPrefsFromDexie,
  reportServerDexieParityDiagnostics,
  upsertListDataPayloadFromServer,
  upsertListPrefsFromServer,
} from '@/lib/data/serverDexieParity'
import { perfLog } from '@/lib/startupPerfLog'
import { appendOfflineNavDiagnostic } from '@/lib/offlineNavDiagnostics'
import { diagItemCreateReplace } from '@/lib/itemMutationDiagnostics'
import {
  isLikelyConnectivityError,
  resolveServerWorkOutcomeFromResult,
  resolveServerWorkOutcomeFromThrown,
  type ServerWorkOutcome,
} from '@/lib/connectivityErrors'
import { STILL_SAVING_TEMP_ENTITY_MSG } from '@/lib/mutationToastPolicy'
import { memberProfileOutboxKey } from '@/lib/data/syncQueue'
import { APP_VERSION } from '@/lib/appVersion'
import { measureFitItemTextWidthPx } from '@/lib/itemTextWidthFit'
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

const supabase = createClient()

// Helper to get cached preferences from localStorage
function getPrefsKey(listId: string, userId?: string) {
  const scopedUserId = userId || getActiveCacheUserId()
  return scopedUserId ? `list_${scopedUserId}_${listId}_prefs` : null
}

type WidthMode = 'auto' | 'manual'

function parseWidthValue(raw: string | number | null | undefined): { mode: WidthMode; width: number } {
  if (raw == null || raw === 'auto' || typeof raw === 'number') return { mode: 'auto', width: 80 }
  const num = parseInt(raw, 10)
  if (isNaN(num) || num < 80) return { mode: 'auto', width: 80 }
  return { mode: 'manual', width: num }
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

function getCachedPrefs(listId: string, userId?: string) {
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

function setCachedPrefs(
  listId: string,
  prefs: { memberFilter?: MemberFilter; itemTextWidth?: string; itemNameFontStep?: number; sumScope?: ListUserSumScope },
  userId?: string,
) {
  if (typeof window === 'undefined') return
  const prefsKey = getPrefsKey(listId, userId)
  if (!prefsKey) return
  try {
    const current = getCachedPrefs(listId, userId)
    const updated = { ...current, ...prefs }
    localStorage.setItem(prefsKey, JSON.stringify(updated))
  } catch { /* ignore */ }
  if (userId) {
    void upsertListPrefsFromServer(userId, listId, {
      member_filter: prefs.memberFilter ?? null,
      item_text_width: prefs.itemTextWidth ?? null,
      item_name_font_step: prefs.itemNameFontStep ?? null,
      sum_scope: prefs.sumScope ?? null,
    })
  }
}

const FETCH_TIMEOUT_MS = 10_000
const SAVE_TIMEOUT_MS = 10_000
function createTempId(prefix: string) {
  return `temp-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function isTempEntityId(id: string) {
  return id.startsWith('temp-')
}

function mergePreservedTempCreates(
  serverItems: ItemWithState[],
  prev: ItemWithState[],
  pendingCreates: Array<{ itemKey: string; payload: Record<string, unknown> }>,
  clientKeyToServerId: ReadonlyMap<string, string>,
): ItemWithState[] {
  const pendingTempIds = new Set(pendingCreates.map((c) => c.itemKey))
  const payloadByTempId = new Map(pendingCreates.map((c) => [c.itemKey, c.payload] as const))

  const clientKeyForTempItem = (opt: ItemWithState) =>
    opt.clientItemKey ?? payloadByTempId.get(opt.id)?.clientItemKey

  const preserved = prev.filter((item) => isTempEntityId(item.id) && pendingTempIds.has(item.id))

  const merged: ItemWithState[] = []
  for (const srv of serverItems) {
    const matchedTemp = preserved.find((opt) => {
      const ck = clientKeyForTempItem(opt)
      return Boolean(ck && clientKeyToServerId.get(ck) === srv.id)
    })
    if (matchedTemp) {
      const ck = clientKeyForTempItem(matchedTemp) ?? ''
      const withKey: ItemWithState = {
        ...srv,
        clientItemKey: ck || matchedTemp.clientItemKey,
        memberStates: srv.memberStates,
      }
      merged.push(withKey)
      diagItemCreateReplace({
        phase: 'fetch-merge',
        listId: srv.list_id,
        tempId: matchedTemp.id,
        serverId: srv.id,
        clientItemKey: ck,
        matchBasis: 'client_key_mapping',
        serverRowAppended: false,
        itemName: srv.text,
      })
    } else {
      const prevSame = prev.find((p) => p.id === srv.id)
      merged.push(prevSame?.clientItemKey ? { ...srv, clientItemKey: prevSame.clientItemKey } : srv)
    }
  }

  for (const opt of preserved) {
    const ck = clientKeyForTempItem(opt)
    const sid = ck ? clientKeyToServerId.get(ck) : undefined
    if (sid && merged.some((m) => m.id === sid)) continue
    if (!merged.some((m) => m.id === opt.id)) merged.push(opt)
  }

  const byId = new Map<string, ItemWithState>()
  for (const row of merged) {
    const existing = byId.get(row.id)
    if (!existing) {
      byId.set(row.id, row)
      continue
    }
    const preferNew =
      Boolean(row.clientItemKey && !existing.clientItemKey) ||
      Object.keys(row.memberStates ?? {}).length > Object.keys(existing.memberStates ?? {}).length
    byId.set(row.id, preferNew ? row : existing)
  }
  return Array.from(byId.values())
}

/** After items.insert: drop temp / duplicate server copies; keep one row tagged with `clientItemKey`. */
function applyServerItemAfterCreate(
  prev: ItemWithState[],
  args: {
    listId: string
    tempId: string
    clientItemKey: string
    serverItem: Item
    memberStates: Record<string, ItemMemberState>
    itemName: string
  },
): ItemWithState[] {
  const { tempId, clientItemKey, serverItem, memberStates, listId, itemName } = args
  const sid = serverItem.id
  const merged: ItemWithState = { ...serverItem, memberStates, clientItemKey }

  const hadTemp = prev.some((i) => i.id === tempId)
  const hadClientTemp = prev.some((i) => i.clientItemKey === clientItemKey && isTempEntityId(i.id))
  const hadTaggedServer = prev.some((i) => i.id === sid && i.clientItemKey === clientItemKey)
  let matchBasis: 'temp_id' | 'client_key_temp' | 'client_key_server' | 'append' = 'append'
  if (hadTemp) matchBasis = 'temp_id'
  else if (hadClientTemp) matchBasis = 'client_key_temp'
  else if (hadTaggedServer) matchBasis = 'client_key_server'

  const droppedServerCopies = prev.filter((i) => i.id === sid).length
  const next = prev.filter((item) => {
    if (item.id === tempId) return false
    if (clientItemKey && item.clientItemKey === clientItemKey && isTempEntityId(item.id)) return false
    if (item.id === sid) return false
    return true
  })
  next.push(merged)

  diagItemCreateReplace({
    phase: 'post-create',
    listId,
    tempId,
    serverId: sid,
    clientItemKey,
    matchBasis,
    serverRowAppended: true,
    droppedServerCopies,
    itemName,
  })
  return next
}

function mergePreservedTempMembers(
  serverMembers: MemberWithCreator[],
  prev: MemberWithCreator[],
  pendingTempMemberIds: Set<string>,
): MemberWithCreator[] {
  const preserved = prev.filter(
    (m) => isTempEntityId(m.id) && pendingTempMemberIds.has(m.id),
  )
  if (preserved.length === 0) return serverMembers
  const merged = [...serverMembers]
  for (const m of preserved) {
    if (!merged.some((row) => row.id === m.id)) {
      merged.push(m)
    }
  }
  return merged
}

const LEGACY_CARD_COLOR_TO_CATEGORY: Record<string, number> = {
  default: 1,
  mint: 2,
  coral: 3,
  sand: 4,
  lilac: 5,
  slate: 6,
}

function normalizeItemsCategory(items: ItemWithState[]): ItemWithState[] {
  return items.map(item => {
    const legacy = item as ItemWithState & { card_color?: string }
    const fromLegacy =
      item.category == null && legacy.card_color != null
        ? LEGACY_CARD_COLOR_TO_CATEGORY[legacy.card_color.trim()] ?? 1
        : item.category
    return {
      ...item,
      category: normalizeItemCategory(fromLegacy),
    }
  })
}

function rpcFailureMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message: unknown }).message
    if (typeof m === 'string' && m.length > 0) return m
  }
  return 'Unknown error'
}

export function useList(listId: string) {
  const { user, profile, loading: authLoading, bootstrapUserId } = useAuth()
  const cached = getCachedList(undefined, listId)
  
  // Initialize from cache for instant load
  const [list, setList] = useState<List | null>(cached?.list || null)
  const [items, setItems] = useState<ItemWithState[]>(() => normalizeItemsCategory(cached?.items || []))
  const [members, setMembers] = useState<MemberWithCreator[]>(cached?.members || [])
  const [loading, setLoading] = useState(!cached?.list)
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
  const [categoryNames, setCategoryNames] = useState<CategoryNames>(() => parseCategoryNames(cached?.list?.category_names))
  const [categoryOrder, setCategoryOrder] = useState<number[]>(() => parseCategoryOrder(cached?.list?.category_order))
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
  /** Maps optimistic `clientItemKey` → server `items.id` after a create lands (online or drain). */
  const clientItemKeyToServerIdRef = useRef<Map<string, string>>(new Map())
  /** First mutation version captured when a debounced realtime fetch is scheduled; preserved across reschedules until that fetch completes. */
  const realtimeScheduleCaptureVersionRef = useRef<number | null>(null)
  const scheduleRealtimeFetchRef = useRef<(delayMs: number) => void>(() => {})
  const userId = user?.id ?? (authLoading ? bootstrapUserId : null)
  const dexieDetail = useListDetailQuery(userId, listId)
  useEffect(() => {
    reportServerDexieParityDiagnostics()
  }, [])

  const { showToast, dismissToast, error: showErrorToast } = useToast()
  const {
    status: connectivityStatus,
    isOfflineActionsDisabled,
    allowItemMutationQueue,
    recoveryFetchGeneration,
    enterOffline,
    markOnlineRecovered,
    beginServerWork,
    endServerWork,
    pulseServerWorkProgress,
    canMutateNow,
    blockedMutationMessage,
  } = useConnectivity()
  const archiveUndoToastIdRef = useRef<string | null>(null)
  /** User intent while archive / undo requests settle (`true` = archived, `false` = not). Read after awaits, not from closures. */
  const desiredArchivedByItemRef = useRef<Record<string, boolean>>({})
  const archiveDbWriteInflightRef = useRef<Record<string, boolean>>({})
  const updateItemRef = useRef<
    (itemId: string, updates: Partial<Item>) => Promise<{ error: { message?: string } | null }>
  >(async () => ({ error: null }))
  const mutationGate = useMemo(() => createUserMutationGate(), [])

  const tryBeginMutation = useCallback((): boolean => {
    if (!canMutateNow()) return false
    return mutationGate.tryBegin()
  }, [canMutateNow, mutationGate])

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
    if (!dexieDetail) return
    setItems(normalizeItemsCategory(dexieDetail.items))
    setMembers(dexieDetail.members)
    if (dexieDetail.items.length > 0 || dexieDetail.members.length > 0) {
      setLoading(false)
    }
    hasInitialDataRef.current = dexieDetail.items.length > 0 || dexieDetail.members.length > 0
  }, [dexieDetail])

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

    setList(cachedData?.list || null)
    setItems(normalizeItemsCategory(cachedData?.items || []))
    setMembers(cachedData?.members || [])
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
    let cancelled = false
    void (async () => {
      const dexiePrefs = await readListPrefsFromDexie(userId, listId)
      if (!dexiePrefs || cancelled) return
      const dexieFilter = VALID_MEMBER_FILTERS.includes(dexiePrefs.member_filter as MemberFilter)
        ? dexiePrefs.member_filter as MemberFilter
        : 'all' as MemberFilter
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
    })()
    return () => {
      cancelled = true
    }
  }, [listId, userId])

  const trackSaveOperation = useCallback(async (operation: PromiseLike<unknown>): Promise<unknown> => {
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
    setItems(prev => prev.map(item => {
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

    if (!userId || !listId) {
      perfLog('fetchList start', { note: 'no user or list' })
      setList(null)
      setItems([])
      setMembers([])
      setLoading(false)
      setIsFetching(false)
      setHasCompletedInitialFetch(true)
      perfLog('fetchList end', { durationMs: 0, listCount: 0, itemCount: 0 })
      return
    }

    if (fetchingRef.current) {
      appendOfflineNavDiagnostic(`[fetchList] skipped listId=${listId} (already fetching)`)
      return
    }
    const fetchT0 = performance.now()
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

    // Set timeout for fetch
    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current)
    fetchTimeoutRef.current = setTimeout(() => {
      if (fetchingRef.current) {
        setFetchTimedOut(true)
      }
    }, FETCH_TIMEOUT_MS)

    // Only show loading spinner on initial load if no cached data
    const cachedData = getCachedList(userId, listId)
    if (!hasInitialDataRef.current && !cachedData?.list) {
      setLoading(true)
    }
    setError(null)

    beginServerWork()
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
            'member_filter, item_text_width, last_viewed_members, item_name_font_step, sum_scope',
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

      if (staleCheck != null && staleCheck !== mutationVersionRef.current) {
        staleDiscarded = true
        perfLog('fetchList stale_discard', {
          listId,
          rpcDurationMs,
          capturedVersion: staleCheck,
          mutationVersion: mutationVersionRef.current,
        })
        return
      }

      // Mark that we have access
      hadAccessRef.current = true
      setList(data.list)
      const serverMembers = data.members || []
      const nextItems = normalizeItemsCategory(data.items || [])
      const pendingMutations = await db.sync_queue
        .where('listId')
        .equals(listId)
        .toArray()
      const pendingCreates = pendingMutations
        .filter((m) => m.kind === 'create' && m.entity === 'item')
        .map((m) => ({ itemKey: m.itemKey, payload: m.payload }))
      const pendingTempMemberIds = new Set<string>()
      for (const m of pendingMutations) {
        if (m.kind === 'addMember' && m.entity === 'member') {
          pendingTempMemberIds.add(m.itemKey)
          continue
        }
        if (m.kind === 'patchMember' && m.entity === 'member') {
          const memberId = String((m.payload as { memberId?: string }).memberId ?? '')
          if (isTempEntityId(memberId)) pendingTempMemberIds.add(memberId)
          if (isTempEntityId(m.itemKey)) pendingTempMemberIds.add(m.itemKey)
          continue
        }
        if (m.kind === 'itemMemberState' && m.entity === 'item_member_state') {
          const memberId = String((m.payload as { member_id?: string }).member_id ?? '')
          if (isTempEntityId(memberId)) pendingTempMemberIds.add(memberId)
        }
      }

      let mergedItemsForCache = nextItems
      let mergedMembersForCache = serverMembers

      setItems((prev) => {
        mergedItemsForCache = mergePreservedTempCreates(
          nextItems,
          prev,
          pendingCreates,
          clientItemKeyToServerIdRef.current,
        )
        return mergedItemsForCache
      })
      setMembers((prev) => {
        mergedMembersForCache = mergePreservedTempMembers(serverMembers, prev, pendingTempMemberIds)
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
      void upsertListDataPayloadFromServer(userId, listId, {
        list: data.list,
        items: mergedItemsForCache,
        members: mergedMembersForCache,
      })
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
      markOnlineRecovered('fetchList-success')
      setFetchTimedOut(false)
      appendOfflineNavDiagnostic(
        `[fetchList] RPC success listId=${listId} items=${(data.items || []).length} members=${(data.members || []).length}`,
      )
      serverOutcome = 'success'
    } catch (err) {
      serverOutcome = isLikelyConnectivityError(err) ? 'connectivity_failure' : 'application_error'
      if (serverOutcome === 'connectivity_failure') {
        enterOffline('fetchList-connectivity-error')
      }
      fetchErr = rpcFailureMessage(err)
      setError(rpcFailureMessage(err))
      appendOfflineNavDiagnostic(
        `[fetchList] catch listId=${listId} connectivity-ish=${isLikelyConnectivityError(err) ? 1 : 0} msg=${fetchErr}`,
      )
    } finally {
      endServerWork(serverOutcome)
      perfLog('fetchList end', {
        durationMs: Math.round(performance.now() - fetchT0),
        rpcDurationMs,
        prefsDurationMs,
        listCount,
        itemCount: itemCountResult,
        error: fetchErr,
        staleDiscarded,
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
      appendOfflineNavDiagnostic(
        [
          `[fetchList] finally listId=${listId} totalMs=${Math.round(performance.now() - fetchT0)}`,
          `rpcMs=${rpcDurationMs} prefsMs=${prefsDurationMs == null ? 'n/a' : String(prefsDurationMs)}`,
          `fetchErr=${fetchErr ?? '(none)'}`,
        ].join(' '),
      )
      setItemsUntilReconnectReconciled(null)
    }
  }, [beginServerWork, endServerWork, enterOffline, listId, markOnlineRecovered, pulseServerWorkProgress, userId])

  const isInitialSyncing = isFetching && !hasCompletedInitialFetch && !!list

  const refreshList = useCallback(() => {
    void fetchList()
  }, [fetchList])

  // Initial fetch
  useEffect(() => {
    fetchList()
  }, [fetchList])

  const lastRecoveryFetchGenRef = useRef(0)
  useEffect(() => {
    if (!userId || !listId) return
    if (recoveryFetchGeneration <= lastRecoveryFetchGenRef.current) return
    lastRecoveryFetchGenRef.current = recoveryFetchGeneration
    void fetchList()
  }, [recoveryFetchGeneration, fetchList, listId, userId])

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
    if (userId) {
      void db.transaction('rw', db.listDetails, db.items, db.members, db.item_member_state, db.list_users, async () => {
        await db.listDetails.delete([userId, listId])
        await db.list_users.delete([listId, userId])
        const itemsToDelete = await db.items.where('[userId+listId]').equals([userId, listId]).toArray()
        const membersToDelete = await db.members.where('[userId+listId]').equals([userId, listId]).toArray()
        const imsToDelete = await db.item_member_state
          .where('[listId+item_id]')
          .between([listId, Dexie.minKey], [listId, Dexie.maxKey])
          .toArray()
        for (const row of itemsToDelete) await db.items.delete([userId, listId, row.id])
        for (const row of membersToDelete) await db.members.delete([userId, listId, row.id])
        for (const ims of imsToDelete) await db.item_member_state.delete([listId, ims.item_id, ims.member_id])
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
  }, [userId, listId, fetchList])

  const addItem = async (text: string, category?: number, comment?: string | null) => {
    if (!userId) {
      return { data: null, error: { message: 'Not authenticated' } }
    }
    if (!tryBeginItemQueueableMutation()) {
      return { data: null, error: { message: blockedMutationMessage() } }
    }
    try {
      const id = await addItemMutation({
        userId,
        listId,
        text,
        category: normalizeItemCategory(category ?? 1),
      })
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      return { data: { id } as Item, error: null }
    } catch (error) {
      return { data: null, error: { message: rpcFailureMessage(error) } }
    } finally {
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
      const nowMs = Date.now()
      await db.transaction('rw', db.sync_queue, async () => {
        await db.sync_queue.put({
          listId,
          itemKey: `bulk-add-items:${listId}`,
          kind: 'bulkAddListItems',
          entity: 'item',
          payload: {
            list_id: listId,
            category: cat,
            lines: trimmed,
          },
          updatedAt: nowMs,
          attemptCount: 0,
          lastError: null,
        })
      })
      return { error: null, inserted: trimmed.length }
    } catch (error) {
      return { error: { message: rpcFailureMessage(error) }, inserted: 0 }
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
    try {
      const persistedUpdates = { ...updates }
      const nowMs = Date.now()
      const nowIso = new Date(nowMs).toISOString()
      const dbPatch: Partial<Item> & { updated_at: string } = { updated_at: nowIso }
      if (persistedUpdates.text !== undefined) dbPatch.text = persistedUpdates.text
      if (persistedUpdates.comment !== undefined) dbPatch.comment = persistedUpdates.comment
      if (persistedUpdates.category !== undefined) dbPatch.category = persistedUpdates.category
      if (persistedUpdates.archived !== undefined) dbPatch.archived = persistedUpdates.archived
      if (persistedUpdates.archived_at !== undefined) dbPatch.archived_at = persistedUpdates.archived_at
      if (persistedUpdates.sort_order !== undefined) dbPatch.sort_order = persistedUpdates.sort_order

      await db.transaction('rw', db.items, db.sync_queue, async () => {
        await db.items.update([userId, listId, itemId], dbPatch)
        const payload: Record<string, unknown> = { id: itemId }
        if (persistedUpdates.text !== undefined) payload.text = persistedUpdates.text
        if (persistedUpdates.comment !== undefined) payload.comment = persistedUpdates.comment
        if (persistedUpdates.category !== undefined) payload.category = persistedUpdates.category
        if (persistedUpdates.archived !== undefined) payload.archived = persistedUpdates.archived
        if (persistedUpdates.archived_at !== undefined) payload.archived_at = persistedUpdates.archived_at
        if (persistedUpdates.sort_order !== undefined) payload.sort_order = persistedUpdates.sort_order
        await db.sync_queue.put({
          listId,
          itemKey: itemId,
          kind: 'patchServerItem',
          entity: 'item',
          payload,
          updatedAt: nowMs,
          attemptCount: 0,
          lastError: null,
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
      return { error: null }
    } catch (error) {
      return { error: { message: rpcFailureMessage(error) } }
    } finally {
      mutationGate.end()
    }
  }

  updateItemRef.current = updateItem

  const deleteItem = async (itemId: string) => {
    if (isTempEntityId(itemId)) {
      return { error: { message: STILL_SAVING_TEMP_ENTITY_MSG } }
    }
    if (!userId) {
      return { error: { message: 'Not authenticated' } }
    }
    if (!tryBeginItemQueueableMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    try {
      await softDeleteItemMutation(userId, listId, itemId)
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      delete desiredArchivedByItemRef.current[itemId]
      return { error: null }
    } catch (error) {
      return { error: { message: rpcFailureMessage(error) } }
    } finally {
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
    try {
      const memberId = await addMemberMutation({
        userId,
        listId,
        name,
      })
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      return { data: { id: memberId, creator: creatorNickname ? { nickname: creatorNickname } : null }, error: null }
    } catch (error) {
      return { data: null, error: { message: rpcFailureMessage(error) } }
    } finally {
      mutationGate.end()
    }
  }

  const updateMember = async (memberId: string, updates: Partial<Member>) => {
    if (!userId) return { error: { message: 'Not authenticated' } }
    if (!tryBeginItemQueueableMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    try {
      const nowMs = Date.now()
      const nowIso = new Date(nowMs).toISOString()
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      await db.transaction('rw', db.members, db.sync_queue, async () => {
        const memberPatch: Record<string, unknown> = { updated_at: nowIso }
        if (updates.name !== undefined) memberPatch.name = updates.name
        if (updates.is_public !== undefined) memberPatch.is_public = updates.is_public
        if (updates.is_target !== undefined) memberPatch.is_target = updates.is_target
        if (updates.sort_order !== undefined) memberPatch.sort_order = updates.sort_order
        await db.members.update([userId, listId, memberId], memberPatch)
        await db.sync_queue.put({
          listId,
          itemKey: memberProfileOutboxKey(memberId),
          kind: 'patchMember',
          entity: 'member',
          payload: {
            memberId,
            ...(updates.name !== undefined ? { name: updates.name } : {}),
            ...(updates.is_public !== undefined ? { is_public: updates.is_public } : {}),
          },
          updatedAt: nowMs,
          attemptCount: 0,
          lastError: null,
        })
      })
      return { error: null }
    } catch (error) {
      return { error: { message: rpcFailureMessage(error) } }
    } finally {
      mutationGate.end()
    }
  }

  const deleteMember = async (memberId: string) => {
    if (isTempEntityId(memberId)) {
      return { error: { message: STILL_SAVING_TEMP_ENTITY_MSG } }
    }
    if (!userId) return { error: { message: 'Not authenticated' } }
    if (!tryBeginItemQueueableMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    try {
      const nowMs = Date.now()
      const nowIso = new Date(nowMs).toISOString()
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      await db.transaction('rw', db.members, db.item_member_state, db.sync_queue, async () => {
        await db.members.update([userId, listId, memberId], {
          deleted_at: nowMs,
          updated_at: nowIso,
        })
        const memberStates = await db.item_member_state
          .where('[listId+member_id]')
          .equals([listId, memberId])
          .toArray()
        for (const state of memberStates) {
          await db.item_member_state.update([listId, state.item_id, state.member_id], {
            deleted_at: nowMs,
          })
        }
        await db.sync_queue.put({
          listId,
          itemKey: memberProfileOutboxKey(memberId),
          kind: 'delete',
          entity: 'member',
          payload: { id: memberId },
          updatedAt: nowMs,
          attemptCount: 0,
          lastError: null,
        })
      })
      return { error: null }
    } catch (error) {
      return { error: { message: rpcFailureMessage(error) } }
    } finally {
      mutationGate.end()
    }
  }

  const ownMember = async (memberId: string, creatorNickname?: string) => {
    if (isTempEntityId(memberId)) {
      return { error: { message: STILL_SAVING_TEMP_ENTITY_MSG } }
    }
    // Ownership changes can remap IDs; keep this online-only until queued remap lands.
    if (!canMutateNow()) {
      return { error: { message: blockedMutationMessage() } }
    }
    if (!tryBeginMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    try {
      const existing = members.find((m) => m.id === memberId)
      if (existing && existing.created_by === userId) {
        return { error: null, newMemberId: memberId }
      }
      const { data, error } = await trackSaveOperation(
        supabase.rpc('own_member', { p_member_id: memberId })
      )

      if (error) {
        if (isLikelyConnectivityError(error)) {
          enterOffline()
          return { error: { message: blockedMutationMessage() } }
        }
        return { error: { ...error, message: error.message || 'Failed to take ownership' } }
      }

      const newMember: MemberWithCreator = {
        ...data.member,
        creator: creatorNickname ? { nickname: creatorNickname } : (data.member.creator ?? null),
      }

      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      setMembers(prev => prev.map(m => m.id === memberId ? newMember : m))
      setItems(prev => prev.map(item => {
        const oldState = item.memberStates[memberId]
        if (!oldState) return item
        const { [memberId]: _, ...rest } = item.memberStates
        return {
          ...item,
          memberStates: { ...rest, [newMember.id]: { ...oldState, member_id: newMember.id } },
        }
      }))

      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'member_owned',
          payload: { oldMemberId: memberId, newMemberId: newMember.id }
        })
      }

      return { error: null, newMemberId: newMember.id }
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
    if (!tryBeginItemQueueableMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    try {
      const existingState = items.find(i => i.id === itemId)?.memberStates[memberId]
      const optimisticState: ItemMemberState = {
        item_id: itemId,
        member_id: memberId,
        quantity: updates.quantity ?? existingState?.quantity ?? 1,
        done: updates.done ?? existingState?.done ?? false,
        assigned: updates.assigned ?? existingState?.assigned ?? false,
        updated_at: new Date().toISOString(),
      }
      await toggleItemMemberStateMutation({
        listId,
        itemId,
        memberId,
        state: optimisticState,
      })
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      return { error: null }
    } catch (error) {
      return { error: { message: rpcFailureMessage(error) } }
    } finally {
      mutationGate.end()
    }
  }

  const changeQuantity = async (itemId: string, memberId: string, delta: number) => {
    if (isOfflineActionsDisabled) {
      return { data: null, error: { message: blockedMutationMessage() } }
    }
    if (!tryBeginItemQueueableMutation()) {
      return { data: null, error: { message: blockedMutationMessage() } }
    }
    try {
      const previousState = items.find(item => item.id === itemId)?.memberStates[memberId]
      const optimisticState: ItemMemberState = {
        item_id: itemId,
        member_id: memberId,
        quantity: Math.max(1, (previousState?.quantity || 1) + delta),
        done: previousState?.done || false,
        assigned: previousState?.assigned ?? true,
        updated_at: new Date().toISOString(),
      }
      await toggleItemMemberStateMutation({
        listId,
        itemId,
        memberId,
        state: optimisticState,
      })
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      return { data: optimisticState.quantity, error: null }
    } catch (error) {
      return { data: null, error: { message: rpcFailureMessage(error) } }
    } finally {
      mutationGate.end()
    }
  }

  const deleteArchivedItems = async () => {
    const archivedIds = new Set(items.filter(i => i.archived).map(i => i.id))
    if (archivedIds.size === 0) return { error: null, count: 0 }
    if (!userId) return { error: { message: 'Not authenticated' }, count: 0 }

    if (!tryBeginItemQueueableMutation()) {
      return { error: { message: blockedMutationMessage() }, count: 0 }
    }
    try {
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 3000
      const nowMs = Date.now()
      const nowIso = new Date(nowMs).toISOString()
      await db.transaction('rw', db.items, db.sync_queue, async () => {
        for (const itemId of archivedIds) {
          await db.items.update([userId, listId, itemId], {
            deleted_at: nowMs,
            updated_at: nowIso,
          })
          await db.sync_queue.put({
            listId,
            itemKey: `item:${itemId}`,
            kind: 'delete',
            entity: 'item',
            payload: { id: itemId },
            updatedAt: nowMs,
            attemptCount: 0,
            lastError: null,
          })
        }
      })
      return { error: null, count: archivedIds.size }
    } catch (error) {
      return { error: { message: rpcFailureMessage(error) }, count: 0 }
    } finally {
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
    try {
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 3000
      const nowMs = Date.now()
      const nowIso = new Date(nowMs).toISOString()
      await db.transaction('rw', db.items, db.sync_queue, async () => {
        for (const itemId of archivedIds) {
          await db.items.update([userId, listId, itemId], {
            archived: false,
            archived_at: null,
            updated_at: nowIso,
          })
          await db.sync_queue.put({
            listId,
            itemKey: itemId,
            kind: 'patchServerItem',
            entity: 'item',
            payload: { id: itemId, archived: false, archived_at: null },
            updatedAt: nowMs,
            attemptCount: 0,
            lastError: null,
          })
        }
      })
      return { error: null, count: archivedIds.length }
    } catch (error) {
      return { error: { message: rpcFailureMessage(error) }, count: 0 }
    } finally {
      mutationGate.end()
    }
  }

  const reorderItems = async (reorderedItems: ItemWithState[]) => {
    if (!userId) return { error: { message: 'Not authenticated' } }
    if (!tryBeginItemQueueableMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    try {
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Math.max(skipRealtimeUntilRef.current, Date.now() + 2000)
      const nowMs = Date.now()
      const nowIso = new Date(nowMs).toISOString()
      const itemIds = reorderedItems.map((item) => item.id)
      await db.transaction('rw', db.items, db.sync_queue, async () => {
        for (const [index, item] of reorderedItems.entries()) {
          await db.items.update([userId, listId, item.id], {
            sort_order: index,
            updated_at: nowIso,
          })
        }
        await db.sync_queue.put({
          listId,
          itemKey: `reorder-items:${listId}`,
          kind: 'reorderListItems',
          entity: 'item',
          payload: { list_id: listId, item_ids: itemIds },
          updatedAt: nowMs,
          attemptCount: 0,
          lastError: null,
        })
      })
      return { error: null }
    } catch (error) {
      return { error: { message: rpcFailureMessage(error) } }
    } finally {
      mutationGate.end()
    }
  }

  const updateMemberFilter = async (filter: MemberFilter) => {
    if (!tryBeginMutation()) {
      return
    }
    try {
      const prev = memberFilter
      setMemberFilter(filter)
      setCachedPrefs(listId, { memberFilter: filter }, userId)
      if (prev === 'all' && filter !== 'all') {
        setLastViewedMembers(new Date().toISOString())
      }
      if (userId) {
        const { error } = await trackSaveOperation(
          supabase
            .from('list_users')
            .update({ member_filter: filter })
            .eq('list_id', listId)
            .eq('user_id', userId)
        )
        if (error) {
          setMemberFilter(prev)
          setCachedPrefs(listId, { memberFilter: prev }, userId)
        }
      }
    } finally {
      mutationGate.end()
    }
  }

  const updateItemTextWidth = async (width: number) => {
    if (!tryBeginMutation()) {
      return
    }
    try {
      const newWidth = Math.max(80, width)
      const prevWidth = itemTextWidth
      const prevMode = itemTextWidthMode
      const value = String(newWidth)
      setItemTextWidth(newWidth)
      setItemTextWidthMode('manual')
      setCachedPrefs(listId, { itemTextWidth: value }, userId)
      if (userId) {
        const { error } = await trackSaveOperation(
          supabase
            .from('list_users')
            .update({ item_text_width: value })
            .eq('list_id', listId)
            .eq('user_id', userId)
        )
        if (error) {
          setItemTextWidth(prevWidth)
          setItemTextWidthMode(prevMode)
          setCachedPrefs(listId, { itemTextWidth: prevMode === 'auto' ? 'auto' : String(prevWidth) }, userId)
        }
      }
    } finally {
      mutationGate.end()
    }
  }

  const updateItemTextWidthMode = async (mode: WidthMode) => {
    if (!tryBeginMutation()) {
      return
    }
    try {
      const prevMode = itemTextWidthMode
      const prevWidth = itemTextWidth
      if (mode === 'auto') {
        const texts = [
          ...items.map(i => i.text ?? ''),
          ...sumRowTitlesForAutoWidth(sumScope, items),
        ]
        const fitWidth = measureFitItemTextWidthPx(texts, itemNameFontStep)
        setItemTextWidth(fitWidth)
      }
      setItemTextWidthMode(mode)
      const value = mode === 'auto' ? 'auto' : String(itemTextWidth)
      setCachedPrefs(listId, { itemTextWidth: value }, userId)
      if (userId) {
        const { error } = await trackSaveOperation(
          supabase
            .from('list_users')
            .update({ item_text_width: value })
            .eq('list_id', listId)
            .eq('user_id', userId)
        )
        if (error) {
          setItemTextWidthMode(prevMode)
          setItemTextWidth(prevWidth)
          setCachedPrefs(listId, { itemTextWidth: prevMode === 'auto' ? 'auto' : String(prevWidth) }, userId)
        }
      }
    } finally {
      mutationGate.end()
    }
  }

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
      const { error } = await trackSaveOperation(
        supabase
          .from('list_users')
          .update({ sum_scope: next })
          .eq('list_id', listId)
          .eq('user_id', userId),
      )
      if (error) {
        setSumScope(prev)
        setCachedPrefs(listId, { sumScope: prev }, userId)
        return { error: new Error(error.message) }
      }
      return { error: null }
    } finally {
      mutationGate.end()
    }
  }

  const updateItemNameFontStep = useCallback(
    async (step: number) => {
      const s = Math.min(ITEM_NAME_FONT_MAX, Math.max(ITEM_NAME_FONT_MIN, Math.round(step)))
      const prev = itemNameFontStepRef.current
      if (s === prev) return
      if (!tryBeginMutation()) {
        return
      }
      try {
        itemNameFontStepRef.current = s
        setItemNameFontStep(s)
        setCachedPrefs(listId, { itemNameFontStep: s }, userId)
        if (userId) {
          const { error } = await trackSaveOperation(
            supabase
              .from('list_users')
              .update({ item_name_font_step: s })
              .eq('list_id', listId)
              .eq('user_id', userId)
          )
          if (error) {
            itemNameFontStepRef.current = prev
            setItemNameFontStep(prev)
            setCachedPrefs(listId, { itemNameFontStep: prev }, userId)
          }
        }
      } finally {
        mutationGate.end()
      }
    },
    [listId, mutationGate, trackSaveOperation, tryBeginMutation, userId],
  )

  const persistCategoryNamesOnly = async (names: CategoryNames) => {
    const prev = categoryNames
    const prevList = list
    const nonEmpty: Record<string, string> = {}
    for (const [k, v] of Object.entries(names)) {
      if (v) nonEmpty[k] = v
    }
    const serialized = Object.keys(nonEmpty).length > 0 ? JSON.stringify(nonEmpty) : '{}'
    mutationVersionRef.current += 1
    setCategoryNames({ ...EMPTY_CATEGORY_NAMES, ...names })
    setList(l => l ? { ...l, category_names: serialized } : l)

    const { error } = await trackSaveOperation(
      supabase
        .from('lists')
        .update({ category_names: serialized })
        .eq('id', listId)
    )
    if (error) {
      setCategoryNames(prev)
      setList(prevList)
      return { error }
    }
    return { error: null }
  }

  const persistCategoryOrderOnly = async (order: number[]) => {
    const prev = categoryOrder
    const prevList = list
    const serialized = JSON.stringify(order)
    mutationVersionRef.current += 1
    setCategoryOrder(order)
    setList(l => l ? { ...l, category_order: serialized } : l)

    const { error } = await trackSaveOperation(
      supabase
        .from('lists')
        .update({ category_order: serialized })
        .eq('id', listId)
    )
    if (error) {
      setCategoryOrder(prev)
      setList(prevList)
      return { error }
    }
    return { error: null }
  }

  const updateCategoryNames = async (names: CategoryNames) => {
    if (!tryBeginMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    try {
      return await persistCategoryNamesOnly(names)
    } finally {
      mutationGate.end()
    }
  }

  const updateCategoryOrder = async (order: number[]) => {
    if (!tryBeginMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    try {
      return await persistCategoryOrderOnly(order)
    } finally {
      mutationGate.end()
    }
  }

  const saveCategorySettings = async (names: CategoryNames, order: number[]) => {
    if (!tryBeginMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    try {
      const r1 = await persistCategoryNamesOnly(names)
      if (r1.error) return r1
      return await persistCategoryOrderOnly(order)
    } finally {
      mutationGate.end()
    }
  }

  const createTargets = async () => {
    if (!userId) return
    if (isOfflineActionsDisabled) return
    const hasTarget = members.some(m => m.is_target)
    if (hasTarget) return

    if (!tryBeginMutation()) {
      return
    }
    try {
    if (memberFilter !== 'all') {
      await updateMemberFilter('all')
    }

    const maxSortOrder = members.reduce((max, m) => Math.max(max, m.sort_order || 0), 0)
    const memberId = crypto.randomUUID()
    const now = new Date().toISOString()
    const creatorFromProfile = profile?.nickname ? { nickname: profile.nickname } : null
    const optimisticTarget: MemberWithCreator = {
      id: memberId,
      list_id: listId,
      name: 'Qty',
      created_by: userId,
      sort_order: 0,
      is_public: false,
      is_target: true,
      created_at: now,
      updated_at: now,
      creator: creatorFromProfile,
    }
    mutationVersionRef.current += 1
    skipRealtimeUntilRef.current = Date.now() + 2000
    setMembers(prev => [optimisticTarget, ...prev])

    const { data, error: insertError } = await trackSaveOperation(
      supabase
        .from('members')
        .insert({
          id: memberId,
          list_id: listId,
          name: 'Qty',
          created_by: userId,
          sort_order: 0,
          is_public: false,
          is_target: true,
        })
        .select()
        .single()
    )

    if (insertError || !data) {
      setMembers(prev => prev.filter(m => m.id !== memberId))
      return
    }

    const targetWithCreator: MemberWithCreator = {
      ...data,
      creator: creatorFromProfile,
    }

    setMembers(prev => {
      const next = prev.map(m => m.id === memberId ? targetWithCreator : m)
      const deduped: MemberWithCreator[] = []
      for (const m of next) {
        if (!deduped.some(e => e.id === m.id)) deduped.push(m)
      }
      return deduped
    })
    markOnlineRecovered()

    if (items.length > 0) {
      const stateRows = items.map(i => ({
        item_id: i.id,
        member_id: memberId,
        quantity: 1,
        done: false,
        assigned: true,
      }))

      setItems(prev => prev.map(i => ({
        ...i,
        memberStates: {
          ...i.memberStates,
          [memberId]: {
            item_id: i.id,
            member_id: memberId,
            quantity: 1,
            done: false,
            assigned: true,
            updated_at: now,
          },
        },
      })))

      await trackSaveOperation(
        supabase.from('item_member_state').insert(stateRows)
      )
    }
    } finally {
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
    updateItemNameFontStep,
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
    updateItemTextWidth,
    updateItemTextWidthMode,
    updateCategoryNames,
    updateCategoryOrder,
    saveCategorySettings,
    lastViewedMembers,
    createTargets,
    sumScope,
    updateListUserSumScope,
    isOfflineActionsDisabled,
    allowItemMutationQueue,
  }
}
