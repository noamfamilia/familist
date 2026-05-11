import { getCachedList, setCachedList } from '@/lib/cache'
import { db } from '@/lib/db'
import { isTombstoned } from '@/lib/data/base_sync_fields'
import { loadListDetailFromDexie } from '@/lib/data/queries'
import { useListDataStore, warmListData } from '@/stores/listDataStore'
import type { List } from '@/lib/supabase/types'

/**
 * Hydrate localStorage list-detail cache (L1) from Dexie (L2) before navigating to `/list/[id]`.
 * Returns true when a non-tombstoned list row existed and cache was written.
 */
export async function prefetchListPageCacheFromDexie(userId: string, listId: string): Promise<boolean> {
  if (!userId || !listId) return false
  const listRow = await db.lists.get(listId)
  if (!listRow || isTombstoned(listRow.deleted_at ?? null)) return false
  const detail = await loadListDetailFromDexie(userId, listId)
  setCachedList(userId, listId, {
    list: listRow as List,
    items: detail.items,
    members: detail.members,
  })
  return true
}

/**
 * L1 localStorage + Zustand session warm before `router.push` so the list route can render without a loading gate.
 */
export async function prefetchListPageForNavigation(userId: string, listId: string): Promise<boolean> {
  const ok = await prefetchListPageCacheFromDexie(userId, listId)
  const cached = getCachedList(userId, listId)
  useListDataStore.getState().beginListSession(userId, listId, cached)
  await warmListData(userId, listId)
  return ok
}
