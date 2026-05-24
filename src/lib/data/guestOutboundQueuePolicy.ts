import { getActiveCacheUserId } from '@/lib/cache'
import type { DbSyncQueueRow } from '@/lib/db'
import { isGuestId } from '@/lib/guestSession'
import { getSessionMode } from '@/lib/sessionPolicy'
import { getGuestOwnedListIdSet, isGuestOutboundQueueRow } from '@/lib/data/syncQueueUserScope'

/**
 * Master switch for guest outbound `sync_queue` work (enqueue, drain, pending UI).
 * Set to `true` to re-enable guest list server sync / guest→user migration paths.
 */
export const GUEST_OUTBOUND_QUEUE_ENABLED = false

export function isGuestOutboundQueueEnabled(): boolean {
  return GUEST_OUTBOUND_QUEUE_ENABLED
}

/** True when guest-scoped outbound queue work should be ignored (default). */
export function isGuestOutboundQueueMuted(): boolean {
  return !GUEST_OUTBOUND_QUEUE_ENABLED
}

type EnqueueScopeInput = {
  parent1_type?: string
  parent1_id?: string
  parent2_type?: string | null
  parent2_id?: string | null
  payload?: Record<string, unknown>
}

export function enqueueInputHasGuestScope(input: EnqueueScopeInput): boolean {
  const payloadUid = input.payload?.user_id
  if (typeof payloadUid === 'string' && isGuestId(payloadUid)) return true

  const ownerId = input.payload?.owner_id
  if (typeof ownerId === 'string' && isGuestId(ownerId)) return true

  if (input.parent1_type === 'user' && isGuestId(input.parent1_id ?? '')) return true
  if (input.parent2_type === 'user' && isGuestId(input.parent2_id ?? '')) return true
  return false
}

/** Skip new outbound rows while guest mode is active or the actor is a guest id. */
export function shouldSkipOutboundEnqueueForInput(input: EnqueueScopeInput): boolean {
  if (GUEST_OUTBOUND_QUEUE_ENABLED) return false
  if (getSessionMode() === 'guest') return true
  if (enqueueInputHasGuestScope(input)) return true
  const actorId = getActiveCacheUserId()
  if (actorId && isGuestId(actorId)) return true
  return false
}

export function isGuestOutboundRowMuted(
  row: DbSyncQueueRow,
  guestOwnedListIds: ReadonlySet<string>,
): boolean {
  if (GUEST_OUTBOUND_QUEUE_ENABLED) return false
  return isGuestOutboundQueueRow(row, guestOwnedListIds)
}

/** Rows that participate in drain, pending counts, and queue UI for the active session. */
export async function filterActiveOutboundRows(
  rows: readonly DbSyncQueueRow[],
): Promise<DbSyncQueueRow[]> {
  if (GUEST_OUTBOUND_QUEUE_ENABLED) return [...rows]
  const guestOwnedListIds = await getGuestOwnedListIdSet()
  return rows.filter((row) => !isGuestOutboundQueueRow(row, guestOwnedListIds))
}
