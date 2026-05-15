/**
 * Lets AuthProvider call Connectivity's enterOffline when profile fetch exceeds the startup timeout,
 * without importing React context (Auth wraps Connectivity).
 */

let enterOfflineOnProfileTimeout: (() => void) | null = null

export function registerProfileFetchOfflineHandler(fn: (() => void) | null): void {
  enterOfflineOnProfileTimeout = fn
}

export function notifyProfileFetchTimedOut(): void {
  enterOfflineOnProfileTimeout?.()
}

/** Profile fetch completed; does not change connectivity status (recovery uses /api/recovery-health). */
export function notifyProfileFetchSucceeded(): void {
  // Intentionally no-op for connectivity promotion.
}

/** Network op completed; does not change connectivity status. */
export function notifyNetworkOpSucceeded(_source: string): void {
  // Intentionally no-op for connectivity promotion.
}
