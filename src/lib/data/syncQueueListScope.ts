import type { DbSyncQueueRow } from '@/lib/db'

function pushRealListId(ids: Set<string>, id: unknown) {
  if (typeof id !== 'string' || id.length === 0 || id.startsWith('user:')) return
  ids.add(id)
}

/**
 * All real list UUIDs affected by an outbound queue row (for per-list pending counts and sync_error).
 */
export function listIdsTouchingOutboundRow(row: DbSyncQueueRow): string[] {
  const ids = new Set<string>()
  if (row.parent1_type === 'list') pushRealListId(ids, row.parent1_id)

  const pl = row.payload as Record<string, unknown>
  pushRealListId(ids, pl.list_id)

  if (row.entity === 'list' && row.kind === 'delete') {
    pushRealListId(ids, (pl as { id?: string }).id)
    pushRealListId(ids, row.entity_id)
  }
  if (row.entity === 'list' && row.kind === 'patch') {
    pushRealListId(ids, (pl as { id?: string }).id)
  }
  if (row.entity === 'item' || row.entity === 'member') {
    pushRealListId(ids, pl.list_id)
  }

  if (row.kind === 'rpc') {
    const method = String(pl.method ?? '')
    if (method === 'reorderListUsers' && Array.isArray(pl.list_ids)) {
      for (const x of pl.list_ids as unknown[]) pushRealListId(ids, x)
    }
    if (method === 'bulkPatchListLabels' && Array.isArray(pl.updates)) {
      for (const u of pl.updates as Array<{ list_id?: unknown }>) pushRealListId(ids, u.list_id)
    }
    if (method === 'patchListUser') pushRealListId(ids, pl.id)
    if (method === 'duplicateList') {
      pushRealListId(ids, pl.source_list_id)
      pushRealListId(ids, pl.duplicate_id)
    }
    if (method === 'importList') pushRealListId(ids, pl.imported_id)
    if (method === 'leaveList') pushRealListId(ids, pl.list_id)
    if (method === 'reorderListItems') pushRealListId(ids, pl.list_id)
    if (method === 'bulkAddListItems') pushRealListId(ids, pl.list_id)
    if (method === 'deleteArchivedItems' || method === 'restoreArchivedItems') pushRealListId(ids, pl.list_id)
    if (method === 'generateShareToken' || method === 'revokeShareToken' || method === 'removeUsersFromList') {
      pushRealListId(ids, pl.list_id)
    }
  }

  return [...ids]
}

export function isOutboundRowPending(row: DbSyncQueueRow): boolean {
  return row.status === 'queued' || row.status === 'failed' || row.status === 'processing'
}

export function countPendingOutboundForList(queue: readonly DbSyncQueueRow[], listId: string): number {
  return queue.filter((r) => isOutboundRowPending(r) && listIdsTouchingOutboundRow(r).includes(listId)).length
}
