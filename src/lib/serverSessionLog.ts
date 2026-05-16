/**
 * In-memory server I/O log for the current tab session (cleared on full page refresh).
 * Used by the Server queue modal; independent of the diagnostics panel flag.
 */

import type { ServerRoundTripInput } from '@/lib/serverActionLog'

export type ServerSessionEntry = {
  ts: number
  description: string
  ok: boolean
  durationMs: number
  respondsTo?: string
}

const SESSION_CAP = 200
const entries: ServerSessionEntry[] = []
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export function recordServerSessionRoundTrip(input: ServerRoundTripInput): void {
  entries.push({
    ts: Date.now(),
    description: input.description,
    ok: input.ok,
    durationMs: input.durationMs,
    respondsTo: input.respondsTo,
  })
  while (entries.length > SESSION_CAP) entries.shift()
  notify()
}

export function getServerSessionEntries(): readonly ServerSessionEntry[] {
  return entries
}

export function getServerSessionSummary(): { total: number; ok: number; fail: number } {
  let ok = 0
  let fail = 0
  for (const e of entries) {
    if (e.ok) ok += 1
    else fail += 1
  }
  return { total: entries.length, ok, fail }
}

export function subscribeServerSessionLog(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
