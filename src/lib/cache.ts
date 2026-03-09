import type { ListWithRole, MemberWithCreator } from '@/lib/supabase/types'
import type { ItemWithState } from '@/hooks/useList'

const MAX_CACHED_LISTS = 10
const CACHE_KEY_LISTS = 'cached_lists'
const CACHE_KEY_RECENT = 'recent_lists'

interface CachedLists {
  lists: ListWithRole[]
  cachedAt: number
}

interface CachedListData {
  list: any
  items: ItemWithState[]
  members: MemberWithCreator[]
  cachedAt: number
}

function getCacheKey(listId: string) {
  return `cached_list_${listId}`
}

export function getCachedLists(): CachedLists | null {
  if (typeof window === 'undefined') return null
  try {
    const cached = localStorage.getItem(CACHE_KEY_LISTS)
    return cached ? JSON.parse(cached) : null
  } catch {
    return null
  }
}

export function setCachedLists(lists: ListWithRole[]) {
  if (typeof window === 'undefined') return
  try {
    const data: CachedLists = {
      lists,
      cachedAt: Date.now()
    }
    localStorage.setItem(CACHE_KEY_LISTS, JSON.stringify(data))
  } catch {
    // Storage full or other error - ignore
  }
}

export function getCachedList(listId: string): CachedListData | null {
  if (typeof window === 'undefined') return null
  try {
    const cached = localStorage.getItem(getCacheKey(listId))
    return cached ? JSON.parse(cached) : null
  } catch {
    return null
  }
}

export function setCachedList(listId: string, data: Omit<CachedListData, 'cachedAt'>) {
  if (typeof window === 'undefined') return
  try {
    const cacheData: CachedListData = {
      ...data,
      cachedAt: Date.now()
    }
    localStorage.setItem(getCacheKey(listId), JSON.stringify(cacheData))
    updateRecentLists(listId)
  } catch {
    // Storage full or other error - ignore
  }
}

export function removeCachedList(listId: string) {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(getCacheKey(listId))
    // Also remove from recent lists
    const recent = getRecentLists()
    const updated = recent.filter(id => id !== listId)
    localStorage.setItem(CACHE_KEY_RECENT, JSON.stringify(updated))
  } catch {
    // Ignore errors
  }
}

function getRecentLists(): string[] {
  try {
    const cached = localStorage.getItem(CACHE_KEY_RECENT)
    return cached ? JSON.parse(cached) : []
  } catch {
    return []
  }
}

function updateRecentLists(listId: string) {
  try {
    let recent = getRecentLists()
    
    // Remove if already exists (will be added to front)
    recent = recent.filter(id => id !== listId)
    
    // Add to front
    recent.unshift(listId)
    
    // If over limit, evict oldest
    if (recent.length > MAX_CACHED_LISTS) {
      const evicted = recent.pop()
      if (evicted) {
        localStorage.removeItem(getCacheKey(evicted))
      }
    }
    
    localStorage.setItem(CACHE_KEY_RECENT, JSON.stringify(recent))
  } catch {
    // Ignore errors
  }
}
