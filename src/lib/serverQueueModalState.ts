/**
 * Server queue modal: stable display indexes (session-scoped) and unified clear/copy reset.
 * Indexes reset on full page load (module init) and when the user clears both sections.
 */

import { db } from '@/lib/db'
import { clearServerSessionLog, resetServerActivityIndexCounter } from '@/lib/serverSessionLog'

let nextQueueDisplayIndex = 0

export function resetQueueDisplayIndexCounter(): void {
  nextQueueDisplayIndex = 0
}

/** Monotonic queue # for the modal; not reused until indexes are reset. */
export function allocateQueueDisplayIndex(): number {
  nextQueueDisplayIndex += 1
  return nextQueueDisplayIndex
}

/** Clear pending queue rows, server activity, and reset both section index counters. */
export async function clearServerQueueModalState(): Promise<void> {
  resetQueueDisplayIndexCounter()
  clearServerSessionLog()
  await db.sync_queue.clear()
}
