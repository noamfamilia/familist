/**
 * Authoritative session-scoped record of sync_queue rows that reached a terminal outcome
 * (success or non-retryable failure) and were physically deleted from `db.sync_queue`.
 *
 * Two concerns this module solves:
 *
 *  1. **Outcome truth.** A row's `last_error` is NOT cleared when a subsequent attempt
 *     succeeds — the row is just deleted. Any consumer that infers "did this row finish
 *     successfully?" from the last live-query snapshot before deletion will wrongly label
 *     a row as a failure whenever an earlier attempt set `last_error` (e.g. a connectivity
 *     blip during online recovery that later succeeded). The sync engine writes the
 *     authoritative outcome here right before the delete.
 *
 *  2. **History survives UI mount lifecycle.** The "Queue history:" UI lives inside a modal
 *     that opens/closes and can be hidden by app backgrounding. If the UI itself watched the
 *     live query to detect disappearing rows, anything that completed while the section was
 *     unmounted would be lost. By recording full display-ready entries here from the sync
 *     drain, the history list survives section unmount/remount and only resets on a real
 *     page reload (module state lives in JS memory).
 */

import type { DbSyncQueueRow } from '@/lib/db'
import { describeOutboundSyncRow } from '@/lib/data/outboundSyncDescription'

export type QueueTerminalOutcome = 'success' | 'failure'

export type QueueHistoryRow = {
  id: string
  displayIndex: number
  description: string
  outcome: QueueTerminalOutcome
  statusLabel: string
  recordedAt: number
}

// --- Outcome dictionary (kept for the fallback heuristic in PendingQueueStatusSection) ---

type OutcomeEntry = { outcome: QueueTerminalOutcome; recordedAt: number }

const outcomesByRowId = new Map<string, OutcomeEntry>()
const ENTRY_TTL_MS = 10 * 60 * 1000

function pruneOutcomes(now: number): void {
  for (const [id, entry] of outcomesByRowId) {
    if (now - entry.recordedAt > ENTRY_TTL_MS) outcomesByRowId.delete(id)
  }
}

export function recordQueueRowTerminalOutcome(rowId: string, outcome: QueueTerminalOutcome): void {
  const now = Date.now()
  pruneOutcomes(now)
  outcomesByRowId.set(rowId, { outcome, recordedAt: now })
}

export function consumeQueueRowTerminalOutcome(rowId: string): QueueTerminalOutcome | null {
  const entry = outcomesByRowId.get(rowId)
  if (!entry) return null
  outcomesByRowId.delete(rowId)
  return entry.outcome
}

// --- History list (display-ready) ---

const historyRows: QueueHistoryRow[] = []
const historyById = new Map<string, QueueHistoryRow>()
const historyListeners = new Set<() => void>()
let nextDisplayIndex = 0

function emitHistoryChange(): void {
  for (const fn of historyListeners) fn()
}

export function getQueueHistoryRows(): QueueHistoryRow[] {
  return historyRows.slice()
}

export function subscribeQueueHistory(listener: () => void): () => void {
  historyListeners.add(listener)
  return () => {
    historyListeners.delete(listener)
  }
}

/**
 * Record a terminal queue row in history. Called by the sync engine immediately before
 * `db.sync_queue.delete(row.id)` on the success or terminal-failure path. Safe to call
 * concurrently with the live query: this store is independent and not Dexie-backed.
 *
 * Idempotent per row id — the first record wins, repeat calls are ignored.
 */
export async function recordQueueRowHistory(
  row: DbSyncQueueRow,
  outcome: QueueTerminalOutcome,
): Promise<void> {
  recordQueueRowTerminalOutcome(row.id, outcome)
  if (historyById.has(row.id)) return

  let description: string
  try {
    description = await describeOutboundSyncRow(row)
  } catch {
    description = `${row.kind} ${row.entity}`
  }

  const entry: QueueHistoryRow = {
    id: row.id,
    displayIndex: ++nextDisplayIndex,
    description,
    outcome,
    statusLabel: outcome === 'success' ? 'completed' : 'fail',
    recordedAt: Date.now(),
  }
  historyById.set(entry.id, entry)
  historyRows.push(entry)
  emitHistoryChange()
}

/**
 * Last-resort entry recorded by PendingQueueStatusSection when a row vanishes from the
 * live query without the sync drain claiming it (e.g. coalesce, scrub). Uses the display
 * snapshot the section already computed so the UI stays useful.
 */
export function recordQueueRowHistoryFromSnapshot(
  id: string,
  description: string,
  outcome: QueueTerminalOutcome,
): void {
  recordQueueRowTerminalOutcome(id, outcome)
  if (historyById.has(id)) return
  const entry: QueueHistoryRow = {
    id,
    displayIndex: ++nextDisplayIndex,
    description,
    outcome,
    statusLabel: outcome === 'success' ? 'completed' : 'fail',
    recordedAt: Date.now(),
  }
  historyById.set(id, entry)
  historyRows.push(entry)
  emitHistoryChange()
}
