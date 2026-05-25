/**
 * Authoritative session-scoped record of the FINAL outcome a sync_queue row reached when the
 * sync drain physically deleted it.
 *
 * Why this exists: the live Dexie row carries `status` and `last_error` from prior attempts.
 * `last_error` is NOT cleared when a subsequent attempt succeeds — the row is just deleted.
 * Any consumer that tries to infer "did this row finish successfully?" from the last snapshot
 * before deletion will wrongly label a row as a failure whenever an earlier attempt had set
 * `last_error` (e.g. a connectivity blip during an online recovery that later succeeded).
 *
 * The sync engine records the authoritative outcome here right before deleting the row, and
 * the queue-history UI consumes it when it observes the row disappear.
 */

export type QueueTerminalOutcome = 'success' | 'failure'

type Entry = {
  outcome: QueueTerminalOutcome
  recordedAt: number
}

const outcomesByRowId = new Map<string, Entry>()

/**
 * Avoid unbounded growth when nothing ever reads the outcome (e.g. queue modal never opened
 * in this session). Entries older than this are dropped on the next write/read.
 */
const ENTRY_TTL_MS = 10 * 60 * 1000

function prune(now: number): void {
  for (const [id, entry] of outcomesByRowId) {
    if (now - entry.recordedAt > ENTRY_TTL_MS) outcomesByRowId.delete(id)
  }
}

export function recordQueueRowTerminalOutcome(rowId: string, outcome: QueueTerminalOutcome): void {
  const now = Date.now()
  prune(now)
  outcomesByRowId.set(rowId, { outcome, recordedAt: now })
}

export function consumeQueueRowTerminalOutcome(rowId: string): QueueTerminalOutcome | null {
  const entry = outcomesByRowId.get(rowId)
  if (!entry) return null
  outcomesByRowId.delete(rowId)
  return entry.outcome
}
