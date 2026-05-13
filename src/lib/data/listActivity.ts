import { db } from '@/lib/db'
import { isoNow } from '@/lib/data/base_sync_fields'
import { enqueueSyncQueueRecord, listQueueParent, newBatchEntityId } from '@/lib/data/syncQueue'

type MarkViewedOptions = {
  nowIso?: string
  queueRemote?: boolean
}

function isPatchListUserForList(
  payload: Record<string, unknown>,
  listId: string,
  userId: string,
): boolean {
  return (
    payload.method === 'patchListUser' &&
    payload.id === listId &&
    payload.user_id === userId
  )
}

export async function markListViewedLocally(
  userId: string | null | undefined,
  listId: string | null | undefined,
  options?: MarkViewedOptions,
): Promise<string | null> {
  if (!userId || !listId) return null
  const lastViewed = options?.nowIso ?? isoNow()
  const queueRemote = options?.queueRemote !== false

  await db.transaction('rw', db.list_users, db.sync_queue, async () => {
    const listUser = await db.list_users.where('[list_id+user_id]').equals([listId, userId]).first()
    if (!listUser) return

    await db.list_users.update(listUser.id, { last_viewed: lastViewed })
    if (!queueRemote) return

    const existing = await db.sync_queue
      .filter((row) => {
        if (row.kind !== 'rpc' || row.entity !== 'list') return false
        if (row.status !== 'queued' && row.status !== 'failed') return false
        return isPatchListUserForList(row.payload, listId, userId)
      })
      .last()

    if (existing) {
      await db.sync_queue.update(existing.id, {
        payload: { ...existing.payload, last_viewed: lastViewed },
        updated_at: Date.now(),
        locked_at: null,
        next_retry_at: null,
      })
      return
    }

    const entityId = newBatchEntityId()
    await enqueueSyncQueueRecord({
      entity: 'list',
      entity_id: entityId,
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
