import type { DbSyncQueueRow } from '@/lib/db'
import {
  catalogSkipRealtimeUntilRef,
  requestListsCatalogRealtimeFlush,
} from '@/lib/data/listsCatalogRealtimeBridge'
import {
  isOutboundRowPending,
  listIdsTouchingOutboundRow,
} from '@/lib/data/syncQueueListScope'

/** Max time catalog realtime + mirror stay quiet while outbound rows remain pending. */
export const OUTBOUND_READ_QUIET_MAX_MS = 30_000

const listQuietStartedAtMs = new Map<string, number>()
let globalOutboundQuietStartedAtMs: number | null = null

/** List ids for which background reads should be deferred (mirror, realtime detail prefetch). */
export const outboundQuietListIdsRef = { current: new Set<string>() }

function isVirtualUserListKey(listId: string): boolean {
  return listId.startsWith('user:')
}

function collectListIdsWithPendingOutbound(queue: readonly DbSyncQueueRow[]): Set<string> {
  const ids = new Set<string>()
  for (const row of queue) {
    if (!isOutboundRowPending(row)) continue
    for (const listId of listIdsTouchingOutboundRow(row)) {
      if (!isVirtualUserListKey(listId)) ids.add(listId)
    }
  }
  return ids
}

function quietCapExpired(startedAtMs: number, now: number): boolean {
  return now - startedAtMs >= OUTBOUND_READ_QUIET_MAX_MS
}

/**
 * True when `listId` has pending outbound queue work and the per-list quiet cap has not expired.
 */
export function shouldDeferServerReadsForOutboundList(
  listId: string,
  queue: readonly DbSyncQueueRow[],
  now = Date.now(),
): boolean {
  if (isVirtualUserListKey(listId)) return false
  const pendingListIds = collectListIdsWithPendingOutbound(queue)
  if (!pendingListIds.has(listId)) return false

  const startedAt = listQuietStartedAtMs.get(listId) ?? now
  if (quietCapExpired(startedAt, now)) return false
  return true
}

/**
 * Recompute outbound-quiet list ids and extend the global catalog realtime skip window
 * while any outbound row is pending (up to {@link OUTBOUND_READ_QUIET_MAX_MS}).
 */
export function refreshOutboundReadQuietState(
  queue: readonly DbSyncQueueRow[],
  options?: { hadPendingOutbound?: boolean },
): { hasPendingOutbound: boolean; quietListIds: Set<string> } {
  const now = Date.now()
  const pendingListIds = collectListIdsWithPendingOutbound(queue)
  const hasPendingOutbound = pendingListIds.size > 0

  if (!hasPendingOutbound) {
    globalOutboundQuietStartedAtMs = null
    listQuietStartedAtMs.clear()
    outboundQuietListIdsRef.current = new Set()
  } else {
    if (globalOutboundQuietStartedAtMs == null) {
      globalOutboundQuietStartedAtMs = now
    }
    for (const listId of pendingListIds) {
      if (!listQuietStartedAtMs.has(listId)) {
        listQuietStartedAtMs.set(listId, now)
      }
    }
    for (const listId of [...listQuietStartedAtMs.keys()]) {
      if (!pendingListIds.has(listId)) listQuietStartedAtMs.delete(listId)
    }

    const quiet = new Set<string>()
    for (const listId of pendingListIds) {
      const startedAt = listQuietStartedAtMs.get(listId) ?? now
      if (!quietCapExpired(startedAt, now)) quiet.add(listId)
    }
    outboundQuietListIdsRef.current = quiet

    const globalStart = globalOutboundQuietStartedAtMs ?? now
    if (!quietCapExpired(globalStart, now)) {
      const capEnd = globalStart + OUTBOUND_READ_QUIET_MAX_MS
      catalogSkipRealtimeUntilRef.current = Math.max(catalogSkipRealtimeUntilRef.current, capEnd)
      const remainingSkipMs = catalogSkipRealtimeUntilRef.current - now
      if (remainingSkipMs > 0) {
        requestListsCatalogRealtimeFlush(remainingSkipMs, true)
      }
    }
  }

  const hadPending = options?.hadPendingOutbound === true
  if (hadPending && !hasPendingOutbound) {
    requestListsCatalogRealtimeFlush(0, true)
  }

  return { hasPendingOutbound, quietListIds: outboundQuietListIdsRef.current }
}
