import type { SyncQueueEntity } from '@/lib/db'

export type CatalogRpcCoalesceMethod = 'reorderListUsers' | 'patchListUser'

export function reorderListUsersOutboxKey(userId: string): string {
  return `outbox:reorderListUsers:${userId}`
}

export function patchListUserOutboxKey(listId: string, userId: string): string {
  return `outbox:patchListUser:${listId}:${userId}`
}

export const CATALOG_RPC_COALESCE_ENTITY: SyncQueueEntity = 'list_users'

export function catalogRpcMethod(payload: Record<string, unknown>): string {
  return String(payload.method ?? '')
}

export function resolveCatalogRpcCoalesceTarget(
  payload: Record<string, unknown>,
): { method: CatalogRpcCoalesceMethod; entity: SyncQueueEntity; entity_id: string } | null {
  const method = catalogRpcMethod(payload)
  if (method === 'reorderListUsers') {
    const userId = String(payload.user_id ?? '')
    if (!userId) return null
    return {
      method,
      entity: CATALOG_RPC_COALESCE_ENTITY,
      entity_id: reorderListUsersOutboxKey(userId),
    }
  }
  if (method === 'patchListUser') {
    const listId = String(payload.id ?? '')
    const userId = String(payload.user_id ?? '')
    if (!listId || !userId) return null
    return {
      method,
      entity: CATALOG_RPC_COALESCE_ENTITY,
      entity_id: patchListUserOutboxKey(listId, userId),
    }
  }
  return null
}

export function catalogRpcPayloadMatchesScope(
  payload: Record<string, unknown>,
  method: CatalogRpcCoalesceMethod,
  entity_id: string,
): boolean {
  if (catalogRpcMethod(payload) !== method) return false
  if (method === 'reorderListUsers') {
    const userId = String(payload.user_id ?? '')
    return userId.length > 0 && reorderListUsersOutboxKey(userId) === entity_id
  }
  const listId = String(payload.id ?? '')
  const userId = String(payload.user_id ?? '')
  return listId.length > 0 && userId.length > 0 && patchListUserOutboxKey(listId, userId) === entity_id
}

export function mergeCatalogRpcPayload(
  method: CatalogRpcCoalesceMethod,
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  if (method === 'reorderListUsers') {
    const list_ids = incoming.list_ids ?? existing.list_ids
    return { ...existing, ...incoming, method, list_ids }
  }
  return { ...existing, ...incoming, method: 'patchListUser' }
}
