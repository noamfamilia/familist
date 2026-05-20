/**
 * Lets AuthProvider call Connectivity's enterOffline when profile fetch exceeds the startup timeout
 * and no other server round-trip completed since activation, without importing React context.
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
