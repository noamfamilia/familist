/**
 * Shared state between `useLists` (catalog mutations + fetchLists) and
 * `ListsCatalogRealtimeProvider` (persistent home-catalog Supabase realtime).
 */

export const catalogMutationVersionRef = { current: 0 }

/** Epoch ms until which catalog realtime flushes are deferred (mirrors local optimistic window). */
export const catalogSkipRealtimeUntilRef = { current: 0 }

export type ListsCatalogFetchHandler = (options?: { staleCheckVersion?: number | null }) => void | Promise<void>

let fetchHandler: ListsCatalogFetchHandler | null = null

export function registerListsCatalogFetchHandler(fn: ListsCatalogFetchHandler | null) {
  fetchHandler = fn
}

export function getListsCatalogFetchHandler(): ListsCatalogFetchHandler | null {
  return fetchHandler
}

export type ListsCatalogRealtimeScheduleFn = (delayMs: number, consumePending?: boolean) => void

let scheduleFlushImpl: ListsCatalogRealtimeScheduleFn | null = null

export function registerListsCatalogRealtimeSchedule(fn: ListsCatalogRealtimeScheduleFn | null) {
  scheduleFlushImpl = fn
}

/** Re-queue a debounced catalog+detail flush (e.g. after fetchLists stale-discard). */
export function requestListsCatalogRealtimeFlush(delayMs = 0, consumePending = false) {
  scheduleFlushImpl?.(delayMs, consumePending)
}

/**
 * Captured `catalogMutationVersionRef` when a debounced realtime flush is scheduled;
 * passed to `fetchLists({ staleCheckVersion })`. Cleared from `useLists` when that fetch finishes.
 */
export const catalogRealtimeScheduleCaptureVersionRef = { current: null as number | null }
