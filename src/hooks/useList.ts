'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { getActiveCacheUserId, getCachedList, setCachedList, removeCachedList } from '@/lib/cache'
import { perfLog } from '@/lib/startupPerfLog'
import { appendOfflineNavDiagnostic } from '@/lib/offlineNavDiagnostics'
import {
  isLikelyConnectivityError,
  resolveServerWorkOutcomeFromResult,
  resolveServerWorkOutcomeFromThrown,
  type ServerWorkOutcome,
} from '@/lib/connectivityErrors'
import { STILL_SAVING_TEMP_ENTITY_MSG } from '@/lib/mutationToastPolicy'
import {
  enqueueItemMutation,
  getPendingItemMutationsForList,
  itemMemberStateOutboxKey,
  memberProfileOutboxKey,
  mergeQueuedCreateArchived,
  remapMemberDependentQueuedRecords,
  removePendingItemMutation,
  sortPendingForDrain,
  type QueuedCreatePayload,
  type QueuedPatchServerItemRecord,
} from '@/lib/itemMutationOutbox'
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
}

const FETCH_TIMEOUT_MS = 10_000
const SAVE_TIMEOUT_MS = 10_000
function createTempId(prefix: string) {
  return `temp-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function isTempEntityId(id: string) {
  return id.startsWith('temp-')
}

function patchServerItemEnqueuePayload(
  listId: string,
  itemId: string,
  u: Partial<Item>,
): QueuedPatchServerItemRecord | null {
  const rec: QueuedPatchServerItemRecord = {
    kind: 'patchServerItem',
    listId,
    itemKey: itemId,
    updatedAt: Date.now(),
  }
  let any = false
  if (u.text !== undefined) {
    rec.text = u.text
    any = true
  }
  if (u.comment !== undefined) {
    rec.comment = u.comment
    any = true
  }
  if (u.category !== undefined) {
    rec.category = u.category
    any = true
  }
  if (u.archived !== undefined) {
    rec.archived = u.archived
    rec.archived_at = u.archived_at ?? null
    any = true
  }
  return any ? rec : null
}

function memberUpdateIsProfileOnly(updates: Partial<Member>): boolean {
  const keys = Object.keys(updates).filter(k => (updates as Record<string, unknown>)[k] !== undefined)
  return keys.length > 0 && keys.every(k => k === 'name' || k === 'is_public')
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
  /** First mutation version captured when a debounced realtime fetch is scheduled; preserved across reschedules until that fetch completes. */
  const realtimeScheduleCaptureVersionRef = useRef<number | null>(null)
  const scheduleRealtimeFetchRef = useRef<(delayMs: number) => void>(() => {})
  const userId = user?.id ?? (authLoading ? bootstrapUserId : null)

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

  const outboxDrainingRef = useRef(false)

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
        if (process.env.NODE_ENV === 'development') {
          console.log('[useList] delayed fetch discarded (stale)', {
            listId,
            capturedVersion: staleCheck,
            currentMutationVersion: mutationVersionRef.current,
          })
        }
        return
      }

      if (staleCheck != null && process.env.NODE_ENV === 'development') {
        console.log('[useList] delayed fetch applied', {
          listId,
          capturedVersion: staleCheck,
          currentMutationVersion: mutationVersionRef.current,
        })
      }

      // Mark that we have access
      hadAccessRef.current = true
      setList(data.list)
      setMembers(data.members || [])
      const nextItems = normalizeItemsCategory(data.items || [])
      const pendingMutations = await getPendingItemMutationsForList(listId)
      const pendingCreateTempIds = new Set(
        pendingMutations.filter((m) => m.kind === 'create').map((m) => m.itemKey),
      )
      setItems((prev) => {
        const preservedOptimistic = prev.filter(
          (item) => isTempEntityId(item.id) && pendingCreateTempIds.has(item.id),
        )
        if (preservedOptimistic.length === 0) return nextItems
        const merged = [...nextItems]
        for (const optimistic of preservedOptimistic) {
          if (!merged.some((row) => row.id === optimistic.id)) {
            merged.push(optimistic)
          }
        }
        return merged
      })
      setCategoryNames(parseCategoryNames(data.list.category_names))
      setCategoryOrder(parseCategoryOrder(data.list.category_order))
      hasInitialDataRef.current = true

      // Cache the list data for instant load next time
      setCachedList(userId, listId, {
        list: data.list,
        items: nextItems,
        members: data.members || []
      })
      listCount = 1
      itemCountResult = nextItems.length

      if (listUserData) {
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
    }
  }, [beginServerWork, endServerWork, enterOffline, listId, markOnlineRecovered, pulseServerWorkProgress, userId])

  const drainItemMutationOutbox = useCallback(async () => {
    if (!userId || !listId || outboxDrainingRef.current || fetchingRef.current) return
    appendOfflineNavDiagnostic(`[outbox-drain] start listId=${listId} status=${connectivityStatusRef.current}`)
    const pendingRaw = await getPendingItemMutationsForList(listId)
    const pending = sortPendingForDrain(pendingRaw)
    if (pending.length === 0) return
    outboxDrainingRef.current = true
    let anySuccess = false
    try {
      for (const rec of pending) {
        if (connectivityStatusRef.current !== 'online') break
        mutationVersionRef.current += 1
        try {
          if (rec.kind === 'create') {
            appendOfflineNavDiagnostic(
              `[db-write] target=supabase table=items action=insert-start listId=${listId} itemKey=${rec.itemKey}`,
            )
            const p = rec.payload
            const { data, error } = await trackSaveOperation(
              supabase
                .from('items')
                .insert({
                  list_id: listId,
                  text: p.text,
                  sort_order: p.sort_order,
                  category: p.category,
                  ...(p.comment != null && p.comment !== '' ? { comment: p.comment } : {}),
                  archived: p.archived,
                  archived_at: p.archived_at,
                })
                .select()
                .single(),
            )
            if (error) throw error
            if (!data) throw new Error('missing row')
            appendOfflineNavDiagnostic(
              `[db-write] target=supabase table=items action=insert-end listId=${listId} itemKey=${rec.itemKey} serverItemId=${data.id}`,
            )
            const memRows = Object.entries(p.memberStates).map(([memberId, st]) => ({
              item_id: data.id,
              member_id: memberId,
              quantity: st.quantity,
              done: st.done,
              assigned: st.assigned,
            }))
            if (memRows.length > 0) {
              appendOfflineNavDiagnostic(
                `[db-write] target=supabase table=item_member_state action=insert-start listId=${listId} itemKey=${rec.itemKey} rowCount=${memRows.length}`,
              )
              const { error: mErr } = await trackSaveOperation(
                supabase.from('item_member_state').insert(memRows),
              )
              if (mErr) throw mErr
              appendOfflineNavDiagnostic(
                `[db-write] target=supabase table=item_member_state action=insert-end listId=${listId} itemKey=${rec.itemKey} rowCount=${memRows.length}`,
              )
            }
            const newMemberStates: Record<string, ItemMemberState> = {}
            for (const [mid, st] of Object.entries(p.memberStates)) {
              newMemberStates[mid] = { ...st, item_id: data.id }
            }
            setItems(prev =>
              prev.map(item =>
                item.id === rec.itemKey ? ({ ...data, memberStates: newMemberStates } as ItemWithState) : item,
              ),
            )
            await removePendingItemMutation(listId, rec.itemKey)
            anySuccess = true
          } else if (rec.kind === 'addMember') {
            if (!userId) break
            appendOfflineNavDiagnostic(
              `[db-write] target=supabase table=members action=insert-start listId=${listId} itemKey=${rec.itemKey}`,
            )
            const { data, error } = await trackSaveOperation(
              supabase
                .from('members')
                .insert({
                  list_id: listId,
                  name: rec.name,
                  created_by: userId,
                  sort_order: rec.sort_order,
                })
                .select()
                .single(),
            )
            if (error) throw error
            if (!data) throw new Error('missing member row')
            await remapMemberDependentQueuedRecords(listId, rec.itemKey, data.id)
            const memberWithCreator: MemberWithCreator = {
              ...data,
              creator: rec.creator_nickname ? { nickname: rec.creator_nickname } : null,
            }
            setMembers(prev => prev.map(m => (m.id === rec.itemKey ? memberWithCreator : m)))
            setItems(prev =>
              prev.map(item => {
                if (!item.memberStates[rec.itemKey]) return item
                const { [rec.itemKey]: st, ...rest } = item.memberStates
                return {
                  ...item,
                  memberStates: { ...rest, [data.id]: { ...st, member_id: data.id } },
                }
              }),
            )
            appendOfflineNavDiagnostic(
              `[db-write] target=supabase table=members action=insert-end listId=${listId} itemKey=${rec.itemKey} serverMemberId=${data.id}`,
            )
            await removePendingItemMutation(listId, rec.itemKey)
            anySuccess = true
          } else if (rec.kind === 'patchServerItem' || rec.kind === 'patchArchived') {
            const patch: Record<string, unknown> =
              rec.kind === 'patchArchived'
                ? { archived: rec.archived, archived_at: rec.archived_at }
                : {
                    ...(rec.text !== undefined ? { text: rec.text } : {}),
                    ...(rec.comment !== undefined ? { comment: rec.comment } : {}),
                    ...(rec.category !== undefined ? { category: rec.category } : {}),
                    ...(rec.archived !== undefined
                      ? { archived: rec.archived, archived_at: rec.archived_at }
                      : {}),
                  }
            if (Object.keys(patch).length === 0) {
              await removePendingItemMutation(listId, rec.itemKey)
              anySuccess = true
            } else {
              appendOfflineNavDiagnostic(
                `[db-write] target=supabase table=items action=update-patch-start listId=${listId} itemKey=${rec.itemKey}`,
              )
              const { error } = await trackSaveOperation(
                supabase.from('items').update(patch).eq('id', rec.itemKey),
              )
              if (error) throw error
              appendOfflineNavDiagnostic(
                `[db-write] target=supabase table=items action=update-patch-end listId=${listId} itemKey=${rec.itemKey}`,
              )
              await removePendingItemMutation(listId, rec.itemKey)
              anySuccess = true
            }
          } else if (rec.kind === 'itemMemberState') {
            const row = {
              item_id: rec.itemId,
              member_id: rec.memberId,
              quantity: rec.quantity,
              done: rec.done,
              assigned: rec.assigned,
            }
            if (rec.insert) {
              appendOfflineNavDiagnostic(
                `[db-write] target=supabase table=item_member_state action=insert-start listId=${listId} ims=${rec.itemKey}`,
              )
              const { error } = await trackSaveOperation(supabase.from('item_member_state').insert(row))
              if (error) throw error
            } else {
              appendOfflineNavDiagnostic(
                `[db-write] target=supabase table=item_member_state action=update-start listId=${listId} ims=${rec.itemKey}`,
              )
              const { error } = await trackSaveOperation(
                supabase
                  .from('item_member_state')
                  .update({
                    quantity: rec.quantity,
                    done: rec.done,
                    assigned: rec.assigned,
                  })
                  .eq('item_id', rec.itemId)
                  .eq('member_id', rec.memberId),
              )
              if (error) throw error
            }
            const updatedAt = new Date().toISOString()
            setItems(prev =>
              prev.map(item =>
                item.id === rec.itemId
                  ? {
                      ...item,
                      memberStates: {
                        ...item.memberStates,
                        [rec.memberId]: {
                          item_id: rec.itemId,
                          member_id: rec.memberId,
                          quantity: rec.quantity,
                          done: rec.done,
                          assigned: rec.assigned,
                          updated_at: updatedAt,
                        },
                      },
                    }
                  : item,
              ),
            )
            await removePendingItemMutation(listId, rec.itemKey)
            anySuccess = true
          } else if (rec.kind === 'patchMember') {
            appendOfflineNavDiagnostic(
              `[db-write] target=supabase rpc=update_member action=start listId=${listId} memberId=${rec.memberId}`,
            )
            const { error } = await trackSaveOperation(
              supabase.rpc('update_member', {
                p_member_id: rec.memberId,
                p_name: rec.name !== undefined ? rec.name : null,
                p_is_public: rec.is_public !== undefined ? rec.is_public : null,
              }),
            )
            if (error) throw error
            setMembers(prev =>
              prev.map(m => {
                if (m.id !== rec.memberId) return m
                let next: MemberWithCreator = m
                if (rec.name !== undefined) next = { ...next, name: rec.name as string }
                if (rec.is_public !== undefined) next = { ...next, is_public: Boolean(rec.is_public) }
                return next
              }),
            )
            appendOfflineNavDiagnostic(
              `[db-write] target=supabase rpc=update_member action=end listId=${listId} memberId=${rec.memberId}`,
            )
            await removePendingItemMutation(listId, rec.itemKey)
            anySuccess = true
          } else {
            const _exhaust: never = rec
            void _exhaust
            appendOfflineNavDiagnostic(`[outbox-drain] unknown record kind listId=${listId}`)
            break
          }
        } catch (e) {
          appendOfflineNavDiagnostic(
            `[outbox-drain] error listId=${listId} itemKey=${rec.itemKey} connectivity-ish=${isLikelyConnectivityError(e) ? 1 : 0} msg=${e instanceof Error ? e.message : String(e)}`,
          )
          if (isLikelyConnectivityError(e)) {
            enterOffline('outbox-drain-connectivity-error')
          }
          break
        }
      }
    } finally {
      outboxDrainingRef.current = false
      appendOfflineNavDiagnostic(
        `[outbox-drain] end listId=${listId} anySuccess=${anySuccess ? 1 : 0} status=${connectivityStatusRef.current}`,
      )
    }
    if (anySuccess && connectivityStatusRef.current === 'online') {
      mutationVersionRef.current += 1
      await fetchList()
    }
  }, [userId, listId, fetchList, enterOffline])

  useEffect(() => {
    if (connectivityStatus !== 'online' || !userId || !listId) return
    void drainItemMutationOutbox()
  }, [connectivityStatus, userId, listId, drainItemMutationOutbox, loading, hasCompletedInitialFetch])

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
  }, [userId, listId, list, items, members])

  useEffect(() => {
    if (!accessDenied) return
    removeCachedList(userId, listId)
  }, [accessDenied, userId, listId])

  // Real-time subscriptions
  useEffect(() => {
    if (!userId || !listId) return

    const scheduleRealtimeFetch = (delayMs: number) => {
      if (realtimeScheduleCaptureVersionRef.current === null) {
        realtimeScheduleCaptureVersionRef.current = mutationVersionRef.current
        if (process.env.NODE_ENV === 'development') {
          console.log('[useList] realtime fetch scheduled, captured mutation version', realtimeScheduleCaptureVersionRef.current, { listId })
        }
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
    if (!tryBeginItemQueueableMutation()) {
      return { data: null, error: { message: blockedMutationMessage() } }
    }
    try {
      const maxSortOrder = items.length > 0
        ? items.reduce((max, item) => Math.max(max, item.sort_order ?? 0), 0)
        : 0
      const newSortOrder = items.length > 0 ? maxSortOrder + 1 : 0
      const tempId = createTempId('item')
      const now = new Date().toISOString()
      const targetMember = members.find(m => m.is_target)
      const newMemberStates: Record<string, ItemMemberState> = {}
      if (targetMember) {
        newMemberStates[targetMember.id] = {
          item_id: tempId,
          member_id: targetMember.id,
          quantity: 1,
          done: false,
          assigned: true,
          updated_at: now,
        }
      }
      const optimisticItem: ItemWithState = {
        id: tempId,
        list_id: listId,
        text,
        comment: comment || null,
        archived: false,
        archived_at: null,
        sort_order: newSortOrder,
        category: category ?? 1,
        created_at: now,
        updated_at: now,
        memberStates: newMemberStates,
      }

      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      setItems(prev => [...prev, optimisticItem])

      const queuedPayload: QueuedCreatePayload = {
        text,
        category: category ?? 1,
        comment: comment || null,
        sort_order: newSortOrder,
        archived: false,
        archived_at: null,
        memberStates: { ...newMemberStates },
      }

      const persistQueuedCreate = async () => {
        await enqueueItemMutation({
          kind: 'create',
          listId,
          itemKey: tempId,
          updatedAt: Date.now(),
          payload: queuedPayload,
        })
      }

      if (!canMutateNow()) {
        await persistQueuedCreate()
        return { data: null, error: null }
      }

      const { data, error } = await trackSaveOperation(
        supabase
          .from('items')
          .insert({
            list_id: listId,
            text,
            sort_order: newSortOrder,
            ...(category != null && { category }),
            ...(comment != null && { comment }),
          })
          .select()
          .single()
      )

      if (error) {
        if (isLikelyConnectivityError(error)) {
          await persistQueuedCreate()
          enterOffline()
          return { data: null, error: { message: blockedMutationMessage() } }
        }
        setItems(prev => prev.filter(item => item.id !== tempId))
        if (error.code === '23505') {
          return { data: null, error: { ...error, message: 'An item with this name already exists' } }
        }
        return { data: null, error }
      }

      const newMemberStatesPersisted: Record<string, ItemMemberState> = {}

      if (targetMember) {
        const targetState: ItemMemberState = {
          item_id: data.id,
          member_id: targetMember.id,
          quantity: 1,
          done: false,
          assigned: true,
          updated_at: new Date().toISOString(),
        }
        newMemberStatesPersisted[targetMember.id] = targetState

        await trackSaveOperation(
          supabase.from('item_member_state').insert({
            item_id: data.id,
            member_id: targetMember.id,
            quantity: 1,
            done: false,
            assigned: true,
          }),
        )
      }

      const newItem: ItemWithState = { ...data, memberStates: newMemberStatesPersisted }
      setItems(prev => {
        let replaced = false
        const next = prev.map(item => {
          if (item.id === tempId) {
            replaced = true
            return newItem
          }
          return item
        })

        const deduped: ItemWithState[] = []
        for (const item of next) {
          if (!deduped.some(existing => existing.id === item.id)) {
            deduped.push(item)
          }
        }

        return replaced ? deduped : [...deduped, newItem]
      })
      markOnlineRecovered()
      return { data, error: null }
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
    if (!tryBeginMutation()) {
      return { error: { message: blockedMutationMessage() }, inserted: 0 }
    }
    try {
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Math.max(skipRealtimeUntilRef.current, Date.now() + 2000)
      const cat = normalizeItemCategory(category)

      const { data, error } = await trackSaveOperation(
        supabase.rpc('bulk_add_list_items', {
          p_list_id: listId,
          p_category: cat,
          p_lines: trimmed,
        }),
      )

      if (error) {
        if (error.code === '23505') {
          return {
            error: { ...error, message: 'An item with this name already exists' },
            inserted: 0,
          }
        }
        return { error, inserted: 0 }
      }

      const inserted = typeof data === 'number' ? data : 0
      markOnlineRecovered()
      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'item_updated',
          payload: { listId, bulkAdd: true },
        })
      }
      mutationVersionRef.current += 1
      await fetchList()
      return { error: null, inserted }
    } finally {
      mutationGate.end()
    }
  }

  const updateItem = async (itemId: string, updates: Partial<Item>) => {
    const previousItem = items.find(item => item.id === itemId)
    const persistedUpdates = { ...updates }

    const onlyArchiveFields = (u: Partial<Item>) => {
      const keys = Object.keys(u).filter(k => (u as Record<string, unknown>)[k] !== undefined)
      return keys.every(k => k === 'archived' || k === 'archived_at')
    }

    if (isTempEntityId(itemId)) {
      if (!previousItem || !onlyArchiveFields(persistedUpdates)) {
        return { error: { message: STILL_SAVING_TEMP_ENTITY_MSG } }
      }
      if (!tryBeginItemQueueableMutation()) {
        return { error: { message: blockedMutationMessage() } }
      }
      try {
        mutationVersionRef.current += 1
        skipRealtimeUntilRef.current = Math.max(
          skipRealtimeUntilRef.current,
          Date.now() + 2000,
        )
        setItems(prev =>
          prev.map(item => (item.id === itemId ? { ...item, ...persistedUpdates } : item)),
        )
        await mergeQueuedCreateArchived(
          listId,
          itemId,
          Boolean(persistedUpdates.archived),
          (persistedUpdates.archived_at ?? null) as string | null,
        )
        return { error: null }
      } finally {
        mutationGate.end()
      }
    }

    if (persistedUpdates.archived === false) {
      desiredArchivedByItemRef.current[itemId] = false
    }

    const optimisticArchiveWithImmediateUndoToast =
      previousItem &&
      !previousItem.archived &&
      persistedUpdates.archived === true &&
      onlyArchiveFields(persistedUpdates)

    if (optimisticArchiveWithImmediateUndoToast) {
      if (archiveDbWriteInflightRef.current[itemId]) {
        return { error: { message: blockedMutationMessage() } }
      }
      if (!tryBeginItemQueueableMutation()) {
        return { error: { message: blockedMutationMessage() } }
      }
      try {
        mutationVersionRef.current += 1
        if (process.env.NODE_ENV === 'development') {
          console.log('[useList] archive start (optimistic + Undo toast), mutation version', mutationVersionRef.current, { listId, itemId })
        }

        desiredArchivedByItemRef.current[itemId] = true

        const skipMs = 'category' in persistedUpdates ? 4500 : 2000
        skipRealtimeUntilRef.current = Math.max(
          skipRealtimeUntilRef.current,
          Date.now() + skipMs
        )
        setItems(prev => prev.map(item =>
          item.id === itemId ? { ...item, ...persistedUpdates } : item
        ))

        if (archiveUndoToastIdRef.current) {
          dismissToast(archiveUndoToastIdRef.current)
        }
        const label =
          previousItem.text.length > 48 ? `${previousItem.text.slice(0, 45)}…` : previousItem.text
        const toastId = showToast(`Archived "${label}"`, 'info', {
          durationMs: 8000,
          action: {
            label: 'Undo',
            onClick: () => {
              dismissToast(toastId)
              if (archiveUndoToastIdRef.current === toastId) {
                archiveUndoToastIdRef.current = null
              }
              void updateItemRef.current(itemId, { archived: false, archived_at: null }).then(
                ({ error: undoErr }) => {
                  if (undoErr?.message) {
                    showErrorToast(undoErr.message)
                  }
                },
              )
            },
          },
        })
        archiveUndoToastIdRef.current = toastId
      } finally {
        mutationGate.end()
      }

      archiveDbWriteInflightRef.current[itemId] = true
      let error: { code?: string; message?: string } | null = null
      if (canMutateNow()) {
        const res = await trackSaveOperation(
          supabase
            .from('items')
            .update(persistedUpdates)
            .eq('id', itemId),
        )
        error = res.error
      }
      archiveDbWriteInflightRef.current[itemId] = false

      const desiredNow = desiredArchivedByItemRef.current[itemId]

      if (error) {
        if (desiredNow === true) {
          if (isLikelyConnectivityError(error)) {
            void enqueueItemMutation({
              kind: 'patchArchived',
              listId,
              itemKey: itemId,
              updatedAt: Date.now(),
              archived: Boolean(persistedUpdates.archived),
              archived_at: (persistedUpdates.archived_at ?? null) as string | null,
            })
            enterOffline()
            if (archiveUndoToastIdRef.current) {
              dismissToast(archiveUndoToastIdRef.current)
              archiveUndoToastIdRef.current = null
            }
            delete desiredArchivedByItemRef.current[itemId]
            return { error: { message: blockedMutationMessage() } }
          }
          if (previousItem) {
            setItems(prev => prev.map(item => item.id === itemId ? previousItem : item))
          }
          delete desiredArchivedByItemRef.current[itemId]
          if (error.code === '23505') {
            return { error: { ...error, message: 'An item with this name already exists' } }
          }
          return { error }
        }
        delete desiredArchivedByItemRef.current[itemId]
        return { error: null }
      }

      if (!canMutateNow() && desiredNow === true) {
        void enqueueItemMutation({
          kind: 'patchArchived',
          listId,
          itemKey: itemId,
          updatedAt: Date.now(),
          archived: true,
          archived_at: (persistedUpdates.archived_at ?? null) as string | null,
        })
        delete desiredArchivedByItemRef.current[itemId]
        if (channelRef.current) {
          channelRef.current.send({
            type: 'broadcast',
            event: 'item_updated',
            payload: { itemId },
          })
        }
        return { error: null }
      }

      if (desiredNow === true) {
        delete desiredArchivedByItemRef.current[itemId]
        if (channelRef.current) {
          channelRef.current.send({
            type: 'broadcast',
            event: 'item_updated',
            payload: { itemId },
          })
        }
        return { error: null }
      }

      if (desiredNow === false) {
        delete desiredArchivedByItemRef.current[itemId]
        mutationVersionRef.current += 1
        skipRealtimeUntilRef.current = Math.max(
          skipRealtimeUntilRef.current,
          Date.now() + 2000
        )
        if (!canMutateNow()) {
          await enqueueItemMutation({
            kind: 'patchArchived',
            listId,
            itemKey: itemId,
            updatedAt: Date.now(),
            archived: false,
            archived_at: null,
          })
          if (channelRef.current) {
            channelRef.current.send({
              type: 'broadcast',
              event: 'item_updated',
              payload: { itemId },
            })
          }
          return { error: null }
        }
        const { error: fixErr } = await trackSaveOperation(
          supabase
            .from('items')
            .update({ archived: false, archived_at: null })
            .eq('id', itemId)
        )
        if (channelRef.current) {
          channelRef.current.send({
            type: 'broadcast',
            event: 'item_updated',
            payload: { itemId },
          })
        }
        if (fixErr) {
          if (isLikelyConnectivityError(fixErr)) {
            await enqueueItemMutation({
              kind: 'patchArchived',
              listId,
              itemKey: itemId,
              updatedAt: Date.now(),
              archived: false,
              archived_at: null,
            })
            enterOffline()
            return { error: { message: blockedMutationMessage() } }
          }
          if (fixErr.code === '23505') {
            return { error: { ...fixErr, message: 'An item with this name already exists' } }
          }
          return { error: fixErr }
        }
        return { error: null }
      }

      delete desiredArchivedByItemRef.current[itemId]
      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'item_updated',
          payload: { itemId },
        })
      }
      return { error: null }
    }

    const onlyArchUpdate = onlyArchiveFields(persistedUpdates)
    if (!onlyArchUpdate && !tryBeginItemQueueableMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    if (onlyArchUpdate && !tryBeginItemQueueableMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    try {
      mutationVersionRef.current += 1
      if (process.env.NODE_ENV === 'development') {
        const archiving = previousItem && !previousItem.archived && persistedUpdates.archived === true
        const restoringUndo = previousItem?.archived && persistedUpdates.archived === false
        if (archiving) {
          console.log('[useList] archive start, mutation version', mutationVersionRef.current, { listId, itemId })
        } else if (restoringUndo) {
          console.log('[useList] undo/restore start, mutation version', mutationVersionRef.current, { listId, itemId })
        }
      }

      const skipMs = 'category' in persistedUpdates ? 4500 : 2000
      skipRealtimeUntilRef.current = Math.max(
        skipRealtimeUntilRef.current,
        Date.now() + skipMs
      )
      setItems(prev => prev.map(item =>
        item.id === itemId ? { ...item, ...persistedUpdates } : item
      ))

      if (onlyArchUpdate && !canMutateNow()) {
        await enqueueItemMutation({
          kind: 'patchArchived',
          listId,
          itemKey: itemId,
          updatedAt: Date.now(),
          archived: Boolean(persistedUpdates.archived),
          archived_at: (persistedUpdates.archived_at ?? null) as string | null,
        })
        return { error: null }
      }

      if (!onlyArchUpdate && !canMutateNow()) {
        const q = patchServerItemEnqueuePayload(listId, itemId, persistedUpdates)
        if (q) await enqueueItemMutation(q)
        return { error: null }
      }

      const { error } = await trackSaveOperation(
        supabase
          .from('items')
          .update(persistedUpdates)
          .eq('id', itemId)
      )

      if (error) {
        if (onlyArchUpdate && isLikelyConnectivityError(error)) {
          await enqueueItemMutation({
            kind: 'patchArchived',
            listId,
            itemKey: itemId,
            updatedAt: Date.now(),
            archived: Boolean(persistedUpdates.archived),
            archived_at: (persistedUpdates.archived_at ?? null) as string | null,
          })
          enterOffline()
          return { error: { message: blockedMutationMessage() } }
        }
        if (!onlyArchUpdate && isLikelyConnectivityError(error)) {
          const q = patchServerItemEnqueuePayload(listId, itemId, persistedUpdates)
          if (q) await enqueueItemMutation(q)
          enterOffline()
          return { error: { message: blockedMutationMessage() } }
        }
        if (previousItem) {
          setItems(prev => prev.map(item => item.id === itemId ? previousItem : item))
        }
        if (error.code === '23505') {
          return { error: { ...error, message: 'An item with this name already exists' } }
        }
        return { error }
      }

      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'item_updated',
          payload: { itemId }
        })
      }

      const becameArchivedMixedOrAwaitedToast =
        previousItem &&
        !previousItem.archived &&
        persistedUpdates.archived === true &&
        !onlyArchiveFields(persistedUpdates)

      if (becameArchivedMixedOrAwaitedToast) {
        if (archiveUndoToastIdRef.current) {
          dismissToast(archiveUndoToastIdRef.current)
        }
        const label =
          previousItem.text.length > 48 ? `${previousItem.text.slice(0, 45)}…` : previousItem.text
        const toastId = showToast(`Archived "${label}"`, 'info', {
          durationMs: 8000,
          action: {
            label: 'Undo',
            onClick: () => {
              dismissToast(toastId)
              if (archiveUndoToastIdRef.current === toastId) {
                archiveUndoToastIdRef.current = null
              }
              void updateItemRef.current(itemId, { archived: false, archived_at: null }).then(
                ({ error: undoErr }) => {
                  if (undoErr?.message) {
                    showErrorToast(undoErr.message)
                  }
                },
              )
            },
          },
        })
        archiveUndoToastIdRef.current = toastId
      }

      return { error: null }
    } finally {
      mutationGate.end()
    }
  }

  updateItemRef.current = updateItem

  const deleteItem = async (itemId: string) => {
    if (isTempEntityId(itemId)) {
      return { error: { message: STILL_SAVING_TEMP_ENTITY_MSG } }
    }
    if (!tryBeginMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    try {
      const { error } = await trackSaveOperation(
        supabase
          .from('items')
          .delete()
          .eq('id', itemId)
      )

      if (!error) {
        mutationVersionRef.current += 1
        skipRealtimeUntilRef.current = Date.now() + 2000
        delete desiredArchivedByItemRef.current[itemId]
        setItems(prev => prev.filter(item => item.id !== itemId))

        if (channelRef.current) {
          channelRef.current.send({
            type: 'broadcast',
            event: 'item_deleted',
            payload: { itemId }
          })
        }
      }

      return { error }
    } finally {
      mutationGate.end()
    }
  }

  const addMember = async (name: string, creatorNickname?: string) => {
    if (!userId) return { error: new Error('Not authenticated') }
    if (!tryBeginItemQueueableMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    try {
      const nonTargetMembers = members.filter(m => !m.is_target)
      const maxSortOrder = nonTargetMembers.reduce((max, member) =>
        Math.max(max, member.sort_order || 0), 0)
      const newSortOrder = maxSortOrder + 1
      const tempId = createTempId('member')
      const now = new Date().toISOString()
      const optimisticMember: MemberWithCreator = {
        id: tempId,
        list_id: listId,
        name,
        created_by: userId,
        sort_order: newSortOrder,
        is_public: false,
        is_target: false,
        created_at: now,
        updated_at: now,
        creator: creatorNickname ? { nickname: creatorNickname } : null,
      }

      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      setMembers(prev => [...prev, optimisticMember])

      const persistQueuedAddMember = async () => {
        await enqueueItemMutation({
          kind: 'addMember',
          listId,
          itemKey: tempId,
          updatedAt: Date.now(),
          name,
          sort_order: newSortOrder,
          creator_nickname: creatorNickname ?? null,
        })
      }

      if (!canMutateNow()) {
        await persistQueuedAddMember()
        return { data: null, error: null }
      }

      const { data, error } = await trackSaveOperation(
        supabase
          .from('members')
          .insert({
            list_id: listId,
            name,
            created_by: userId,
            sort_order: newSortOrder,
          })
          .select()
          .single(),
      )

      if (error) {
        if (isLikelyConnectivityError(error)) {
          await persistQueuedAddMember()
          enterOffline()
          return { data: null, error: { message: blockedMutationMessage() } }
        }
        setMembers(prev => prev.filter(member => member.id !== tempId))
        return { data, error }
      }

      if (!data) {
        setMembers(prev => prev.filter(member => member.id !== tempId))
        return { data: null, error: new Error('missing row') }
      }

      const memberWithCreator = {
        ...data,
        creator: creatorNickname ? { nickname: creatorNickname } : null,
      }
      setMembers(prev => {
        let replaced = false
        const next = prev.map(member => {
          if (member.id === tempId) {
            replaced = true
            return memberWithCreator
          }
          return member
        })

        const deduped: MemberWithCreator[] = []
        for (const member of next) {
          if (!deduped.some(existing => existing.id === member.id)) {
            deduped.push(member)
          }
        }

        return replaced ? deduped : [...deduped, memberWithCreator]
      })
      markOnlineRecovered()

      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'member_added',
          payload: { memberId: data.id },
        })
      }

      return { data, error: null }
    } finally {
      mutationGate.end()
    }
  }

  const updateMember = async (memberId: string, updates: Partial<Member>) => {
    const profileOnly = memberUpdateIsProfileOnly(updates)
    if (isTempEntityId(memberId)) {
      if (!profileOnly) {
        return { error: { message: STILL_SAVING_TEMP_ENTITY_MSG } }
      }
      if (!tryBeginItemQueueableMutation()) {
        return { error: { message: blockedMutationMessage() } }
      }
      try {
        mutationVersionRef.current += 1
        skipRealtimeUntilRef.current = Date.now() + 2000
        setMembers(prev => prev.map(m => (m.id === memberId ? { ...m, ...updates } : m)))
        await enqueueItemMutation({
          kind: 'patchMember',
          listId,
          itemKey: memberProfileOutboxKey(memberId),
          updatedAt: Date.now(),
          memberId,
          ...(updates.name !== undefined ? { name: updates.name } : {}),
          ...(updates.is_public !== undefined ? { is_public: updates.is_public } : {}),
        })
        return { error: null }
      } finally {
        mutationGate.end()
      }
    }
    if (profileOnly) {
      if (!tryBeginItemQueueableMutation()) {
        return { error: { message: blockedMutationMessage() } }
      }
    } else if (!tryBeginMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    try {
      const previousMember = members.find(member => member.id === memberId)
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      setMembers(prev => prev.map(member =>
        member.id === memberId ? { ...member, ...updates } : member,
      ))

      const persistQueuedPatchMember = async () => {
        await enqueueItemMutation({
          kind: 'patchMember',
          listId,
          itemKey: memberProfileOutboxKey(memberId),
          updatedAt: Date.now(),
          memberId,
          ...(updates.name !== undefined ? { name: updates.name } : {}),
          ...(updates.is_public !== undefined ? { is_public: updates.is_public } : {}),
        })
      }

      if (profileOnly && !canMutateNow()) {
        await persistQueuedPatchMember()
        return { error: null }
      }

      const { error } = await trackSaveOperation(
        supabase.rpc('update_member', {
          p_member_id: memberId,
          p_name: updates.name !== undefined ? updates.name : null,
          p_is_public: updates.is_public !== undefined ? updates.is_public : null,
        }),
      )

      if (error) {
        if (profileOnly && isLikelyConnectivityError(error)) {
          await persistQueuedPatchMember()
          enterOffline()
          return { error: { message: blockedMutationMessage() } }
        }
        if (previousMember) {
          setMembers(prev => prev.map(member => member.id === memberId ? previousMember : member))
        }
        return { error: { ...error, message: error.message || 'Failed to update member' } }
      }

      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'member_updated',
          payload: { memberId },
        })
      }

      return { error: null }
    } finally {
      mutationGate.end()
    }
  }

  const deleteMember = async (memberId: string) => {
    if (isTempEntityId(memberId)) {
      return { error: { message: STILL_SAVING_TEMP_ENTITY_MSG } }
    }
    if (!tryBeginMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    try {
      const { error } = await trackSaveOperation(
        supabase.rpc('delete_member', {
          p_member_id: memberId,
        })
      )

      if (error) {
        return { error: { ...error, message: error.message || 'Failed to delete member' } }
      }

      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      setMembers(prev => prev.filter(member => member.id !== memberId))
      setItems(prev => prev.map(item => ({
        ...item,
        memberStates: Object.fromEntries(
          Object.entries(item.memberStates).filter(([mid]) => mid !== memberId)
        ),
      })))

      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'member_deleted',
          payload: { memberId }
        })
      }

      return { error: null }
    } finally {
      mutationGate.end()
    }
  }

  const ownMember = async (memberId: string, creatorNickname?: string) => {
    if (isTempEntityId(memberId)) {
      return { error: { message: STILL_SAVING_TEMP_ENTITY_MSG } }
    }
    if (!tryBeginMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    try {
      const { data, error } = await trackSaveOperation(
        supabase.rpc('own_member', { p_member_id: memberId })
      )

      if (error) {
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
    if (isTempEntityId(itemId)) {
      return { error: { message: STILL_SAVING_TEMP_ENTITY_MSG } }
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

      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      setLocalMemberState(itemId, memberId, optimisticState)

      const persistQueuedIms = async () => {
        await enqueueItemMutation({
          kind: 'itemMemberState',
          listId,
          itemKey: itemMemberStateOutboxKey(itemId, memberId),
          updatedAt: Date.now(),
          itemId,
          memberId,
          insert: !existingState,
          quantity: optimisticState.quantity,
          done: optimisticState.done,
          assigned: optimisticState.assigned,
        })
      }

      if (!canMutateNow() || isTempEntityId(memberId)) {
        await persistQueuedIms()
        return { error: null }
      }

      if (existingState) {
        const { error } = await trackSaveOperation(
          supabase
            .from('item_member_state')
            .update(updates)
            .eq('item_id', itemId)
            .eq('member_id', memberId),
        )

        if (error) {
          if (isLikelyConnectivityError(error)) {
            await persistQueuedIms()
            enterOffline()
            return { error: { message: blockedMutationMessage() } }
          }
          setLocalMemberState(itemId, memberId, existingState)
          return { error }
        }

        if (channelRef.current) {
          channelRef.current.send({
            type: 'broadcast',
            event: 'member_state_updated',
            payload: { listId, itemId, memberId },
          })
        }

        return { error: null }
      }

      const { data, error } = await trackSaveOperation(
        supabase
          .from('item_member_state')
          .insert({
            item_id: itemId,
            member_id: memberId,
            quantity: updates.quantity ?? 1,
            done: updates.done ?? false,
            assigned: updates.assigned ?? false,
          })
          .select()
          .single(),
      )

      if (error || !data) {
        if (error && isLikelyConnectivityError(error)) {
          await persistQueuedIms()
          enterOffline()
          return { error: { message: blockedMutationMessage() } }
        }
        setLocalMemberState(itemId, memberId, null)
        return { error }
      }

      setLocalMemberState(itemId, memberId, data)

      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'member_state_updated',
          payload: { listId, itemId, memberId },
        })
      }

      return { error: null }
    } finally {
      mutationGate.end()
    }
  }

  const changeQuantity = async (itemId: string, memberId: string, delta: number) => {
    if (isTempEntityId(itemId)) {
      return { data: null, error: { message: STILL_SAVING_TEMP_ENTITY_MSG } }
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

      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      setLocalMemberState(itemId, memberId, optimisticState)

      const persistQueuedIms = async () => {
        await enqueueItemMutation({
          kind: 'itemMemberState',
          listId,
          itemKey: itemMemberStateOutboxKey(itemId, memberId),
          updatedAt: Date.now(),
          itemId,
          memberId,
          insert: !previousState,
          quantity: optimisticState.quantity,
          done: optimisticState.done,
          assigned: optimisticState.assigned,
        })
      }

      if (!canMutateNow() || isTempEntityId(memberId)) {
        await persistQueuedIms()
        return { data: null, error: null }
      }

      const { data, error } = await trackSaveOperation(
        supabase.rpc('change_quantity', {
          p_item_id: itemId,
          p_member_id: memberId,
          p_delta: delta,
        }),
      )

      if (error) {
        if (isLikelyConnectivityError(error)) {
          await persistQueuedIms()
          enterOffline()
          return { data: null, error: { message: blockedMutationMessage() } }
        }
        setLocalMemberState(itemId, memberId, previousState || null)
        return { data, error }
      }

      setLocalMemberState(itemId, memberId, {
        ...optimisticState,
        quantity: typeof data === 'number' ? data : optimisticState.quantity,
      })

      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'member_state_updated',
          payload: { listId, itemId, memberId },
        })
      }

      return { data, error }
    } finally {
      mutationGate.end()
    }
  }

  const deleteArchivedItems = async () => {
    const previousItems = items
    const archivedIds = new Set(items.filter(i => i.archived).map(i => i.id))
    if (archivedIds.size === 0) return { error: null, count: 0 }

    if (!tryBeginMutation()) {
      return { error: { message: blockedMutationMessage() }, count: 0 }
    }
    try {
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 3000
      setItems(prev => prev.filter(i => !archivedIds.has(i.id)))

      const { data, error } = await trackSaveOperation(
        supabase.rpc('delete_archived_items', { p_list_id: listId })
      )

      if (error) {
        setItems(previousItems)
        return { error, count: 0 }
      }

      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'item_deleted',
          payload: { listId, bulkDelete: true },
        })
      }

      return { error: null, count: typeof data === 'number' ? data : archivedIds.size }
    } finally {
      mutationGate.end()
    }
  }

  const restoreArchivedItems = async () => {
    const previousItems = items
    const hasArchived = items.some(i => i.archived)
    if (!hasArchived) return { error: null, count: 0 }

    if (!tryBeginMutation()) {
      return { error: { message: blockedMutationMessage() }, count: 0 }
    }
    try {
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 3000
      setItems(prev => prev.map(i => {
        if (!i.archived) return i
        return { ...i, archived: false, archived_at: null }
      }))

      const { data, error } = await trackSaveOperation(
        supabase.rpc('restore_archived_items', { p_list_id: listId })
      )

      if (error) {
        setItems(previousItems)
        return { error, count: 0 }
      }

      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'item_updated',
          payload: { listId, bulkRestore: true },
        })
      }

      return { error: null, count: typeof data === 'number' ? data : 0 }
    } finally {
      mutationGate.end()
    }
  }

  const reorderItems = async (reorderedItems: ItemWithState[]) => {
    if (!tryBeginMutation()) {
      return { error: { message: blockedMutationMessage() } }
    }
    try {
      const previousItems = items
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Math.max(skipRealtimeUntilRef.current, Date.now() + 2000)
      const itemsWithUpdatedOrder = reorderedItems.map((item, index) => ({
        ...item,
        sort_order: index
      }))
      setItems(itemsWithUpdatedOrder)

      const { error } = await trackSaveOperation(
        supabase.rpc('reorder_list_items', {
          p_list_id: listId,
          p_item_ids: reorderedItems.map(item => item.id),
        })
      )

      if (error) {
        setItems(previousItems)
        return { error }
      }

      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'item_updated',
          payload: { listId, bulkReorder: true },
        })
      }

      return { error: null }
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
    [listId, userId, mutationGate, tryBeginMutation],
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
    const tempId = createTempId('member')
    const now = new Date().toISOString()
    const creatorFromProfile = profile?.nickname ? { nickname: profile.nickname } : null
    const optimisticTarget: MemberWithCreator = {
      id: tempId,
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
      setMembers(prev => prev.filter(m => m.id !== tempId))
      return
    }

    const realMemberId = data.id
    const targetWithCreator: MemberWithCreator = {
      ...data,
      creator: creatorFromProfile,
    }

    setMembers(prev => {
      const next = prev.map(m => m.id === tempId ? targetWithCreator : m)
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
        member_id: realMemberId,
        quantity: 1,
        done: false,
        assigned: true,
      }))

      setItems(prev => prev.map(i => ({
        ...i,
        memberStates: {
          ...i.memberStates,
          [realMemberId]: {
            item_id: i.id,
            member_id: realMemberId,
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

  // Auto-fit width when mode is 'auto' and items change (include sumScope so cycling all/active/archived recalculates)
  useEffect(() => {
    if (itemTextWidthMode !== 'auto') return
    const texts = [
      ...items.map(i => i.text ?? ''),
      ...sumRowTitlesForAutoWidth(sumScope, items),
    ]
    const fitWidth = measureFitItemTextWidthPx(texts, itemNameFontStep)
    setItemTextWidth(fitWidth)
  }, [
    itemTextWidthMode,
    items,
    itemNameFontStep,
    sumScope,
  ])

  return {
    list,
    items,
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
