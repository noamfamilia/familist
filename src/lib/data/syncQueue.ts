import { getActiveCacheUserId } from '@/lib/cache'
import { db, type DbSyncQueueRow, type SyncQueueEntity, type SyncQueueKind, type SyncQueueStatus } from '@/lib/db'

/** Live progress line while a row is `processing` (Server queue UI, diagnostics). */
export async function updateSyncQueueProcessingDetail(rowId: string, detail: string | null): Promise<void> {
  const now = Date.now()
  await db.sync_queue.update(rowId, { processing_detail: detail, updated_at: now })
}
import { clearListUserSyncError, clearListUserSyncErrorsForEnqueueRow } from '@/lib/data/listUserSyncStatus'
import { clearListSyncErrorMessages } from '@/lib/data/listSyncErrorMessage'
import { bumpListReconcileGenerationsForEnqueue } from '@/lib/data/listReconcilePolicy'

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

const IMS_PATCH_OVERLAY_STATUSES: readonly SyncQueueStatus[] = ['queued', 'processing', 'failed']

export type PendingImsPatchFields = {
  quantity: number
  done: boolean
  assigned: boolean
}

/** Latest outbound IMS patch intent per item → member (last `updated_at` wins). Used to overlay server fetches. */
export function collectLatestPendingItemMemberStatePatchesForList(
  listId: string,
  rows: readonly DbSyncQueueRow[],
): Map<string, Map<string, PendingImsPatchFields>> {
  const ordered = [...rows]
    .filter(
      (r) =>
        r.entity === 'item_member_state' &&
        r.kind === 'patch' &&
        IMS_PATCH_OVERLAY_STATUSES.includes(r.status) &&
        syncQueueRowTouchesListId(r, listId),
    )
    .sort((a, b) => a.updated_at - b.updated_at)

  const out = new Map<string, Map<string, PendingImsPatchFields>>()
  for (const r of ordered) {
    const p = r.payload as {
      item_id?: string
      member_id?: string
      quantity?: unknown
      done?: unknown
      assigned?: unknown
    }
    const item_id = typeof p.item_id === 'string' ? p.item_id : ''
    const member_id = typeof p.member_id === 'string' ? p.member_id : ''
    if (!item_id || !member_id) continue
    let inner = out.get(item_id)
    if (!inner) {
      inner = new Map()
      out.set(item_id, inner)
    }
    inner.set(member_id, {
      quantity: typeof p.quantity === 'number' && !Number.isNaN(p.quantity) ? p.quantity : 1,
      done: Boolean(p.done),
      assigned: Boolean(p.assigned),
    })
  }
  return out
}

/**
 * Deterministic Dexie primary key for `item_member_state` so each (item_id, member_id) maps to one row.
 * RFC 4122 UUID shape (version 5–style) from SHA-256 of the pair — stable across toggles and matches server upserts.
 */
export async function stableItemMemberStateDexieId(itemId: string, memberId: string): Promise<string> {
  const input = new TextEncoder().encode(`item_member_state:v1\0${itemId}\0${memberId}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  const bytes = digest.subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  let hex = ''
  for (let i = 0; i < 16; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0')
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
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
  return (
    entity === 'item' ||
    entity === 'member' ||
    entity === 'item_member_state' ||
    entity === 'list' ||
    entity === 'profile'
  )
}

function shouldAppendOnly(entity: SyncQueueEntity, entityId: string, kind: SyncQueueKind): boolean {
  if (kind === 'rpc') return true
  if (entityId.startsWith('batch:')) return true
  if (kind === 'create' || kind === 'delete') return true
  return false
}

async function deleteOutboundImsRowsForItemId(itemId: string): Promise<void> {
  await db.sync_queue
    .filter((r) => {
      if (r.entity !== 'item_member_state') return false
      const p = r.payload as { item_id?: unknown }
      return typeof p.item_id === 'string' && p.item_id === itemId
    })
    .delete()
}

async function deleteOutboundImsRowsForMemberId(memberId: string): Promise<void> {
  await db.sync_queue
    .filter((r) => {
      if (r.entity !== 'item_member_state') return false
      const p = r.payload as { member_id?: unknown }
      return typeof p.member_id === 'string' && p.member_id === memberId
    })
    .delete()
}

/** Remove every `sync_queue` row whose scope includes `listId` (Dexie only; no list-user / message cleanup). */
export async function deleteOutboundQueueRowsTouchingList(listId: string): Promise<void> {
  await db.sync_queue.filter((r) => syncQueueRowTouchesListId(r, listId)).delete()
}

/**
 * List was created only on-device (create / duplicate / import RPC) and never synced —
 * deleting it should net-zero the outbound queue (no server delete).
 */
export async function listHasOnlyLocalCreationIntent(listId: string): Promise<boolean> {
  if (
    (await db.sync_queue
      .where('[entity+entity_id]')
      .equals(['list', listId])
      .filter((r) => r.kind === 'create')
      .count()) > 0
  ) {
    return true
  }
  const touching = await db.sync_queue.filter((r) => syncQueueRowTouchesListId(r, listId)).toArray()
  for (const r of touching) {
    if (r.kind !== 'rpc') continue
    const pl = r.payload as { method?: string; duplicate_id?: string; imported_id?: string }
    const method = String(pl.method ?? '')
    if (method === 'importList' && String(pl.imported_id ?? '') === listId) return true
  }
  return false
}

/** Remove all outbound work scoped to a list (prevents ghost sync after delete/leave). */
export async function clearSyncQueueForList(listId: string): Promise<void> {
  await deleteOutboundQueueRowsTouchingList(listId)
  const uid = getActiveCacheUserId()
  if (uid) await clearListUserSyncError(listId, uid)
  await clearListSyncErrorMessages([listId])
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
    /**
     * Net-zero / ordering: detect a co-located `create` without loading all same-key rows.
     * When `enqueueSyncQueueRecord` is awaited inside an outer `db.transaction` (e.g. list soft-delete),
     * these `sync_queue` operations stay in that transaction — including `deleteOutboundQueueRowsTouchingList`
     * for list deletes (full prune + IMS removal for that list) immediately before inserting the delete row.
     */
    if (input.entity === 'list' && (await listHasOnlyLocalCreationIntent(input.entity_id))) {
      await deleteOutboundQueueRowsTouchingList(input.entity_id)
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

    const hasPendingCreateSameKey =
      (await db.sync_queue
        .where('[entity+entity_id]')
        .equals([input.entity, input.entity_id])
        .filter((r) => r.kind === 'create')
        .count()) > 0

    if (hasPendingCreateSameKey) {
      /* Net-zero: entity never reached the server — remove same-key rows + dependent IMS; no delete row. */
      await db.sync_queue.where('[entity+entity_id]').equals([input.entity, input.entity_id]).delete()
      if (input.entity === 'item') {
        await deleteOutboundImsRowsForItemId(input.entity_id)
      } else if (input.entity === 'member') {
        await deleteOutboundImsRowsForMemberId(input.entity_id)
      } else if (input.entity === 'list') {
        await deleteOutboundQueueRowsTouchingList(input.entity_id)
      }
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

    if (input.entity === 'list') {
      await deleteOutboundQueueRowsTouchingList(input.entity_id)
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
        processing_detail: null,
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

    await db.sync_queue.where('[entity+entity_id]').equals([input.entity, input.entity_id]).delete()

    if (input.entity === 'item') {
      await deleteOutboundImsRowsForItemId(input.entity_id)
    } else if (input.entity === 'member') {
      await deleteOutboundImsRowsForMemberId(input.entity_id)
    }

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
      processing_detail: null,
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
    /** Merge only before send; in-flight (`processing`) rows must finish before a new patch row runs. */
    const mergeableStatuses: readonly SyncQueueStatus[] = ['queued', 'failed']
    const matches = await db.sync_queue
      .where('[entity+entity_id]')
      .equals([input.entity, input.entity_id])
      .filter((r) => r.kind === 'patch' && mergeableStatuses.includes(r.status))
      .toArray()
    const existing =
      matches.length === 0 ? undefined : matches.reduce((a, b) => (a.updated_at >= b.updated_at ? a : b))
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
        processing_detail: null,
      })
      await clearListUserSyncErrorsForEnqueueRow({
        parent1_type: input.parent1_type ?? existing.parent1_type,
        parent1_id: input.parent1_id ?? existing.parent1_id,
        kind: 'patch',
        entity: input.entity,
        entity_id: input.entity_id,
        payload: mergedPayload,
        status: existing.status,
      })
      bumpListReconcileGenerationsForEnqueue({
        parent1_type: input.parent1_type ?? existing.parent1_type,
        parent1_id: input.parent1_id ?? existing.parent1_id,
        entity: input.entity,
        entity_id: input.entity_id,
        kind: 'patch',
        payload: mergedPayload as Record<string, unknown>,
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
    processing_detail: null,
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
  bumpListReconcileGenerationsForEnqueue({
    parent1_type: input.parent1_type,
    parent1_id: input.parent1_id,
    entity: input.entity,
    entity_id: input.entity_id,
    kind: input.kind,
    payload: input.payload as Record<string, unknown>,
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
      case 'bulkAddStates':
        return 'Copying members and shopping progress…'
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
      case 'seedItemMemberStateForMember':
        return 'Saving item progress for new member…'
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
        processing_detail: null,
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
        processing_detail: null,
      })
    }
  })
}
