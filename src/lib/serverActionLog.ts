/**
 * Server round-trip recording for activation / session log (no diagnostics panel).
 */

import { markActivationServerResponse } from '@/lib/activationServerProgress'
import { recordServerSessionRoundTrip } from '@/lib/serverSessionLog'

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
  description: string
  ok: boolean
  durationMs: number
  respondsTo?: string
  failure?: unknown
}

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
}

export function formatQuotedListName(name: string | null | undefined, listId: string): string {
  const n = typeof name === 'string' ? name.trim() : ''
  if (n) return `"${truncateForLog(n, 48)}"`
  return listId.length >= 8 ? listId.slice(0, 8) : listId
}
