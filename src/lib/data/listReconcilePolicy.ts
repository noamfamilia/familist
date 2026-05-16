/**
 * Per-list generation for list detail + `list_users` reads.
 * Bumped when outbound work or post-verify starts so in-flight `get_list_data` / prefs
 * responses do not overwrite newer local or queued intent.
 */

import type { DbSyncQueueRow } from '@/lib/db'
import { appendMutationDiagnostic } from '@/lib/offlineNavDiagnostics'
import { listIdsTouchingOutboundRow } from '@/lib/data/syncQueueListScope'

const listReconcileGeneration = new Map<string, number>()

export function captureListReconcileGeneration(listId: string): number {
  return listReconcileGeneration.get(listId) ?? 0
}

export function bumpListReconcileGeneration(listId: string, cause: string): number {
  const next = (listReconcileGeneration.get(listId) ?? 0) + 1
  listReconcileGeneration.set(listId, next)
  appendMutationDiagnostic(
    `[list-reconcile] bump listId=${listId} gen=${next} cause=${cause}`,
  )
  return next
}

export function shouldDiscardListReconcileResult(listId: string, capturedGeneration: number): boolean {
  return capturedGeneration !== captureListReconcileGeneration(listId)
}

export function bumpListReconcileGenerationsForOutboundRow(row: DbSyncQueueRow, cause: string): void {
  for (const listId of listIdsTouchingOutboundRow(row)) {
    if (listId.startsWith('user:')) continue
    bumpListReconcileGeneration(listId, cause)
  }
}

export function listIdsFromEnqueueShape(input: {
  parent1_type?: DbSyncQueueRow['parent1_type']
  parent1_id?: string | null
  entity: DbSyncQueueRow['entity']
  entity_id: string
  kind: DbSyncQueueRow['kind']
  payload: Record<string, unknown>
}): string[] {
  const row = {
    parent1_type: input.parent1_type ?? null,
    parent1_id: input.parent1_id ?? null,
    entity: input.entity,
    entity_id: input.entity_id,
    kind: input.kind,
    payload: input.payload,
  } as DbSyncQueueRow
  return listIdsTouchingOutboundRow(row)
}

export function bumpListReconcileGenerationsForEnqueue(input: {
  parent1_type?: DbSyncQueueRow['parent1_type']
  parent1_id?: string | null
  entity: DbSyncQueueRow['entity']
  entity_id: string
  kind: DbSyncQueueRow['kind']
  payload: Record<string, unknown>
}): void {
  for (const listId of listIdsFromEnqueueShape(input)) {
    if (listId.startsWith('user:')) continue
    bumpListReconcileGeneration(listId, 'outbound-enqueue')
  }
}
