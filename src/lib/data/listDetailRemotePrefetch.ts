import { setCachedList } from '@/lib/cache'
import { createClient } from '@/lib/supabase/client'
import { isTombstoned } from '@/lib/data/base_sync_fields'
import { upsertListDataPayloadFromServer } from '@/lib/data/serverDexieParity'
import { normalizeItemsCategory } from '@/lib/items/normalizeItemsCategory'
import type { ItemWithState, List, MemberWithCreator } from '@/lib/supabase/types'
import { useListsCatalogStore } from '@/stores/listsCatalogStore'

const supabase = createClient()

/** Derive affected list UUIDs from home-catalog realtime payloads. */
export function extractListIdsFromCatalogRealtimePayload(payload: {
  table?: string
  new?: Record<string, unknown> | null
  old?: Record<string, unknown> | null
}): string[] {
  const table = payload.table ?? ''
  const n = payload.new
  const o = payload.old
  const listIdFromRow = () =>
    (typeof n?.list_id === 'string' && n.list_id) || (typeof o?.list_id === 'string' && o.list_id) || null
  if (table === 'lists') {
    const id = (typeof n?.id === 'string' && n.id) || (typeof o?.id === 'string' && o.id) || null
    return id ? [id] : []
  }
  if (table === 'items' || table === 'members' || table === 'list_users') {
    const lid = listIdFromRow()
    return lid ? [lid] : []
  }
  return []
}

/**
 * Pull `get_list_data` for each list, mirror into Dexie + L1 cache, and drive catalog pulse (cyan → teal → fade).
 */
export async function prefetchListDetailsFromServer(
  userId: string | null | undefined,
  rawListIds: readonly string[],
): Promise<void> {
  if (!userId) return
  const listIds = [...new Set(rawListIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  if (listIds.length === 0) return

  const cat = useListsCatalogStore.getState()
  cat.beginRemoteDetailPrefetchForLists(listIds)

  for (const listId of listIds) {
    try {
      const { data, error } = await supabase.rpc('get_list_data', { p_list_id: listId })
      if (error || !data?.list) {
        cat.finishRemoteDetailPrefetchOne(listId, false)
        continue
      }
      const serverMembers = ((data.members ?? []) as MemberWithCreator[]).filter(
        (m) => !isTombstoned(m.deleted_at ?? null),
      )
      const nextItems = normalizeItemsCategory(
        ((data.items ?? []) as ItemWithState[]).filter((i) => !isTombstoned(i.deleted_at ?? null)),
      )
      await upsertListDataPayloadFromServer(userId, listId, {
        list: data.list as List,
        items: nextItems,
        members: serverMembers,
      })
      setCachedList(userId, listId, {
        list: data.list as List,
        items: nextItems,
        members: serverMembers,
      })
      cat.finishRemoteDetailPrefetchOne(listId, true)
    } catch {
      cat.finishRemoteDetailPrefetchOne(listId, false)
    }
  }
}
