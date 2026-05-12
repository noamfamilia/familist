/**
 * Coalesces redundant “we might be back online” signals (mount, visibility, window.online)
 * into a single outbound sync kick for `useSyncStore` (see `subscribeOutboundSyncKick`).
 */

const DEBOUNCE_MS = 120

let debounceTimer: ReturnType<typeof setTimeout> | number | null = null
const listeners = new Set<() => void>()

export function subscribeOutboundSyncKick(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function flushListeners(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      // Subscriber owns errors (Dexie / React); never break other listeners.
    }
  }
}

/**
 * Schedule a single debounced kick. Rapid calls (e.g. visibility + online) coalesce into one flush.
 */
export function scheduleOutboundSyncKick(_cause?: string): void {
  if (typeof window === 'undefined') return
  if (debounceTimer != null) {
    window.clearTimeout(debounceTimer)
    debounceTimer = null
  }
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null
    flushListeners()
  }, DEBOUNCE_MS)
}
