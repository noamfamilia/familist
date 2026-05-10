import { getActiveCacheUserId } from '@/lib/cache'
import { db, type DbSyncQueueRow, type SyncQueueEntity, type SyncQueueKind } from '@/lib/db'
import { clearListUserSyncError, clearListUserSyncErrorsForEnqueueRow } from '@/lib/data/listUserSyncStatus'

/** True when a sync_queue row is scoped to `listId` (parent, entity id, or payload.list_id). */
export function syncQueueRowTouchesListId(row: DbSyncQueueRow, listId: string): boolean {
  const pl = row.payload as { list_id?: string } | undefined
  return (
    row.parent1_id === listId ||
    (row.entity === 'list' && row.entity_id === listId) ||
    (typeof pl?.list_id === 'string' && pl.list_id === listId)
  )
}

export function itemMemberStateOutboxKey(itemId: string, memberId: string) {
  return `ims:${itemId}:${memberId}`
}

export function memberProfileOutboxKey(memberId: string) {
  return `mbr:${memberId}`
}

export function newBatchEntityId(): string {
  return `batch:${crypto.randomUUID()}`
}

export function listQueueParent(listId: string): Pick<
  DbSyncQueueRow,
  'parent1_type' | 'parent1_id' | 'parent2_type' | 'parent2_id'
> {
  return {
    parent1_type: 'list',
    parent1_id: listId,
    parent2_type: null,
    parent2_id: null,
  }
}

export function userQueueParent(userId: string): Pick<
  DbSyncQueueRow,
  'parent1_type' | 'parent1_id' | 'parent2_type' | 'parent2_id'
> {
  return {
    parent1_type: 'user',
    parent1_id: userId,
    parent2_type: null,
    parent2_id: null,
  }
}

function isPatchMergeEntity(entity: SyncQueueEntity): boolean {
  return entity === 'item' || entity === 'member' || entity === 'item_member_state' || entity === 'list'
}

function shouldAppendOnly(entity: SyncQueueEntity, entityId: string, kind: SyncQueueKind): boolean {
  if (kind === 'rpc') return true
  if (entityId.startsWith('batch:')) return true
  if (kind === 'create' || kind === 'delete') return true
  return false
}

/** Remove all outbound work scoped to a list (prevents ghost sync after delete/leave). */
export async function clearSyncQueueForList(listId: string): Promise<void> {
  await db.sync_queue.filter((r) => syncQueueRowTouchesListId(r, listId)).delete()
  const uid = getActiveCacheUserId()
  if (uid) await clearListUserSyncError(listId, uid)
}

/** Remove queued outbound rows for specific item ids (e.g. before bulk delete RPC makes them stale). */
export async function removeOutboundQueueRowsForItemIds(
  listId: string,
  itemIds: ReadonlySet<string>,
): Promise<void> {
  if (itemIds.size === 0) return
  const rows = await db.sync_queue.filter((r) => syncQueueRowTouchesListId(r, listId)).toArray()
  for (const r of rows) {
    let drop = false
    if (r.entity === 'item' && itemIds.has(r.entity_id)) drop = true
    if (r.entity === 'item_member_state') {
      const p = r.payload as { item_id?: string }
      if (typeof p.item_id === 'string' && itemIds.has(p.item_id)) drop = true
    }
    if ((r.kind === 'patch' || r.kind === 'create') && r.entity === 'item') {
      const pid = String((r.payload as { id?: string }).id ?? r.entity_id)
      if (pid && itemIds.has(pid)) drop = true
    }
    if (r.kind === 'delete' && r.entity === 'item') {
      const did = String((r.payload as { id?: string }).id ?? r.entity_id)
      if (did && itemIds.has(did)) drop = true
    }
    if (drop) await db.sync_queue.delete(r.id)
  }
}

type EnqueueInput = Omit<
  DbSyncQueueRow,
  'locked_at' | 'attempt_count' | 'last_error' | 'next_retry_at' | 'id' | 'updated_at'
> & {
  id?: string
  updated_at?: number
  locked_at?: number | null
  attempt_count?: number
  last_error?: string | null
  next_retry_at?: number | null
}

export async function enqueueSyncQueueRecord(input: EnqueueInput): Promise<void> {
  const ts = input.updated_at ?? Date.now()
  const id = input.id ?? crypto.randomUUID()
  const status = input.status ?? 'queued'
  const locked_at = input.locked_at ?? null
  const attempt_count = input.attempt_count ?? 0
  const last_error = input.last_error ?? null
  const next_retry_at = input.next_retry_at ?? null

  if (input.kind === 'delete') {
    await db.sync_queue.where('[entity+entity_id]').equals([input.entity, input.entity_id]).delete()
    await db.sync_queue.put({
      id,
      entity: input.entity,
      entity_id: input.entity_id,
      kind: 'delete',
      payload: input.payload,
      parent1_type: input.parent1_type,
      parent1_id: input.parent1_id,
      parent2_type: input.parent2_type,
      parent2_id: input.parent2_id,
      status,
      locked_at,
      attempt_count,
      last_error,
      next_retry_at,
      updated_at: ts,
    })
    await clearListUserSyncErrorsForEnqueueRow({
      parent1_type: input.parent1_type,
      parent1_id: input.parent1_id,
      kind: 'delete',
      entity: input.entity,
      entity_id: input.entity_id,
      payload: input.payload,
      status,
    })
    return
  }

  const mergePatch =
    input.kind === 'patch' &&
    isPatchMergeEntity(input.entity) &&
    !shouldAppendOnly(input.entity, input.entity_id, input.kind)

  if (mergePatch) {
    const existing = await db.sync_queue
      .where('[entity+entity_id]')
      .equals([input.entity, input.entity_id])
      .filter((r) => r.kind === 'patch' && r.status === 'queued')
      .first()
    if (existing) {
      const mergedPayload = { ...existing.payload, ...input.payload }
      await db.sync_queue.update(existing.id, {
        payload: mergedPayload,
        updated_at: ts,
        next_retry_at: null,
        parent1_type: input.parent1_type ?? existing.parent1_type,
        parent1_id: input.parent1_id ?? existing.parent1_id,
        parent2_type: input.parent2_type ?? existing.parent2_type,
        parent2_id: input.parent2_id ?? existing.parent2_id,
      })
      await clearListUserSyncErrorsForEnqueueRow({
        parent1_type: input.parent1_type ?? existing.parent1_type,
        parent1_id: input.parent1_id ?? existing.parent1_id,
        kind: 'patch',
        entity: input.entity,
        entity_id: input.entity_id,
        payload: mergedPayload,
        status: 'queued',
      })
      return
    }
  }

  await db.sync_queue.put({
    id,
    entity: input.entity,
    entity_id: input.entity_id,
    kind: input.kind,
    payload: input.payload,
    parent1_type: input.parent1_type,
    parent1_id: input.parent1_id,
    parent2_type: input.parent2_type,
    parent2_id: input.parent2_id,
    status,
    locked_at,
    attempt_count,
    last_error,
    next_retry_at,
    updated_at: ts,
  })
  await clearListUserSyncErrorsForEnqueueRow({
    parent1_type: input.parent1_type,
    parent1_id: input.parent1_id,
    kind: input.kind,
    entity: input.entity,
    entity_id: input.entity_id,
    payload: input.payload,
    status,
  })
}

function truncateLabel(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, Math.max(0, max - 1))}…`
}

/** One-line summary for sync status UI (queue row). */
export function describeSyncQueueRow(row: DbSyncQueueRow): string {
  const pl = row.payload as Record<string, unknown>
  const { entity, kind } = row

  if (kind === 'delete') {
    if (entity === 'item') return 'Deleting item…'
    if (entity === 'member') return 'Removing member…'
    if (entity === 'item_member_state') return 'Clearing item check-off state…'
    if (entity === 'list') return 'Deleting list…'
    if (entity === 'list_users') return 'Leaving list…'
  }

  if (kind === 'create') {
    if (entity === 'item') {
      const text = typeof pl.text === 'string' ? pl.text : ''
      return text ? `Adding item: ${truncateLabel(text, 36)}` : 'Adding item…'
    }
    if (entity === 'list') return 'Creating list…'
    if (entity === 'member') return 'Adding member…'
    if (entity === 'feedback') return 'Sending feedback…'
  }

  if (kind === 'patch') {
    if (entity === 'item') {
      const text = typeof pl.text === 'string' ? pl.text : ''
      if (text) return `Updating item: ${truncateLabel(text, 36)}`
      return 'Updating item…'
    }
    if (entity === 'list') return 'Updating list…'
    if (entity === 'member') return 'Updating member…'
    if (entity === 'item_member_state') return 'Updating shopping progress…'
    if (entity === 'list_users') return 'Updating list preferences…'
    if (entity === 'profile') return 'Updating profile…'
    if (entity === 'feedback') return 'Sending feedback…'
  }

  if (kind === 'rpc') {
    const method = String(pl.method ?? '')
    switch (method) {
      case 'reorderListItems':
        return 'Reordering items…'
      case 'bulkAddListItems':
        return 'Adding multiple items…'
      case 'patchListUser':
        return 'Updating my list order…'
      case 'reorderListUsers':
        return 'Reordering lists…'
      case 'bulkPatchListLabels':
        return 'Updating list labels…'
      case 'joinListByToken':
        return 'Joining list…'
      case 'leaveList':
        return 'Leaving list…'
      case 'duplicateList':
        return 'Duplicating list…'
      case 'importList':
        return 'Importing list…'
      case 'ownMember':
        return 'Taking member ownership…'
      case 'generateShareToken':
        return 'Generating invite link…'
      case 'revokeShareToken':
        return 'Disabling invite link…'
      case 'removeUsersFromList':
        return 'Removing users from list…'
      case 'deleteArchivedItems':
        return 'Deleting archived items…'
      case 'restoreArchivedItems':
        return 'Restoring archived items…'
      default:
        return method ? `Server action (${method})` : 'Server action…'
    }
  }

  return `${kind} · ${entity}`
}

/** Reset all failed outbound rows so the sync worker can pick them up again. */
/** Resolve when outbound processing removes the row (success) or it ends in `failed` (rejection). */
export async function waitForSyncQueueRowCompletion(
  rowId: string,
  options?: { timeoutMs?: number; pollMs?: number },
): Promise<{ ok: true } | { ok: false; code: 'failed' | 'timeout'; message: string }> {
  const timeoutMs = options?.timeoutMs ?? 90_000
  const pollMs = options?.pollMs ?? 120
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const row = await db.sync_queue.get(rowId)
    if (!row) return { ok: true }
    if (row.status === 'failed')
      return { ok: false, code: 'failed', message: row.last_error ?? 'Sync failed' }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  const still = await db.sync_queue.get(rowId)
  if (!still) return { ok: true }
  return { ok: false, code: 'timeout', message: 'Sync timed out' }
}

/** Expose outbound rows awaiting processing (re-queue stuck `processing`). Used by bootstrap repair. */
export async function reviveSyncQueueRowsForOutbound(rowIds: string[]): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.sync_queue, async () => {
    for (const id of rowIds) {
      await db.sync_queue.update(id, {
        status: 'queued',
        locked_at: null,
        next_retry_at: null,
        updated_at: now,
      })
    }
  })
}

export async function resetFailedSyncQueueRows(): Promise<void> {
  await db.transaction('rw', db.sync_queue, async () => {
    const failed = await db.sync_queue.where('status').equals('failed').toArray()
    const now = Date.now()
    for (const r of failed) {
      await db.sync_queue.update(r.id, {
        status: 'queued',
        next_retry_at: null,
        locked_at: null,
        updated_at: now,
      })
    }
  })
}
