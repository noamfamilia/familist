import { setCachedList } from '@/lib/cache'
import { rpcGetListData } from '@/lib/data/inFlightServerReads'
import { isTombstoned } from '@/lib/data/base_sync_fields'
import { serverListDetailDiffersFromDexie } from '@/lib/data/listDetailServerDexieDiff'
import { upsertListDataPayloadFromServer } from '@/lib/data/serverDexieParity'
import {
  captureListReconcileGeneration,
  shouldDiscardListReconcileResult,
} from '@/lib/data/listReconcilePolicy'
import {
  canFetchFromServerNow,
  captureReadFlightGeneration,
  shouldDiscardReadFlightResult,
} from '@/lib/data/serverReadPolicy'
import { shouldDeferServerReadsForOutboundList } from '@/lib/data/outboundReadQuiet'
import { db } from '@/lib/db'
import { normalizeItemsCategory } from '@/lib/items/normalizeItemsCategory'
import type { ItemWithState, List, MemberWithCreator } from '@/lib/supabase/types'

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
 * Pull `get_list_data` for each list and mirror into Dexie + L1 cache when server data differs.
 */
export async function prefetchListDetailsFromServer(
  userId: string | null | undefined,
  rawListIds: readonly string[],
): Promise<void> {
  if (!userId) return
  if (!canFetchFromServerNow()) return
  const readFlightGen = captureReadFlightGeneration()
  const listIds = [...new Set(rawListIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  if (listIds.length === 0) return

  const outboundQueue = await db.sync_queue.toArray()

  for (const listId of listIds) {
    try {
      if (shouldDeferServerReadsForOutboundList(listId, outboundQueue)) {
        continue
      }
      const listReconcileGen = captureListReconcileGeneration(listId)
      const { data, error } = await rpcGetListData(listId)
      if (shouldDiscardReadFlightResult(readFlightGen)) {
        return
      }
      if (shouldDiscardListReconcileResult(listId, listReconcileGen)) {
        continue
      }
      if (error || !data?.list) {
        continue
      }
      const serverMembers = ((data.members ?? []) as MemberWithCreator[]).filter(
        (m) => !isTombstoned(m.deleted_at ?? null),
      )
      const nextItems = normalizeItemsCategory(
        ((data.items ?? []) as ItemWithState[]).filter((i) => !isTombstoned(i.deleted_at ?? null)),
      )
      const payload = {
        list: data.list as List,
        items: nextItems,
        members: serverMembers,
      }
      const differs = await serverListDetailDiffersFromDexie(userId, listId, payload)
      await upsertListDataPayloadFromServer(userId, listId, payload)
      setCachedList(userId, listId, payload)
    } catch (e) {
    }
  }
}
