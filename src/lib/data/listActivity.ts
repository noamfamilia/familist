import { db } from '@/lib/db'
import { isoNow } from '@/lib/data/base_sync_fields'
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
