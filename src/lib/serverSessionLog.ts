/**
 * In-memory server I/O log for the Server queue modal (not persisted).
 * Cleared only via the modal Clear control; not reset on navigation or refresh by app code.
 */

import type { ServerRoundTripInput } from '@/lib/serverActionLog'

export type ServerSessionEntry = {
  /** 1-based index in the Server activity section (stable until cleared or refresh). */
  index: number
  ts: number
  description: string
  ok: boolean
  durationMs: number
  respondsTo?: string
}

const SESSION_CAP = 200
const entries: ServerSessionEntry[] = []
const listeners = new Set<() => void>()
let nextActivityIndex = 0

export function resetServerActivityIndexCounter(): void {
  nextActivityIndex = 0
}

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
  nextActivityIndex += 1
  entries.push({
    index: nextActivityIndex,
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

export function clearServerSessionLog(): void {
  entries.length = 0
  resetServerActivityIndexCounter()
  notify()
}
