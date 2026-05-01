import type { ItemWithState, List, ListWithRole, MemberWithCreator } from '@/lib/supabase/types'

const MAX_CACHED_LISTS = 10
const CACHE_KEY_ACTIVE_USER = 'active_cache_user'
const CACHE_KEY_LISTS = 'cached_lists'
const CACHE_KEY_RECENT = 'recent_lists'

interface CachedLists {
  lists: ListWithRole[]
  cachedAt: number
}

interface CachedListData {
  list: List
  items: ItemWithState[]
  members: MemberWithCreator[]
  cachedAt: number
}

function getListsKey(userId: string) {
  return `${CACHE_KEY_LISTS}_${userId}`
}

function getRecentKey(userId: string) {
  return `${CACHE_KEY_RECENT}_${userId}`
}

function getCacheKey(userId: string, listId: string) {
  return `cached_list_${userId}_${listId}`
}

export function getActiveCacheUserId() {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(CACHE_KEY_ACTIVE_USER)
  } catch {
    return null
  }
}

export function setActiveCacheUserId(userId: string) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(CACHE_KEY_ACTIVE_USER, userId)
  } catch {
    // Ignore errors
  }
}

export function clearActiveCacheUserId() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(CACHE_KEY_ACTIVE_USER)
  } catch {
    // Ignore errors
  }
}

function resolveUserId(userId?: string) {
  return userId || getActiveCacheUserId()
}

export function getCachedLists(userId?: string): CachedLists | null {
  const scopedUserId = resolveUserId(userId)
  if (!scopedUserId) return null
  if (typeof window === 'undefined') return null
  try {
    const cached = localStorage.getItem(getListsKey(scopedUserId))
    return cached ? JSON.parse(cached) : null
  } catch {
    return null
  }
}

export function setCachedLists(userId: string | undefined, lists: ListWithRole[]) {
  const scopedUserId = resolveUserId(userId)
  if (!scopedUserId) return
  if (typeof window === 'undefined') return
  try {
    const data: CachedLists = {
      lists,
      cachedAt: Date.now()
    }
    localStorage.setItem(getListsKey(scopedUserId), JSON.stringify(data))
  } catch {
    // Storage full or other error - ignore
  }
}

export function getCachedList(userId: string | undefined, listId: string): CachedListData | null {
  const scopedUserId = resolveUserId(userId)
  if (!scopedUserId) return null
  if (typeof window === 'undefined') return null
  try {
    const cached = localStorage.getItem(getCacheKey(scopedUserId, listId))
    return cached ? JSON.parse(cached) : null
  } catch {
    return null
  }
}

/** True when persisted list payload exists for this list (offline nav gate). */
export function cachedListDataExists(listId: string, userId?: string): boolean {
  return getCachedList(userId, listId) != null
}

export function setCachedList(userId: string | undefined, listId: string, data: Omit<CachedListData, 'cachedAt'>) {
  const scopedUserId = resolveUserId(userId)
  if (!scopedUserId) return
  if (typeof window === 'undefined') return
  try {
    const cacheData: CachedListData = {
      ...data,
      cachedAt: Date.now()
    }
    localStorage.setItem(getCacheKey(scopedUserId, listId), JSON.stringify(cacheData))
    updateRecentLists(scopedUserId, listId)
  } catch {
    // Storage full or other error - ignore
  }
}

export function removeCachedList(userId: string | undefined, listId: string) {
  const scopedUserId = resolveUserId(userId)
  if (!scopedUserId) return
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(getCacheKey(scopedUserId, listId))
    // Also remove from recent lists
    const recent = getRecentLists(scopedUserId)
    const updated = recent.filter(id => id !== listId)
    localStorage.setItem(getRecentKey(scopedUserId), JSON.stringify(updated))
  } catch {
    // Ignore errors
  }
}

const CACHE_KEY_LABEL_FILTER = 'label_filter'

function getLabelFilterKey(userId: string) {
  return `${CACHE_KEY_LABEL_FILTER}_${userId}`
}

export function getCachedLabelFilter(userId?: string): string | null {
  const scopedUserId = resolveUserId(userId)
  if (!scopedUserId) return null
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(getLabelFilterKey(scopedUserId))
  } catch {
    return null
  }
}

export function setCachedLabelFilter(label: string, userId?: string) {
  const scopedUserId = resolveUserId(userId)
  if (!scopedUserId) return
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(getLabelFilterKey(scopedUserId), label)
  } catch {
    // Ignore errors
  }
}

function getRecentLists(userId: string): string[] {
  try {
    const cached = localStorage.getItem(getRecentKey(userId))
    return cached ? JSON.parse(cached) : []
  } catch {
    return []
  }
}

function updateRecentLists(userId: string, listId: string) {
  try {
    let recent = getRecentLists(userId)
    
    // Remove if already exists (will be added to front)
    recent = recent.filter(id => id !== listId)
    
    // Add to front
    recent.unshift(listId)
    
    // If over limit, evict oldest
    if (recent.length > MAX_CACHED_LISTS) {
      const evicted = recent.pop()
      if (evicted) {
        localStorage.removeItem(getCacheKey(userId, evicted))
      }
    }
    
    localStorage.setItem(getRecentKey(userId), JSON.stringify(recent))
  } catch {
    // Ignore errors
  }
}
