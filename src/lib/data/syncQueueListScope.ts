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
    if (method === 'importList') pushRealListId(ids, pl.imported_id)
    if (method === 'leaveList') pushRealListId(ids, pl.list_id)
    if (method === 'reorderListItems') pushRealListId(ids, pl.list_id)
    if (method === 'bulkAddListItems') pushRealListId(ids, pl.list_id)
    if (method === 'bulkAddStates') pushRealListId(ids, pl.list_id)
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

/** True when another outbound row (not `excludeRowId`) is still pending for `listId`. */
export function hasOtherPendingOutboundForList(
  queue: readonly DbSyncQueueRow[],
  listId: string,
  excludeRowId?: string,
): boolean {
  return queue.some(
    (r) =>
      r.id !== excludeRowId &&
      isOutboundRowPending(r) &&
      listIdsTouchingOutboundRow(r).includes(listId),
  )
}

/** Matches outbound drain lock recovery in `useSyncStore`. */
export const OUTBOUND_SYNC_LOCK_STALE_MS = 60_000

export function isOutboundRowRetryTimerActive(row: DbSyncQueueRow, now: number): boolean {
  const nr = row.next_retry_at ?? null
  return nr != null && nr > now
}

export function isOutboundRowBaseEligibleForSync(row: DbSyncQueueRow, now: number): boolean {
  const nr = row.next_retry_at ?? null
  const stale = row.locked_at != null && now - row.locked_at > OUTBOUND_SYNC_LOCK_STALE_MS

  if (row.status === 'processing') return stale
  if (row.status === 'queued') return nr == null || nr <= now
  if (row.status === 'failed') return nr == null || nr <= now
  return false
}

export function isOutboundRowEligibleForSync(
  row: DbSyncQueueRow,
  now: number,
  queue: readonly DbSyncQueueRow[],
): boolean {
  if (!isOutboundRowBaseEligibleForSync(row, now)) return false
  if (isBlockedByPendingDependencies(row, queue)) return false
  return true
}

/** True when this queued row is ready except another pending row is ahead in FIFO order or is processing. */
export function isOutboundRowBlockedByEarlierQueueWork(
  row: DbSyncQueueRow,
  queue: readonly DbSyncQueueRow[],
  now: number,
): boolean {
  if (row.status !== 'queued') return false
  if (!isOutboundRowBaseEligibleForSync(row, now)) return false
  if (isBlockedByPendingDependencies(row, queue)) return false

  const rowUpdated = row.updated_at ?? 0
  for (const other of queue) {
    if (other.id === row.id || !isOutboundRowPending(other)) continue
    if (other.status === 'processing') {
      const stale = other.locked_at != null && now - other.locked_at > OUTBOUND_SYNC_LOCK_STALE_MS
      if (!stale) return true
    }
    if (isOutboundRowEligibleForSync(other, now, queue) && (other.updated_at ?? 0) < rowUpdated) {
      return true
    }
  }
  return false
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

function pendingBulkAddListItemsForList(
  queue: readonly DbSyncQueueRow[],
  excludeRowId: string,
  listId: string,
): boolean {
  if (!listId || listId.startsWith('user:')) return false
  return queue.some((r) => {
    if (r.id === excludeRowId || !isOutboundRowPending(r)) return false
    if (r.kind !== 'rpc') return false
    const pl = r.payload as { method?: unknown; list_id?: unknown }
    return String(pl.method ?? '') === 'bulkAddListItems' && String(pl.list_id ?? '') === listId
  })
}

function pendingBulkAddStatesForList(
  queue: readonly DbSyncQueueRow[],
  excludeRowId: string,
  listId: string,
): boolean {
  if (!listId || listId.startsWith('user:')) return false
  return queue.some((r) => {
    if (r.id === excludeRowId || !isOutboundRowPending(r)) return false
    if (r.kind !== 'rpc') return false
    const pl = r.payload as { method?: unknown; list_id?: unknown }
    return String(pl.method ?? '') === 'bulkAddStates' && String(pl.list_id ?? '') === listId
  })
}

/** Rows that establish a duplicated/imported list on the server (must not block each other). */
function isListBootstrapOutboundRow(row: DbSyncQueueRow, listId: string): boolean {
  if (!listId || listId.startsWith('user:')) return false
  if (row.kind === 'create' && row.entity === 'list' && row.entity_id === listId) return true
  if (row.kind === 'rpc') {
    const pl = row.payload as { method?: unknown; list_id?: unknown }
    if (String(pl.list_id ?? '') !== listId) return false
    const method = String(pl.method ?? '')
    return method === 'bulkAddListItems' || method === 'bulkAddStates'
  }
  return false
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
    if (!isListBootstrapOutboundRow(row, lid)) {
      if (pendingBulkAddListItemsForList(queue, ex, lid)) {
        return `Waiting for bulk item copy (${shortId(lid)}) before other list edits.`
      }
      if (pendingBulkAddStatesForList(queue, ex, lid)) {
        return `Waiting for members and progress copy (${shortId(lid)}) before other list edits.`
      }
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
    } else if (method === 'bulkAddStates') {
      const lid = typeof pl.list_id === 'string' ? pl.list_id : ''
      if (lid && pendingListCreateForId(queue, ex, lid)) {
        return `Waiting for list create (${shortId(lid)}) before bulkAddStates.`
      }
      if (lid && pendingBulkAddListItemsForList(queue, ex, lid)) {
        return `Waiting for bulk item copy (${shortId(lid)}) before bulkAddStates.`
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
