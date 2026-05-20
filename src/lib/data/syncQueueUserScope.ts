import { db, type DbSyncQueueRow } from '@/lib/db'
import { isGuestId } from '@/lib/guestSession'
import { listIdsTouchingOutboundRow, isOutboundRowPending } from '@/lib/data/syncQueueListScope'
/** True when a queue row only applies to local guest mode (must not run after sign-in). */
export function syncQueueRowHasGuestScope(row: DbSyncQueueRow): boolean {
  const payloadUid = (row.payload as { user_id?: unknown })?.user_id
  if (typeof payloadUid === 'string' && isGuestId(payloadUid)) return true
  if (row.parent1_type === 'user' && isGuestId(row.parent1_id)) return true
  if (row.parent2_type === 'user' && isGuestId(row.parent2_id)) return true
  return false
}

/** Lists created in local guest mode (`lists.owner_id` is a guest id). */
export async function getGuestOwnedListIdSet(): Promise<Set<string>> {
  const ids = await db.lists.filter((l) => isGuestId(l.owner_id)).primaryKeys()
  return new Set(ids)
}

/** True when a queue row must never run after sign-in (guest user scope or guest-owned list). */
export function isGuestOutboundQueueRow(
  row: DbSyncQueueRow,
  guestOwnedListIds: ReadonlySet<string>,
): boolean {
  if (syncQueueRowHasGuestScope(row)) return true
  return listIdsTouchingOutboundRow(row).some((id) => guestOwnedListIds.has(id))
}

function rowExplicitlyScopedToUser(row: DbSyncQueueRow, userId: string): boolean {
  const pl = row.payload as { user_id?: unknown }
  if (pl.user_id === userId) return true
  if (row.parent1_type === 'user' && row.parent1_id === userId) return true
  if (row.parent2_type === 'user' && row.parent2_id === userId) return true
  if (row.entity === 'profile' && row.entity_id === userId) return true
  return false
}

/**
 * Pending outbound rows for the signed-in user only (excludes guest queue and other users' lists).
 */
export async function countPendingOutboundForUser(userId: string): Promise<number> {
  if (!userId || isGuestId(userId)) return 0

  const guestOwnedListIds = await getGuestOwnedListIdSet()
  const rows = await db.sync_queue.filter((r) => isOutboundRowPending(r)).toArray()
  if (rows.length === 0) return 0

  const listIds = new Set<string>()
  for (const row of rows) {
    if (isGuestOutboundQueueRow(row, guestOwnedListIds)) continue
    for (const id of listIdsTouchingOutboundRow(row)) listIds.add(id)
  }

  const ownerByListId = new Map<string, string | undefined>()
  if (listIds.size > 0) {
    const lists = await db.lists.bulkGet([...listIds])
    for (const list of lists) {
      if (list) ownerByListId.set(list.id, list.owner_id)
    }
  }

  let count = 0
  for (const row of rows) {
    if (isGuestOutboundQueueRow(row, guestOwnedListIds)) continue
    if (rowExplicitlyScopedToUser(row, userId)) {
      count++
      continue
    }
    const touched = listIdsTouchingOutboundRow(row)
    if (touched.length === 0) continue
    if (touched.every((id) => ownerByListId.get(id) === userId)) count++
  }
  return count
}
