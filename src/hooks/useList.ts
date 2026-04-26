'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import { getActiveCacheUserId, getCachedList, setCachedList, removeCachedList } from '@/lib/cache'
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
} from '@/lib/supabase/types'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useToast } from '@/components/ui/Toast'
import { createUserMutationGate, USER_MUTATION_WAIT_MSG } from '@/lib/userMutationGate'

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

function getCachedPrefs(listId: string, userId?: string) {
  const defaults = {
    memberFilter: 'all' as MemberFilter,
    itemTextWidth: 'auto' as string,
    itemNameFontStep: ITEM_NAME_FONT_DEFAULT,
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
      }
    } catch { /* ignore */ }
  }
  return defaults
}

function setCachedPrefs(
  listId: string,
  prefs: { memberFilter?: MemberFilter; itemTextWidth?: string; itemNameFontStep?: number },
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

const FETCH_TIMEOUT_MS = 5000
const SAVE_TIMEOUT_MS = 5000

function createTempId(prefix: string) {
  return `temp-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
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
  const { user, profile } = useAuth()
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
  const userId = user?.id

  const { warning: warnMutation, showToast, dismissToast, error: showErrorToast } = useToast()
  const archiveUndoToastIdRef = useRef<string | null>(null)
  /** User intent while archive / undo requests settle (`true` = archived, `false` = not). Read after awaits, not from closures. */
  const desiredArchivedByItemRef = useRef<Record<string, boolean>>({})
  const archiveDbWriteInflightRef = useRef<Record<string, boolean>>({})
  const updateItemRef = useRef<
    (itemId: string, updates: Partial<Item>) => Promise<{ error: { message?: string } | null }>
  >(async () => ({ error: null }))
  const warnMutationRef = useRef(warnMutation)
  warnMutationRef.current = warnMutation
  const mutationGate = useMemo(
    () => createUserMutationGate(m => warnMutationRef.current(m)),
    [],
  )

  useEffect(() => {
    const cachedData = getCachedList(userId, listId)
    const cachedPrefs = getCachedPrefs(listId, userId)

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
    setLoading(!!userId && !cachedData?.list)
    setHasCompletedInitialFetch(false)
    hasInitialDataRef.current = !!cachedData?.list
    prefsFetchedRef.current = false
  }, [userId, listId])

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
      setList(null)
      setItems([])
      setMembers([])
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
    const cachedData = getCachedList(userId, listId)
    if (!hasInitialDataRef.current && !cachedData?.list) {
      setLoading(true)
    }
    setError(null)

    try {
      // Fetch all list data in a single RPC call
      const { data, error: rpcError } = await supabase.rpc('get_list_data', {
        p_list_id: listId
      })

      if (rpcError) {
        // If we previously had access but now get an error, access was revoked
        if (hadAccessRef.current && (rpcError.code === 'P0001' || rpcError.message?.includes('Access denied'))) {
          setAccessDenied(true)
          return
        }
        throw rpcError
      }

      if (!data || !data.list) {
        if (hadAccessRef.current) {
          setAccessDenied(true)
          return
        }
        throw new Error('List not found')
      }

      if (staleCheck != null && staleCheck !== mutationVersionRef.current) {
        staleDiscarded = true
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
      setItems(nextItems)
      setCategoryNames(parseCategoryNames(data.list.category_names))
      setCategoryOrder(parseCategoryOrder(data.list.category_order))
      hasInitialDataRef.current = true

      // Cache the list data for instant load next time
      setCachedList(userId, listId, {
        list: data.list,
        items: nextItems,
        members: data.members || []
      })

      // Only fetch preferences on initial load to avoid overwriting optimistic updates
      if (!prefsFetchedRef.current) {
        prefsFetchedRef.current = true
        const { data: listUserData } = await supabase
          .from('list_users')
          .select('member_filter, item_text_width, last_viewed_members, item_name_font_step')
          .eq('list_id', listId)
          .eq('user_id', userId)
          .single()

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
        }
      }
      setFetchTimedOut(false)
    } catch (err) {
      setError(rpcFailureMessage(err))
    } finally {
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
  }, [userId, listId])

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
      .subscribe()

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
    if (!mutationGate.tryBegin()) {
      return { data: null, error: { message: USER_MUTATION_WAIT_MSG } }
    }
    try {
      const maxSortOrder = items.length > 0
        ? items.reduce((max, item) => Math.max(max, item.sort_order ?? 0), 0)
        : 0
      const newSortOrder = items.length > 0 ? maxSortOrder + 1 : 0
      const tempId = createTempId('item')
      const now = new Date().toISOString()
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
        memberStates: {},
      }

      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      setItems(prev => [...prev, optimisticItem])

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
        setItems(prev => prev.filter(item => item.id !== tempId))
        if (error.code === '23505') {
          return { data: null, error: { ...error, message: 'An item with this name already exists' } }
        }
        return { data: null, error }
      }

      const targetMember = members.find(m => m.is_target)
      const newMemberStates: Record<string, ItemMemberState> = {}

      if (targetMember) {
        const targetState: ItemMemberState = {
          item_id: data.id,
          member_id: targetMember.id,
          quantity: 1,
          done: false,
          assigned: true,
          updated_at: new Date().toISOString(),
        }
        newMemberStates[targetMember.id] = targetState

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

      const newItem: ItemWithState = { ...data, memberStates: newMemberStates }
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
      return { data, error: null }
    } finally {
      mutationGate.end()
    }
  }

  const updateItem = async (itemId: string, updates: Partial<Item>) => {
    const previousItem = items.find(item => item.id === itemId)
    const persistedUpdates = { ...updates }

    if (persistedUpdates.archived === false) {
      desiredArchivedByItemRef.current[itemId] = false
    }

    const onlyArchiveFields = (u: Partial<Item>) => {
      const keys = Object.keys(u).filter(k => (u as Record<string, unknown>)[k] !== undefined)
      return keys.every(k => k === 'archived' || k === 'archived_at')
    }

    const optimisticArchiveWithImmediateUndoToast =
      previousItem &&
      !previousItem.archived &&
      persistedUpdates.archived === true &&
      onlyArchiveFields(persistedUpdates)

    if (optimisticArchiveWithImmediateUndoToast) {
      if (archiveDbWriteInflightRef.current[itemId]) {
        return { error: { message: USER_MUTATION_WAIT_MSG } }
      }
      if (!mutationGate.tryBegin()) {
        return { error: { message: USER_MUTATION_WAIT_MSG } }
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
      const { error } = await trackSaveOperation(
        supabase
          .from('items')
          .update(persistedUpdates)
          .eq('id', itemId)
      )
      archiveDbWriteInflightRef.current[itemId] = false

      const desiredNow = desiredArchivedByItemRef.current[itemId]

      if (error) {
        if (desiredNow === true) {
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

    if (!mutationGate.tryBegin()) {
      return { error: { message: USER_MUTATION_WAIT_MSG } }
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

      const { error } = await trackSaveOperation(
        supabase
          .from('items')
          .update(persistedUpdates)
          .eq('id', itemId)
      )

      if (error) {
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
    if (!mutationGate.tryBegin()) {
      return { error: { message: USER_MUTATION_WAIT_MSG } }
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
    if (!mutationGate.tryBegin()) {
      return { error: { message: USER_MUTATION_WAIT_MSG } }
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
        .single()
    )

    if (error || !data) {
      setMembers(prev => prev.filter(member => member.id !== tempId))
      return { data, error }
    }

    const memberWithCreator = {
      ...data,
      creator: creatorNickname ? { nickname: creatorNickname } : null
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
    
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'member_added',
        payload: { memberId: data.id }
      })
    }

    return { data, error }
    } finally {
      mutationGate.end()
    }
  }

  const updateMember = async (memberId: string, updates: Partial<Member>) => {
    if (!mutationGate.tryBegin()) {
      return { error: { message: USER_MUTATION_WAIT_MSG } }
    }
    try {
      const previousMember = members.find(member => member.id === memberId)
      mutationVersionRef.current += 1
      skipRealtimeUntilRef.current = Date.now() + 2000
      setMembers(prev => prev.map(member =>
        member.id === memberId ? { ...member, ...updates } : member
      ))

      const { error } = await trackSaveOperation(
        supabase.rpc('update_member', {
          p_member_id: memberId,
          p_name: updates.name !== undefined ? updates.name : null,
          p_is_public: updates.is_public !== undefined ? updates.is_public : null,
        })
      )

      if (error) {
        if (previousMember) {
          setMembers(prev => prev.map(member => member.id === memberId ? previousMember : member))
        }
        return { error: { ...error, message: error.message || 'Failed to update member' } }
      }

      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'member_updated',
          payload: { memberId }
        })
      }

      return { error: null }
    } finally {
      mutationGate.end()
    }
  }

  const deleteMember = async (memberId: string) => {
    if (!mutationGate.tryBegin()) {
      return { error: { message: USER_MUTATION_WAIT_MSG } }
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
    if (!mutationGate.tryBegin()) {
      return { error: { message: USER_MUTATION_WAIT_MSG } }
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
    updates: { quantity?: number; done?: boolean; assigned?: boolean }
  ) => {
    if (!mutationGate.tryBegin()) {
      return { error: { message: USER_MUTATION_WAIT_MSG } }
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

    if (existingState) {
      const { error } = await trackSaveOperation(
        supabase
          .from('item_member_state')
          .update(updates)
          .eq('item_id', itemId)
          .eq('member_id', memberId)
      )

      if (error) {
        setLocalMemberState(itemId, memberId, existingState)
        return { error }
      }

      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'member_state_updated',
          payload: { listId, itemId, memberId }
        })
      }

      return { error: null }
    } else {
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
          .single()
      )

      if (error || !data) {
        setLocalMemberState(itemId, memberId, null)
        return { error }
      }

      setLocalMemberState(itemId, memberId, data)

      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'member_state_updated',
          payload: { listId, itemId, memberId }
        })
      }

      return { error: null }
    }
    } finally {
      mutationGate.end()
    }
  }

  const changeQuantity = async (itemId: string, memberId: string, delta: number) => {
    if (!mutationGate.tryBegin()) {
      return { data: null, error: { message: USER_MUTATION_WAIT_MSG } }
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

      const { data, error } = await trackSaveOperation(
        supabase.rpc('change_quantity', {
          p_item_id: itemId,
          p_member_id: memberId,
          p_delta: delta,
        })
      )

      if (error) {
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
          payload: { listId, itemId, memberId }
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

    if (!mutationGate.tryBegin()) {
      return { error: { message: USER_MUTATION_WAIT_MSG }, count: 0 }
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

    if (!mutationGate.tryBegin()) {
      return { error: { message: USER_MUTATION_WAIT_MSG }, count: 0 }
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
    if (!mutationGate.tryBegin()) {
      return { error: { message: USER_MUTATION_WAIT_MSG } }
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
    if (!mutationGate.tryBegin()) {
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
    if (!mutationGate.tryBegin()) {
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
    if (!mutationGate.tryBegin()) {
      return
    }
    try {
      const prevMode = itemTextWidthMode
      const prevWidth = itemTextWidth
      if (mode === 'auto') {
        const texts = items.map(i => i.text ?? '')
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

  const updateItemNameFontStep = useCallback(
    async (step: number) => {
      const s = Math.min(ITEM_NAME_FONT_MAX, Math.max(ITEM_NAME_FONT_MIN, Math.round(step)))
      const prev = itemNameFontStepRef.current
      if (s === prev) return
      if (!mutationGate.tryBegin()) {
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
    [listId, userId, mutationGate],
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
    if (!mutationGate.tryBegin()) {
      return { error: { message: USER_MUTATION_WAIT_MSG } }
    }
    try {
      return await persistCategoryNamesOnly(names)
    } finally {
      mutationGate.end()
    }
  }

  const updateCategoryOrder = async (order: number[]) => {
    if (!mutationGate.tryBegin()) {
      return { error: { message: USER_MUTATION_WAIT_MSG } }
    }
    try {
      return await persistCategoryOrderOnly(order)
    } finally {
      mutationGate.end()
    }
  }

  const saveCategorySettings = async (names: CategoryNames, order: number[]) => {
    if (!mutationGate.tryBegin()) {
      return { error: { message: USER_MUTATION_WAIT_MSG } }
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

    if (!mutationGate.tryBegin()) {
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

  // Auto-fit width when mode is 'auto' and items change
  useEffect(() => {
    if (itemTextWidthMode !== 'auto') return
    const texts = items.map(i => i.text ?? '')
    const fitWidth = measureFitItemTextWidthPx(texts, itemNameFontStep)
    setItemTextWidth(fitWidth)
  }, [itemTextWidthMode, items, itemNameFontStep])

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
  }
}
