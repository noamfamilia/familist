import type { DbSyncQueueRow } from '@/lib/db'
import { isOutboundRowPending } from '@/lib/data/syncQueueListScope'

/** Member ids from pending creates/patches and `bulkAddStates` RPC payloads for merge gating. */
export function collectPendingMemberIdsForList(
  pendingMutations: readonly DbSyncQueueRow[],
): Set<string> {
  const pendingMemberIds = new Set<string>()
  for (const m of pendingMutations) {
    if (!isOutboundRowPending(m)) continue
    if (m.entity === 'member' && m.kind === 'create') {
      const id = String((m.payload as { id?: string }).id ?? m.entity_id)
      if (id) pendingMemberIds.add(id)
      continue
    }
    if (m.entity === 'member' && m.kind === 'patch') {
      const memberId = String((m.payload as { memberId?: string }).memberId ?? m.entity_id ?? '')
      if (memberId) pendingMemberIds.add(memberId)
      continue
    }
    if (m.kind === 'rpc') {
      const p = m.payload as {
        method?: string
        members?: Array<{ id?: string }>
      }
      if (p.method === 'bulkAddStates' && Array.isArray(p.members)) {
        for (const mem of p.members) {
          if (mem?.id) pendingMemberIds.add(mem.id)
        }
      }
    }
  }
  return pendingMemberIds
}
