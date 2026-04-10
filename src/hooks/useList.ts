'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import { getActiveCacheUserId, getCachedList, setCachedList, removeCachedList } from '@/lib/cache'
import { measureFitItemTextWidthPx } from '@/lib/itemTextWidthFit'
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

function getCachedPrefs(listId: string, userId?: string) {
  const defaults = { memberFilter: 'all' as const, itemTextWidth: 'auto' as string }
  if (typeof window === 'undefined') return defaults
  const prefsKey = getPrefsKey(listId, userId)
  if (!prefsKey) return defaults

  const cached = localStorage.getItem(prefsKey)
  if (cached) {
    try {
      const parsed = JSON.parse(cached)
      return {
        memberFilter: (parsed.memberFilter === 'mine' || parsed.memberFilter === 'all') ? parsed.memberFilter : 'all' as const,
        itemTextWidth: typeof parsed.itemTextWidth === 'string' ? parsed.itemTextWidth : 'auto',
      }
    } catch { /* ignore */ }
  }
  return defaults
}

// Helper to save preferences to localStorage
function setCachedPrefs(listId: string, prefs: { memberFilter?: 'all' | 'mine', itemTextWidth?: string }, userId?: string) {
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
  const { user } = useAuth()
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
  const [memberFilter, setMemberFilter] = useState<'all' | 'mine'>(() => getCachedPrefs(listId).memberFilter)
  const [itemTextWidthMode, setItemTextWidthMode] = useState<WidthMode>(() => parseWidthValue(getCachedPrefs(listId).itemTextWidth).mode)
  const [itemTextWidth, setItemTextWidth] = useState(() => parseWidthValue(getCachedPrefs(listId).itemTextWidth).width)
  const [categoryNames, setCategoryNames] = useState<CategoryNames>(() => parseCategoryNames(cached?.list?.category_names))
  const [categoryOrder, setCategoryOrder] = useState<number[]>(() => parseCategoryOrder(cached?.list?.category_order))
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
  const userId = user?.id

  useEffect(() => {
    const cachedData = getCachedList(userId, listId)
    const cachedPrefs = getCachedPrefs(listId, userId)

    setList(cachedData?.list || null)
    setItems(normalizeItemsCategory(cachedData?.items || []))
    setMembers(cachedData?.members || [])
    setMemberFilter(cachedPrefs.memberFilter)
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

  const fetchList = useCallback(async () => {
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
          .select('member_filter, item_text_width')
          .eq('list_id', listId)
          .eq('user_id', userId)
          .single()

        if (listUserData) {
          if (listUserData.member_filter === 'all' || listUserData.member_filter === 'mine') {
            setMemberFilter(listUserData.member_filter)
            setCachedPrefs(listId, { memberFilter: listUserData.member_filter }, userId)
          }
          const serverVal = listUserData.item_text_width
          const parsed = parseWidthValue(serverVal)
          setItemTextWidthMode(parsed.mode)
          setCachedPrefs(listId, { itemTextWidth: serverVal ?? 'auto' }, userId)
          if (parsed.mode === 'manual') {
            setItemTextWidth(parsed.width)
          }
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
    }
  }, [userId, listId])

  const isInitialSyncing = isFetching && !hasCompletedInitialFetch && !!list

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
        fetchList()
      }, Math.max(delayMs, 0))
    }

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

      fetchList()
    }

    const channel = supabase
      .channel(`list-${listId}`)
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
      if (realtimeDebounceRef.current) {
        clearTimeout(realtimeDebounceRef.current)
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
    }
  }, [userId, listId, fetchList])

  const addItem = async (text: string) => {
    const activeItems = items.filter(item => !item.archived)
    const minSortOrder = activeItems.length > 0
      ? activeItems.reduce((min, item) => Math.min(min, item.sort_order ?? 0), activeItems[0].sort_order ?? 0)
      : 0
    const newSortOrder = activeItems.length > 0 ? minSortOrder - 1 : 0
    const tempId = createTempId('item')
    const now = new Date().toISOString()
    const optimisticItem: ItemWithState = {
      id: tempId,
      list_id: listId,
      text,
      comment: null,
      archived: false,
      archived_at: null,
      sort_order: newSortOrder,
      category: 1,
      created_at: now,
      updated_at: now,
      memberStates: {},
    }

    skipRealtimeUntilRef.current = Date.now() + 2000
    setItems(prev => [...prev, optimisticItem])

    const { data, error } = await trackSaveOperation(
      supabase
        .from('items')
        .insert({
          list_id: listId,
          text,
          sort_order: newSortOrder,
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

    const newItem: ItemWithState = { ...data, memberStates: {} }
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
  }

  const updateItem = async (itemId: string, updates: Partial<Item>) => {
    const previousItem = items.find(item => item.id === itemId)
    const persistedUpdates = { ...updates }

    if (previousItem && updates.archived === false && previousItem.archived) {
      const maxActiveSortOrder = items
        .filter(item => !item.archived)
        .reduce((max, item) => Math.max(max, item.sort_order ?? 0), -1)
      persistedUpdates.sort_order = maxActiveSortOrder + 1
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
    
    return { error: null }
  }

  const deleteItem = async (itemId: string) => {
    const { error } = await trackSaveOperation(
      supabase
        .from('items')
        .delete()
        .eq('id', itemId)
    )

    if (!error) {
      skipRealtimeUntilRef.current = Date.now() + 2000
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
  }

  const addMember = async (name: string, creatorNickname?: string) => {
    if (!userId) return { error: new Error('Not authenticated') }

    const maxSortOrder = members.reduce((max, member) => 
      Math.max(max, member.sort_order || 0), 0)
    const tempId = createTempId('member')
    const now = new Date().toISOString()
    const optimisticMember: MemberWithCreator = {
      id: tempId,
      list_id: listId,
      name,
      created_by: userId,
      sort_order: maxSortOrder + 1,
      is_public: false,
      created_at: now,
      updated_at: now,
      creator: creatorNickname ? { nickname: creatorNickname } : null,
    }

    skipRealtimeUntilRef.current = Date.now() + 2000
    setMembers(prev => [...prev, optimisticMember])

    const { data, error } = await trackSaveOperation(
      supabase
        .from('members')
        .insert({
          list_id: listId,
          name,
          created_by: userId,
          sort_order: maxSortOrder + 1,
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
  }

  const updateMember = async (memberId: string, updates: Partial<Member>) => {
    const previousMember = members.find(member => member.id === memberId)
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
  }

  const deleteMember = async (memberId: string) => {
      const { error } = await trackSaveOperation(
        supabase.rpc('delete_member', {
        p_member_id: memberId,
      })
    )

    if (error) {
      return { error: { ...error, message: error.message || 'Failed to delete member' } }
    }

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
  }

  const updateMemberState = async (
    itemId: string,
    memberId: string,
    updates: { quantity?: number; done?: boolean }
  ) => {
    const existingState = items.find(i => i.id === itemId)?.memberStates[memberId]
    const optimisticState: ItemMemberState = {
      item_id: itemId,
      member_id: memberId,
      quantity: updates.quantity ?? existingState?.quantity ?? 0,
      done: updates.done ?? existingState?.done ?? false,
      updated_at: new Date().toISOString(),
    }

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
            quantity: updates.quantity ?? 0,
            done: updates.done ?? false,
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
  }

  const changeQuantity = async (itemId: string, memberId: string, delta: number) => {
    const previousState = items.find(item => item.id === itemId)?.memberStates[memberId]
    const optimisticState: ItemMemberState = {
      item_id: itemId,
      member_id: memberId,
      quantity: Math.max(0, (previousState?.quantity || 0) + delta),
      done: previousState?.done || false,
      updated_at: new Date().toISOString(),
    }

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
  }

  const deleteArchivedItems = async () => {
    const previousItems = items
    const archivedIds = new Set(items.filter(i => i.archived).map(i => i.id))
    if (archivedIds.size === 0) return { error: null, count: 0 }

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
  }

  const restoreArchivedItems = async () => {
    const previousItems = items
    const hasArchived = items.some(i => i.archived)
    if (!hasArchived) return { error: null, count: 0 }

    const maxActive = items
      .filter(i => !i.archived)
      .reduce((max, i) => Math.max(max, i.sort_order ?? 0), -1)

    skipRealtimeUntilRef.current = Date.now() + 3000
    let idx = 1
    setItems(prev => prev.map(i => {
      if (!i.archived) return i
      return { ...i, archived: false, archived_at: null, sort_order: maxActive + idx++ }
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
  }

  const reorderItems = async (reorderedItems: ItemWithState[]) => {
    const previousItems = items
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
  }

  const updateMemberFilter = async (filter: 'all' | 'mine') => {
    const prev = memberFilter
    setMemberFilter(filter)
    setCachedPrefs(listId, { memberFilter: filter }, userId)
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
  }

  const updateItemTextWidth = async (width: number) => {
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
  }

  const updateItemTextWidthMode = async (mode: WidthMode) => {
    const prevMode = itemTextWidthMode
    const prevWidth = itemTextWidth
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
  }

  const updateCategoryNames = async (names: CategoryNames) => {
    const prev = categoryNames
    const prevList = list
    const nonEmpty: Record<string, string> = {}
    for (const [k, v] of Object.entries(names)) {
      if (v) nonEmpty[k] = v
    }
    const serialized = Object.keys(nonEmpty).length > 0 ? JSON.stringify(nonEmpty) : '{}'
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

  const updateCategoryOrder = async (order: number[]) => {
    const prev = categoryOrder
    const prevList = list
    const serialized = JSON.stringify(order)
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

  // Auto-fit width when mode is 'auto' and items change
  useEffect(() => {
    if (itemTextWidthMode !== 'auto') return
    const texts = items.map(i => i.text ?? '')
    const fitWidth = measureFitItemTextWidthPx(texts)
    setItemTextWidth(fitWidth)
  }, [itemTextWidthMode, items])

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
    memberFilter,
    itemTextWidth,
    itemTextWidthMode,
    categoryNames,
    categoryOrder,
    refresh: fetchList,
    addItem,
    updateItem,
    deleteItem,
    addMember,
    updateMember,
    deleteMember,
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
  }
}
