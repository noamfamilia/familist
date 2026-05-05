import { db, type DbSyncQueueRow } from '@/lib/db'

export function itemMemberStateOutboxKey(itemId: string, memberId: string) {
  return `ims:${itemId}:${memberId}`
}

export function memberProfileOutboxKey(memberId: string) {
  return `mbr:${memberId}`
}

export async function enqueueSyncQueueRecord(record: Omit<DbSyncQueueRow, 'attemptCount' | 'lastError'>) {
  const key = [record.listId, record.itemKey] as const
  const existing = await db.sync_queue.get(key)
  const now = Date.now()
  await db.sync_queue.put({
    ...record,
    updatedAt: now,
    attemptCount: existing?.attemptCount ?? 0,
    lastError: existing?.lastError ?? null,
  })
}

export async function removeSyncQueueRecord(listId: string, itemKey: string) {
  await db.sync_queue.delete([listId, itemKey])
}
