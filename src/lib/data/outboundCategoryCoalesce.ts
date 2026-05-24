import { db, type DbSyncQueueRow } from '@/lib/db'
import { reorderListItemsOutboxKey } from '@/lib/data/outboundListDetailRpcCoalesce'
import { waitForSyncQueueRowCompletion } from '@/lib/data/syncQueue'

const MERGEABLE_STATUSES = new Set(['queued', 'failed'])

function isCategoryListPatchRow(row: DbSyncQueueRow, listId: string): boolean {
  if (row.entity !== 'list' || row.entity_id !== listId || row.kind !== 'patch') return false
  const pl = row.payload as Record<string, unknown>
  return pl.category_names !== undefined || pl.category_order !== undefined
}

function isReorderListItemsRow(row: DbSyncQueueRow, listId: string): boolean {
  if (row.kind !== 'rpc') return false
  const pl = row.payload as Record<string, unknown>
  return (
    String(pl.method ?? '') === 'reorderListItems' &&
  String(pl.list_id ?? '') === listId
  )
}

export function findProcessingCategoryListPatchRow(listId: string): Promise<DbSyncQueueRow | undefined> {
  return db.sync_queue
    .where('status')
    .equals('processing')
    .filter((r) => isCategoryListPatchRow(r, listId))
    .first()
}

export function findProcessingReorderListItemsRow(listId: string): Promise<DbSyncQueueRow | undefined> {
  return db.sync_queue
    .where('status')
    .equals('processing')
    .filter((r) => isReorderListItemsRow(r, listId))
    .first()
}

async function awaitProcessingRow(rowId: string): Promise<void> {
  await waitForSyncQueueRowCompletion(rowId)
}

/** Wait for in-flight category list patch before enqueueing another category patch. */
export async function awaitDrainCategoryListPatch(listId: string): Promise<void> {
  for (;;) {
    const row = await findProcessingCategoryListPatchRow(listId)
    if (!row) return
    await awaitProcessingRow(row.id)
  }
}

/** Wait for category patch + reorderListItems RPC before enqueueing sort items. */
export async function awaitDrainBeforeReorderListItems(listId: string): Promise<void> {
  for (;;) {
    const categoryRow = await findProcessingCategoryListPatchRow(listId)
    if (categoryRow) {
      await awaitProcessingRow(categoryRow.id)
      continue
    }
    const reorderRow = await findProcessingReorderListItemsRow(listId)
    if (reorderRow) {
      await awaitProcessingRow(reorderRow.id)
      continue
    }
    return
  }
}

export function isReorderListItemsCoalescedRow(row: DbSyncQueueRow, listId: string): boolean {
  if (row.kind !== 'rpc') return false
  if (row.entity === 'list' && row.entity_id === reorderListItemsOutboxKey(listId)) return true
  return isReorderListItemsRow(row, listId)
}

export { MERGEABLE_STATUSES }
