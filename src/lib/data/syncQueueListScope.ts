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

  if (row.entity === 'list' && row.kind === 'create') {
    pushRealListId(ids, row.entity_id)
    pushRealListId(ids, (pl as { id?: string }).id)
  }
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
    if (method === 'seedItemMemberStateForMember') pushRealListId(ids, pl.list_id)
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

function pendingListCreateForId(
  queue: readonly DbSyncQueueRow[],
  excludeRowId: string,
  listId: string,
): boolean {
  if (!listId || listId.startsWith('user:')) return false
  return queue.some(
    (r) =>
      r.id !== excludeRowId &&
      isOutboundRowPending(r) &&
      r.kind === 'create' &&
      r.entity === 'list' &&
      r.entity_id === listId,
  )
}

function pendingEntityCreateForId(
  queue: readonly DbSyncQueueRow[],
  excludeRowId: string,
  entity: 'item' | 'member' | 'list',
  entityId: string,
): boolean {
  if (!entityId) return false
  return queue.some(
    (r) =>
      r.id !== excludeRowId &&
      isOutboundRowPending(r) &&
      r.kind === 'create' &&
      r.entity === entity &&
      r.entity_id === entityId,
  )
}

function collectRpcReorderOrBulkItemIds(pl: Record<string, unknown>): string[] {
  const ids: string[] = []
  const itemIds = pl.item_ids
  if (Array.isArray(itemIds)) {
    for (const x of itemIds) {
      if (typeof x === 'string' && x.length > 0) ids.push(x)
    }
  }
  const items = pl.items
  if (Array.isArray(items)) {
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue
      const id = typeof (raw as { id?: unknown }).id === 'string' ? (raw as { id: string }).id : ''
      if (id) ids.push(id)
    }
  }
  return [...new Set(ids)]
}

function shortId(id: string): string {
  if (id.length <= 12) return id
  return `${id.slice(0, 8)}…`
}

/**
 * Human-readable reason the row must wait (for diagnostics / UI). `null` when not blocked.
 */
export function blockedOutboundDependencyReason(row: DbSyncQueueRow, queue: readonly DbSyncQueueRow[]): string | null {
  const ex = row.id

  for (const lid of listIdsTouchingOutboundRow(row)) {
    if (pendingListCreateForId(queue, ex, lid)) {
      return `Waiting for list create (${shortId(lid)}) to finish on the server first.`
    }
  }

  if (row.kind === 'patch' || row.kind === 'delete') {
    if (row.entity === 'item') {
      const pl = row.payload as { id?: unknown }
      const id = String(pl.id ?? row.entity_id ?? '')
      if (id && pendingEntityCreateForId(queue, ex, 'item', id)) {
        return `Waiting for item create (${shortId(id)}) before this ${row.kind}.`
      }
    } else if (row.entity === 'member') {
      const pl = row.payload as { id?: unknown; memberId?: unknown }
      const id = String(pl.id ?? pl.memberId ?? row.entity_id ?? '')
      if (id && pendingEntityCreateForId(queue, ex, 'member', id)) {
        return `Waiting for member create (${shortId(id)}) before this ${row.kind}.`
      }
    } else if (row.entity === 'list') {
      const pl = row.payload as { id?: unknown }
      const id = String(pl.id ?? row.entity_id ?? '')
      if (id && pendingEntityCreateForId(queue, ex, 'list', id)) {
        return `Waiting for list create (${shortId(id)}) before this ${row.kind}.`
      }
    }
  }

  if (row.entity === 'item_member_state' && row.kind === 'patch') {
    const pl = row.payload as { item_id?: unknown; member_id?: unknown }
    const itemId = typeof pl.item_id === 'string' ? pl.item_id : ''
    const memberId = typeof pl.member_id === 'string' ? pl.member_id : ''
    if (itemId && pendingEntityCreateForId(queue, ex, 'item', itemId)) {
      return `Waiting for item create (${shortId(itemId)}) before item/member state sync.`
    }
    if (memberId && pendingEntityCreateForId(queue, ex, 'member', memberId)) {
      return `Waiting for member create (${shortId(memberId)}) before item/member state sync.`
    }
  }

  if (row.kind === 'rpc') {
    const pl = row.payload as Record<string, unknown>
    const method = String(pl.method ?? '')
    if (method === 'reorderListItems' || method === 'bulkAddListItems') {
      for (const iid of collectRpcReorderOrBulkItemIds(pl)) {
        if (pendingEntityCreateForId(queue, ex, 'item', iid)) {
          return `Waiting for item create (${shortId(iid)}) before ${method}.`
        }
      }
    } else if (method === 'seedItemMemberStateForMember' || method === 'ownMember') {
      const mid = typeof pl.member_id === 'string' ? pl.member_id : ''
      if (mid && pendingEntityCreateForId(queue, ex, 'member', mid)) {
        return `Waiting for member create (${shortId(mid)}) before ${method}.`
      }
    } else if (method === 'patchListUser') {
      const lid = typeof pl.id === 'string' ? pl.id : ''
      if (lid && pendingListCreateForId(queue, ex, lid)) {
        return `Waiting for list create (${shortId(lid)}) before patchListUser.`
      }
    }
  }

  return null
}

/**
 * Outbound dependency guard: avoid FK / ordering failures by never sending a row before its
 * parent list or subject entity exists on the server (pending `create` rows in the same queue).
 */
export function isBlockedByPendingDependencies(row: DbSyncQueueRow, queue: readonly DbSyncQueueRow[]): boolean {
  return blockedOutboundDependencyReason(row, queue) != null
}

export function countPendingOutboundForList(queue: readonly DbSyncQueueRow[], listId: string): number {
  return queue.filter((r) => isOutboundRowPending(r) && listIdsTouchingOutboundRow(r).includes(listId)).length
}
