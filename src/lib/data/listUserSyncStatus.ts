import { db } from '@/lib/db'
import { getActiveCacheUserId } from '@/lib/cache'
import type { DbSyncQueueRow } from '@/lib/db'
import { listIdsTouchingOutboundRow } from '@/lib/data/syncQueueListScope'

async function getListUserRowId(listId: string, userId: string): Promise<string | null> {
  const row = await db.list_users.where('[list_id+user_id]').equals([listId, userId]).first()
  return row?.id ?? null
}

export async function setListUserSyncError(listId: string, userId: string, sync_error: boolean): Promise<void> {
  const id = await getListUserRowId(listId, userId)
  if (id) await db.list_users.update(id, { sync_error })
}

export async function clearListUserSyncError(listId: string, userId: string): Promise<void> {
  await setListUserSyncError(listId, userId, false)
}

export async function applyListUserSyncErrorForListIds(
  listIds: readonly string[],
  userId: string,
  sync_error: boolean,
): Promise<void> {
  const unique = [...new Set(listIds)]
  await Promise.all(unique.map((lid) => setListUserSyncError(lid, userId, sync_error)))
}

/** After enqueueing outbound work: clear stale error for every list touched by the new row. */
export async function clearListUserSyncErrorsForEnqueueRow(row: Pick<
  DbSyncQueueRow,
  'parent1_type' | 'parent1_id' | 'kind' | 'entity' | 'payload' | 'entity_id' | 'status'
>): Promise<void> {
  const userId = getActiveCacheUserId()
  if (!userId) return
  const lids = listIdsTouchingOutboundRow(row as DbSyncQueueRow)
  if (lids.length === 0) return
  await applyListUserSyncErrorForListIds(lids, userId, false)
}
