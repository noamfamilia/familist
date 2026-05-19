import { isLikelyConnectivityError } from '@/lib/connectivityErrors'
import type { DbSyncQueueRow } from '@/lib/db'
import {
  blockedOutboundDependencyReason,
  isOutboundRowBlockedByEarlierQueueWork,
  isOutboundRowPending,
  isOutboundRowRetryTimerActive,
} from '@/lib/data/syncQueueListScope'

export type OutboundQueueStatusContext = {
  now?: number
  connectivityStatus?: 'online' | 'recovering' | 'offline'
}

function truncate(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function resolveWaitingMessage(
  row: DbSyncQueueRow,
  queue: readonly DbSyncQueueRow[],
  ctx: OutboundQueueStatusContext,
  now: number,
): string {
  const dependencyReason = blockedOutboundDependencyReason(row, queue)
  if (dependencyReason) return dependencyReason

  const connectivityOffline = ctx.connectivityStatus === 'offline'
  const connectivityRecovering = ctx.connectivityStatus === 'recovering'
  const retryTimerActive = isOutboundRowRetryTimerActive(row, now)
  const lastErrorConnectivity = Boolean(row.last_error && isLikelyConnectivityError(row.last_error))
  const detail = row.processing_detail?.trim()

  if (connectivityOffline && isOutboundRowPending(row)) {
    return 'Waiting for internet connection.'
  }

  if (connectivityRecovering && row.status === 'queued' && !retryTimerActive) {
    return 'Checking connection before sending.'
  }

  if (lastErrorConnectivity) {
    if (retryTimerActive) return 'Waiting for connection — will retry when the network is back.'
    if (row.status === 'failed') return 'Waiting for connection after a network error.'
  }

  if (retryTimerActive) {
    if (detail && detail.length > 0) return detail
    if (row.status === 'failed') return 'Waiting to retry after a server error.'
    return 'Pausing briefly before the next sync attempt.'
  }

  if (detail && detail.length > 0) return detail

  if (row.status === 'failed') return 'Waiting to retry after a server error.'

  if (isOutboundRowBlockedByEarlierQueueWork(row, queue, now)) {
    return 'Waiting for earlier items in the queue to sync first.'
  }

  return 'Waiting to send.'
}

export type OutboundQueueStatusTone = 'success' | 'failure' | 'neutral'

/** Short status word for pending-queue row styling (Completed / Failed / …). */
export function outboundQueueRowStatusLabel(row: DbSyncQueueRow): {
  label: string
  tone: OutboundQueueStatusTone
} {
  switch (row.status) {
    case 'completed':
      return { label: 'Completed', tone: 'success' }
    case 'failed':
      return { label: 'Failed', tone: 'failure' }
    case 'processing':
      return { label: 'Processing', tone: 'neutral' }
    case 'queued':
      return { label: 'Queued', tone: 'neutral' }
    default:
      return { label: row.status, tone: 'neutral' }
  }
}

/** Gray tail after status + time (waiting detail, attempts, errors). */
export function outboundQueueRowDetailTail(
  row: DbSyncQueueRow,
  queue: readonly DbSyncQueueRow[],
  ctx: OutboundQueueStatusContext = {},
): string {
  const now = ctx.now ?? Date.now()

  if (row.status === 'failed') {
    const parts: string[] = []
    const err = row.last_error?.trim()
    if (err) parts.push(err)
    if (row.attempt_count > 0) {
      parts.push(`${row.attempt_count} failed attempt${row.attempt_count === 1 ? '' : 's'}`)
    }
    const wait = resolveWaitingMessage(row, queue, ctx, now)
    if (wait && wait !== err) parts.push(wait)
    const nr = row.next_retry_at
    if (nr != null && nr > now) {
      parts.push(`Next try: ${new Date(nr).toLocaleString()}`)
    }
    return parts.join(' · ')
  }

  return outboundQueueRowStatusLine(row, queue, ctx)
}

/**
 * Human-readable status for a row in the Server queue modal (connectivity, dependencies, FIFO, retries).
 */
export function outboundQueueRowStatusLine(
  row: DbSyncQueueRow,
  queue: readonly DbSyncQueueRow[],
  ctx: OutboundQueueStatusContext = {},
): string {
  const now = ctx.now ?? Date.now()
  const parts: string[] = []

  if (row.status === 'completed') {
    return 'Completed'
  }

  if (row.status === 'processing') {
    const detail = row.processing_detail?.trim()
    parts.push(detail && detail.length > 0 ? detail : 'Sending this change to the server…')
  } else if (row.status === 'queued' || row.status === 'failed') {
    parts.push(resolveWaitingMessage(row, queue, ctx, now))
  } else {
    parts.push(row.status)
  }

  if (row.attempt_count > 0) {
    parts.push(`${row.attempt_count} failed attempt${row.attempt_count === 1 ? '' : 's'}`)
  }

  const lastErrorConnectivity = Boolean(row.last_error && isLikelyConnectivityError(row.last_error))
  if (row.last_error && !lastErrorConnectivity) {
    parts.push(`Last issue: ${truncate(row.last_error, 140)}`)
  }

  const nr = row.next_retry_at
  if (nr != null && nr > now) {
    parts.push(`Next try: ${new Date(nr).toLocaleString()}`)
  }

  return parts.join(' · ')
}
