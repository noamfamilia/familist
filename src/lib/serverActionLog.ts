/**
 * One-line console + diagnostics overlay entries for server round-trips (fetch/save).
 * Verbose UI/perf logs live in startupPerfLog; this is the compact server I/O trace.
 */

import { markActivationServerResponse } from '@/lib/activationServerProgress'
import { DIAGNOSTICS_DATA_COLLECTION_ENABLED } from '@/lib/diagnosticsFlags'
import { recordServerSessionRoundTrip } from '@/lib/serverSessionLog'
import { emitServerRoundTripLine } from '@/lib/startupPerfLog'

export function truncateForLog(s: string, max = 160): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function errorMessageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message?: unknown }).message
    return typeof m === 'string' ? m : String(m ?? '')
  }
  return String(err ?? '')
}

export type ServerRoundTripInput = {
  /** Past tense, user-facing: "Fetched list catalog", "Saved item update" */
  description: string
  ok: boolean
  durationMs: number
  /** What request or local action this response belongs to */
  respondsTo?: string
  failure?: unknown
}

/** `respondsTo` for outbound sync_queue completion lines (includes queue # and wall duration). */
export function formatSyncQueueRespondsTo(
  row: { kind: string; entity: string; display_index?: number },
  durationMs: number,
): string {
  const base = `Sync queue · ${row.kind}/${row.entity}`
  const queueIndex = row.display_index
  if (typeof queueIndex !== 'number' || queueIndex <= 0) return base
  const sec = Math.max(0, durationMs) / 1000
  const secLabel = sec < 1 ? sec.toFixed(2) : sec < 10 ? sec.toFixed(1) : String(Math.round(sec))
  return `${base} · duration from queue #${queueIndex} is ${secLabel}sec`
}

export function logServerRoundTrip(input: ServerRoundTripInput): void {
  markActivationServerResponse()
  recordServerSessionRoundTrip(input)
  if (!DIAGNOSTICS_DATA_COLLECTION_ENABLED) return
  const respond = input.respondsTo ? ` · ${truncateForLog(input.respondsTo, 120)}` : ''
  const fail =
    input.ok || !input.failure ? '' : ` · ${truncateForLog(errorMessageOf(input.failure), 200)}`
  const status = input.ok ? 'ok' : 'fail'
  const ms = Math.max(0, Math.round(input.durationMs))
  const line = `[server] ${status} ${ms}ms — ${truncateForLog(input.description, 200)}${respond}${fail}`
  emitServerRoundTripLine(line)
}

/** Wrap list name for logs; avoids empty strings. */
export function formatQuotedListName(name: string | null | undefined, listId: string): string {
  const n = typeof name === 'string' ? name.trim() : ''
  if (n) return `"${truncateForLog(n, 48)}"`
  return listId.length >= 8 ? listId.slice(0, 8) : listId
}
