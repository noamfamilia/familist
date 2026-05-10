import { db, type DbSyncQueueRow, type SyncQueueEntity } from '@/lib/db'
import { itemMemberStateOutboxKey } from '@/lib/data/syncQueue'
import { isOutboundRowPending, listIdsTouchingOutboundRow } from '@/lib/data/syncQueueListScope'

/** Pending outbound rows (queued / processing / failed) for prune gating. */
export async function loadPendingOutboundQueueSnapshot(): Promise<DbSyncQueueRow[]> {
  return db.sync_queue.filter((r) => isOutboundRowPending(r)).toArray()
}

/** Coarse lock: any in-flight RPC touching this list blocks item/member/IMS prune. */
export function pendingRpcTouchesList(queue: readonly DbSyncQueueRow[], listId: string): boolean {
  return queue.some(
    (r) => r.kind === 'rpc' && isOutboundRowPending(r) && listIdsTouchingOutboundRow(r).includes(listId),
  )
}

/** Pending list/item/member (etc.) create scoped to this list — blocks catalog removal for that list. */
export function pendingCreateTouchesList(queue: readonly DbSyncQueueRow[], listId: string): boolean {
  return queue.some(
    (r) => r.kind === 'create' && isOutboundRowPending(r) && listIdsTouchingOutboundRow(r).includes(listId),
  )
}

export function pendingCreateForEntity(
  queue: readonly DbSyncQueueRow[],
  entity: SyncQueueEntity,
  entityId: string,
): boolean {
  return queue.some(
    (r) => r.kind === 'create' && isOutboundRowPending(r) && r.entity === entity && r.entity_id === entityId,
  )
}

export function pendingCreateForItemMemberStateComposite(
  queue: readonly DbSyncQueueRow[],
  itemId: string,
  memberId: string,
): boolean {
  const key = itemMemberStateOutboxKey(itemId, memberId)
  return queue.some(
    (r) =>
      r.kind === 'create' &&
      isOutboundRowPending(r) &&
      r.entity === 'item_member_state' &&
      r.entity_id === key,
  )
}

export function catalogRemovalBlockedForList(queue: readonly DbSyncQueueRow[], listId: string): boolean {
  return pendingRpcTouchesList(queue, listId) || pendingCreateTouchesList(queue, listId)
}
