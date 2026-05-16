import { db } from '@/lib/db'
import type { DbSyncQueueRow } from '@/lib/db'
import { appendMutationDiagnostic } from '@/lib/offlineNavDiagnostics'
import { bumpListReconcileGeneration } from '@/lib/data/listReconcilePolicy'
import { syncListDetail, syncLists } from '@/lib/data/sync'
import {
  hasOtherPendingOutboundForList,
  listIdsTouchingOutboundRow,
} from '@/lib/data/syncQueueListScope'

function isVirtualUserListKey(listId: string): boolean {
  return listId.startsWith('user:')
}

export function shouldSkipListDetailVerifyForOutboundRow(row: DbSyncQueueRow): boolean {
  if (row.kind === 'patch') return true
  if (row.kind === 'rpc') {
    const method = String((row.payload as { method?: string }).method ?? '')
    if (method === 'leaveList' || method === 'patchListUser') return true
  }
  return false
}

export function shouldDeferOutboundVerify(
  row: DbSyncQueueRow,
  queue: readonly DbSyncQueueRow[],
): boolean {
  const touched = listIdsTouchingOutboundRow(row).filter((id) => !isVirtualUserListKey(id))
  return touched.some((listId) => hasOtherPendingOutboundForList(queue, listId, row.id))
}

/** One catalog + list detail fetch after all outbound work for `listId` has drained. */
export async function flushQuiescentListVerification(userId: string, listId: string): Promise<void> {
  if (isVirtualUserListKey(listId)) return
  const queue = await db.sync_queue.toArray()
  if (hasOtherPendingOutboundForList(queue, listId)) return

  appendMutationDiagnostic(`[sync-verify] quiescent flush listId=${listId}`)
  bumpListReconcileGeneration(listId, 'post-verify-quiescent')
  await syncLists(userId, 'Post-mutation verification: list catalog')
  await syncListDetail(userId, listId, 'Post-mutation verification: list detail')
}
