import type { SyncQueueEntity } from '@/lib/db'

export type ListDetailRpcCoalesceMethod = 'reorderListItems'

export function reorderListItemsOutboxKey(listId: string): string {
  return `outbox:reorderListItems:${listId}`
}

export function resolveReorderListItemsCoalesceTarget(
  payload: Record<string, unknown>,
): { method: ListDetailRpcCoalesceMethod; entity: SyncQueueEntity; entity_id: string } | null {
  const method = String(payload.method ?? '')
  if (method !== 'reorderListItems') return null
  const listId = String(payload.list_id ?? '')
  if (!listId) return null
  return {
    method: 'reorderListItems',
    entity: 'list',
    entity_id: reorderListItemsOutboxKey(listId),
  }
}

export function reorderListItemsPayloadMatchesScope(
  payload: Record<string, unknown>,
  entity_id: string,
): boolean {
  if (String(payload.method ?? '') !== 'reorderListItems') return false
  const listId = String(payload.list_id ?? '')
  return listId.length > 0 && reorderListItemsOutboxKey(listId) === entity_id
}

export function mergeReorderListItemsPayload(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const item_ids = incoming.item_ids ?? existing.item_ids
  return { ...existing, ...incoming, method: 'reorderListItems', item_ids }
}
