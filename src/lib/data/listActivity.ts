import { db } from '@/lib/db'
import { isTombstoned, isoNow } from '@/lib/data/base_sync_fields'
import {
  CATALOG_RPC_COALESCE_ENTITY,
  enqueueSyncQueueRecord,
  listQueueParent,
  patchListUserOutboxKey,
} from '@/lib/data/syncQueue'

type MarkViewedOptions = {
  nowIso?: string
  queueRemote?: boolean
}

/** Pick the latest parseable ISO timestamp (mirrors Postgres `greatest` on timestamptz). */
export function maxIsoTimestamp(...candidates: (string | null | undefined)[]): string {
  let bestMs = -Infinity
  let best = ''
  for (const raw of candidates) {
    if (raw == null || raw === '') continue
    const s = String(raw)
    const ms = Date.parse(s)
    if (Number.isFinite(ms) && ms >= bestMs) {
      bestMs = ms
      best = s
    }
  }
  return best || isoNow()
}

/**
 * Advance `lists.last_content_update` when list content changes locally (items, members, IMS).
 * Mirrors server `update_list_timestamp` triggers. Call inside a Dexie transaction that includes `db.lists`.
 */
export async function touchListContentUpdateInDexie(
  listId: string,
  touchedAt?: string,
): Promise<string | null> {
  const touch = touchedAt ?? isoNow()
  const list = await db.lists.get(listId)
  if (!list || isTombstoned(list.deleted_at ?? null)) return null
  const next = maxIsoTimestamp(touch, list.last_content_update)
  if (next === list.last_content_update) return next
  await db.lists.update(listId, { last_content_update: next })
  return next
}

export async function markListViewedLocally(
  userId: string | null | undefined,
  listId: string | null | undefined,
  options?: MarkViewedOptions,
): Promise<string | null> {
  if (!userId || !listId) return null
  const lastViewed = options?.nowIso ?? isoNow()
  const queueRemote = options?.queueRemote !== false

  await db.transaction('rw', db.list_users, db.lists, db.sync_queue, async () => {
    const listUser = await db.list_users.where('[list_id+user_id]').equals([listId, userId]).first()
    if (!listUser) return

    await db.list_users.update(listUser.id, { last_viewed: lastViewed })
    if (!queueRemote) return

    await enqueueSyncQueueRecord({
      entity: CATALOG_RPC_COALESCE_ENTITY,
      entity_id: patchListUserOutboxKey(listId, userId),
      kind: 'rpc',
      payload: {
        method: 'patchListUser',
        id: listId,
        user_id: userId,
        last_viewed: lastViewed,
      },
      ...listQueueParent(listId),
      status: 'queued',
    })
  })

  return lastViewed
}
