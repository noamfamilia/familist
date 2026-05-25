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
 * Pair `last_content_update` with its `last_content_update_by` when merging server + local.
 * Returns the `by` value belonging to whichever `[ts, by]` pair has the newest timestamp; falls back
 * to either side's `by` when a side lacks a timestamp, then to null.
 */
export function pickLastContentUpdateBy(
  pairs: { ts: string | null | undefined; by: string | null | undefined }[],
): string | null {
  let bestMs = -Infinity
  let best: string | null = null
  let fallback: string | null = null
  for (const { ts, by } of pairs) {
    if (by != null && fallback == null) fallback = by
    if (ts == null || ts === '') continue
    const ms = Date.parse(String(ts))
    if (!Number.isFinite(ms)) continue
    if (ms > bestMs) {
      bestMs = ms
      best = by ?? null
    }
  }
  return best ?? fallback
}

/**
 * Advance `lists.last_content_update` when list content changes locally (items, members, IMS),
 * and stamp `last_content_update_by` with the local actor so the home "new activity" LED can
 * suppress for the author before the server round-trip completes.
 *
 * Mirrors the server `update_list_timestamp` trigger. Call inside a Dexie transaction that
 * includes `db.lists`.
 */
export async function touchListContentUpdateInDexie(
  listId: string,
  actorUserId: string | null | undefined,
  touchedAt?: string,
): Promise<string | null> {
  const touch = touchedAt ?? isoNow()
  const list = await db.lists.get(listId)
  if (!list || isTombstoned(list.deleted_at ?? null)) return null
  const next = maxIsoTimestamp(touch, list.last_content_update)
  const author = actorUserId ?? null
  const patch: { last_content_update: string; last_content_update_by?: string | null } = {
    last_content_update: next,
  }
  // Stamp author whenever we know who's editing — even when the timestamp didn't advance,
  // so a chain of same-millisecond edits still attributes correctly.
  if (author != null) patch.last_content_update_by = author
  if (next === list.last_content_update && list.last_content_update_by === author) return next
  await db.lists.update(listId, patch)
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
