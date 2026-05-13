import { db } from '@/lib/db'
import { isoNow } from '@/lib/data/base_sync_fields'
import { enqueueSyncQueueRecord, listQueueParent, newBatchEntityId } from '@/lib/data/syncQueue'
import { appendMutationDiagnostic } from '@/lib/offlineNavDiagnostics'

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
  if (!userId || !listId) {
    appendMutationDiagnostic(
      `[list-activity] mark_viewed_skip reason=missing_scope userId=${userId ?? 'null'} listId=${listId ?? 'null'}`,
    )
    return null
  }
  const lastViewed = options?.nowIso ?? isoNow()
  const queueRemote = options?.queueRemote !== false
  appendMutationDiagnostic(
    `[list-activity] mark_viewed_start listId=${listId} userId=${userId} lastViewed=${lastViewed} queueRemote=${queueRemote ? 1 : 0}`,
  )

  await db.transaction('rw', db.list_users, db.sync_queue, async () => {
    const listUser = await db.list_users.where('[list_id+user_id]').equals([listId, userId]).first()
    if (!listUser) {
      appendMutationDiagnostic(`[list-activity] dexie_missing_list_user listId=${listId} userId=${userId}`)
      return
    }

    const previousLastViewed = listUser.last_viewed ?? null
    await db.list_users.update(listUser.id, { last_viewed: lastViewed })
    appendMutationDiagnostic(
      `[list-activity] dexie_update listId=${listId} rowId=${listUser.id} prev=${previousLastViewed ?? 'null'} next=${lastViewed}`,
    )
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
      appendMutationDiagnostic(
        `[list-activity] queue_coalesce listId=${listId} queueId=${existing.id} status=${existing.status} next=${lastViewed}`,
      )
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
    appendMutationDiagnostic(`[list-activity] queue_enqueue listId=${listId} entityId=${entityId} next=${lastViewed}`)
  })

  appendMutationDiagnostic(`[list-activity] mark_viewed_done listId=${listId} next=${lastViewed}`)
  return lastViewed
}
