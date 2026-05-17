import { db, type DbSyncQueueRow, type SyncQueueStatus } from '@/lib/db'
import { CATALOG_RPC_COALESCE_ENTITY } from '@/lib/data/outboundCatalogRpcCoalesce'

export const LABEL_CHANGES_SYNC_WAIT_MSG =
  'Please wait — syncing label changes to the server.'

/** Rows ingested before `label_pending` existed — still emit `updates` until rebased. */
export const LEGACY_LABEL_BASELINE = '\0legacy\0'

export type LabelPendingEntry = { baseline: string; target: string }
export type LabelPendingMap = Record<string, LabelPendingEntry>

export type LabelEdit = { listId: string; baseline: string; target: string }

export function normalizeCatalogLabel(label: string | null | undefined): string {
  return (label ?? '').trim()
}

export function bulkPatchListLabelsOutboxKey(userId: string): string {
  return `outbox:bulkPatchListLabels:${userId}`
}

export function formatLabelForHistory(label: string): string {
  const n = normalizeCatalogLabel(label)
  return n || 'no label'
}

export function buildUpdatesFromPending(
  pending: LabelPendingMap,
): Array<{ list_id: string; label: string }> {
  return Object.entries(pending)
    .filter(
      ([, e]) =>
        e.baseline === LEGACY_LABEL_BASELINE ||
        normalizeCatalogLabel(e.baseline) !== normalizeCatalogLabel(e.target),
    )
    .map(([list_id, e]) => ({ list_id, label: e.target }))
    .sort((a, b) => a.list_id.localeCompare(b.list_id))
}

export function mergeLabelPending(
  existing: LabelPendingMap | undefined,
  edits: readonly LabelEdit[],
): LabelPendingMap {
  const next: LabelPendingMap = { ...(existing ?? {}) }
  for (const { listId, baseline, target } of edits) {
    const b = normalizeCatalogLabel(baseline)
    const t = normalizeCatalogLabel(target)
    const prev = next[listId]
    if (!prev || prev.baseline === LEGACY_LABEL_BASELINE) {
      if (b === t) {
        delete next[listId]
      } else {
        next[listId] = { baseline: b, target: t }
      }
      continue
    }
    const mergedBaseline = prev.baseline
    if (t === normalizeCatalogLabel(mergedBaseline)) {
      delete next[listId]
    } else {
      next[listId] = { baseline: mergedBaseline, target: t }
    }
  }
  return next
}

export function pendingFromBulkLabelPayload(payload: Record<string, unknown>): LabelPendingMap {
  const raw = payload.label_pending
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as LabelPendingMap) }
  }
  const pending: LabelPendingMap = {}
  const updates = payload.updates
  if (!Array.isArray(updates)) return pending
  for (const u of updates) {
    if (!u || typeof u !== 'object') continue
    const list_id = typeof (u as { list_id?: unknown }).list_id === 'string'
      ? (u as { list_id: string }).list_id
      : ''
    if (!list_id) continue
    const label =
      typeof (u as { label?: unknown }).label === 'string'
        ? (u as { label: string }).label
        : ''
    const t = normalizeCatalogLabel(label)
    pending[list_id] = { baseline: LEGACY_LABEL_BASELINE, target: t }
  }
  return pending
}

export function buildBulkPatchListLabelsPayload(
  userId: string,
  pending: LabelPendingMap,
): Record<string, unknown> | null {
  const updates = buildUpdatesFromPending(pending)
  if (updates.length === 0) return null
  return {
    method: 'bulkPatchListLabels',
    user_id: userId,
    label_pending: pending,
    updates,
  }
}

export function resolveBulkLabelCoalesceTarget(
  payload: Record<string, unknown>,
): { entity: typeof CATALOG_RPC_COALESCE_ENTITY; entity_id: string } | null {
  if (String(payload.method ?? '') !== 'bulkPatchListLabels') return null
  const userId = String(payload.user_id ?? '')
  if (!userId) return null
  return {
    entity: CATALOG_RPC_COALESCE_ENTITY,
    entity_id: bulkPatchListLabelsOutboxKey(userId),
  }
}

export function bulkLabelPayloadMatchesScope(
  payload: Record<string, unknown>,
  entity_id: string,
): boolean {
  if (String(payload.method ?? '') !== 'bulkPatchListLabels') return false
  const userId = String(payload.user_id ?? '')
  return userId.length > 0 && bulkPatchListLabelsOutboxKey(userId) === entity_id
}

export function mergeBulkLabelPayload(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const userId = String(incoming.user_id ?? existing.user_id ?? '')
  const merged = mergeLabelPending(
    pendingFromBulkLabelPayload(existing),
    Object.entries(pendingFromBulkLabelPayload(incoming)).map(([listId, e]) => ({
      listId,
      baseline: e.baseline,
      target: e.target,
    })),
  )
  return buildBulkPatchListLabelsPayload(userId, merged) ?? { method: 'bulkPatchListLabels', user_id: userId, label_pending: {}, updates: [] }
}

export function formatNetLabelHistoryLines(
  pending: LabelPendingMap,
  listNameById: ReadonlyMap<string, string>,
  touchedListIds?: ReadonlySet<string>,
): string[] {
  const groups = new Map<string, { from: string; to: string; names: string[] }>()
  for (const [listId, entry] of Object.entries(pending)) {
    if (touchedListIds && !touchedListIds.has(listId)) continue
    if (
      entry.baseline !== LEGACY_LABEL_BASELINE &&
      normalizeCatalogLabel(entry.baseline) === normalizeCatalogLabel(entry.target)
    ) {
      continue
    }
    const from =
      entry.baseline === LEGACY_LABEL_BASELINE
        ? normalizeCatalogLabel(entry.target)
        : normalizeCatalogLabel(entry.baseline)
    const to = normalizeCatalogLabel(entry.target)
    const key = `${from}\0${to}`
    let group = groups.get(key)
    if (!group) {
      group = { from, to, names: [] }
      groups.set(key, group)
    }
    const name = listNameById.get(listId) ?? listId
    group.names.push(name)
  }
  const lines: string[] = []
  for (const group of groups.values()) {
    group.names.sort((a, b) => a.localeCompare(b))
    const fromDisp = formatLabelForHistory(group.from)
    const toDisp = formatLabelForHistory(group.to)
    const labelClause = `label ${fromDisp} changed to ${toDisp}`
    if (group.names.length === 1) {
      lines.push(`${group.names[0]}: ${labelClause}`)
    } else {
      lines.push(`lists ${group.names.join(', ')}: ${labelClause}`)
    }
  }
  return lines.sort((a, b) => a.localeCompare(b))
}

const MERGEABLE_STATUSES: readonly SyncQueueStatus[] = ['queued', 'failed']

function isBulkLabelRpcRow(row: DbSyncQueueRow, userId: string): boolean {
  if (row.kind !== 'rpc') return false
  const pl = row.payload as Record<string, unknown>
  return String(pl.method ?? '') === 'bulkPatchListLabels' && String(pl.user_id ?? '') === userId
}

function isLabelOnlyPatchListUserRow(row: DbSyncQueueRow, userId: string): boolean {
  if (row.kind !== 'rpc') return false
  const pl = row.payload as Record<string, unknown>
  if (String(pl.method ?? '') !== 'patchListUser') return false
  if (String(pl.user_id ?? '') !== userId) return false
  if (pl.label === undefined) return false
  const keys = Object.keys(pl).filter((k) => k !== 'method' && k !== 'id' && k !== 'user_id')
  const other = keys.filter(
    (k) => pl[k] !== undefined && k !== 'label',
  )
  return other.length === 0
}

export async function hasProcessingLabelOutbound(userId: string): Promise<boolean> {
  const rows = await db.sync_queue.where('status').equals('processing').toArray()
  for (const row of rows) {
    if (isBulkLabelRpcRow(row, userId)) return true
    if (isLabelOnlyPatchListUserRow(row, userId)) return true
  }
  return false
}

async function loadMergeableLabelPending(userId: string): Promise<LabelPendingMap> {
  let pending: LabelPendingMap = {}
  const key = bulkPatchListLabelsOutboxKey(userId)

  const primary = await db.sync_queue
    .where('[entity+entity_id]')
    .equals([CATALOG_RPC_COALESCE_ENTITY, key])
    .filter((r) => r.kind === 'rpc' && MERGEABLE_STATUSES.includes(r.status))
    .toArray()

  const legacyBulk = await db.sync_queue
    .filter(
      (r) =>
        r.kind === 'rpc' &&
        MERGEABLE_STATUSES.includes(r.status) &&
        r.entity_id.startsWith('batch:') &&
        isBulkLabelRpcRow(r, userId),
    )
    .toArray()

  const labelPatches = await db.sync_queue
    .filter(
      (r) =>
        r.kind === 'rpc' &&
        MERGEABLE_STATUSES.includes(r.status) &&
        isLabelOnlyPatchListUserRow(r, userId),
    )
    .toArray()

  const ordered = [...primary, ...legacyBulk, ...labelPatches].sort((a, b) => a.updated_at - b.updated_at)
  for (const row of ordered) {
    const pl = row.payload as Record<string, unknown>
    if (isBulkLabelRpcRow(row, userId)) {
      pending = mergeLabelPending(pending, editsFromPendingMap(pendingFromBulkLabelPayload(pl)))
    } else if (isLabelOnlyPatchListUserRow(row, userId)) {
      const listId = String(pl.id ?? '')
      const target = typeof pl.label === 'string' ? pl.label : ''
      if (listId) {
        pending = mergeLabelPending(pending, [
          { listId, baseline: LEGACY_LABEL_BASELINE, target },
        ])
      }
    }
  }
  return pending
}

function editsFromPendingMap(pending: LabelPendingMap): LabelEdit[] {
  return Object.entries(pending).map(([listId, e]) => ({
    listId,
    baseline: e.baseline,
    target: e.target,
  }))
}

export async function deleteSupersededLabelRows(userId: string, keepRowId?: string): Promise<void> {
  const rows = await db.sync_queue.filter((r) => r.kind === 'rpc').toArray()
  for (const row of rows) {
    if (keepRowId && row.id === keepRowId) continue
    if (isBulkLabelRpcRow(row, userId)) {
      await db.sync_queue.delete(row.id)
      continue
    }
    if (isLabelOnlyPatchListUserRow(row, userId)) {
      await db.sync_queue.delete(row.id)
    }
  }
}

async function stripLabelFromPatchListUserRows(userId: string): Promise<void> {
  const rows = await db.sync_queue.filter((r) => r.kind === 'rpc').toArray()
  for (const row of rows) {
    const pl = row.payload as Record<string, unknown>
    if (String(pl.method ?? '') !== 'patchListUser') continue
    if (String(pl.user_id ?? '') !== userId) continue
    if (pl.label === undefined) continue
    const { label: _label, ...rest } = pl
    const keys = Object.keys(rest).filter((k) => k !== 'method' && k !== 'id' && k !== 'user_id')
    const hasOther = keys.some((k) => rest[k] !== undefined)
    if (!hasOther) {
      await db.sync_queue.delete(row.id)
    } else {
      await db.sync_queue.update(row.id, { payload: { ...rest, method: 'patchListUser' } })
    }
  }
}

export type ApplyCoalescedLabelChangesResult =
  | { action: 'clear'; pending: LabelPendingMap; historyLines: string[] }
  | { action: 'enqueue'; payload: Record<string, unknown>; pending: LabelPendingMap; historyLines: string[] }

/**
 * Merge label edits into pending state and build one outbound `bulkPatchListLabels` payload.
 * Caller must `enqueueSyncQueueRecord` (or clear) inside the same Dexie transaction.
 */
export async function applyCoalescedLabelChanges(
  userId: string,
  edits: readonly LabelEdit[],
  listNameById: ReadonlyMap<string, string>,
): Promise<ApplyCoalescedLabelChangesResult> {
  if (await hasProcessingLabelOutbound(userId)) {
    throw new Error(LABEL_CHANGES_SYNC_WAIT_MSG)
  }

  const touched = new Set(edits.map((e) => e.listId))
  let pending = await loadMergeableLabelPending(userId)
  pending = mergeLabelPending(pending, edits)

  const payload = buildBulkPatchListLabelsPayload(userId, pending)
  const historyLines = formatNetLabelHistoryLines(pending, listNameById, touched)

  if (!payload) {
    return { action: 'clear', pending: {}, historyLines }
  }

  return { action: 'enqueue', payload, pending, historyLines }
}

/** Remove legacy/superseded label rows before inserting the coalesced row. */
export async function finalizeCoalescedLabelOutbound(
  userId: string,
  action: ApplyCoalescedLabelChangesResult['action'],
): Promise<void> {
  await deleteSupersededLabelRows(userId)
  await stripLabelFromPatchListUserRows(userId)
  if (action === 'clear') return
}
