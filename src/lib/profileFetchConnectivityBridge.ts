/**
 * Lets AuthProvider call Connectivity's enterOffline when profile fetch exceeds the startup timeout,
 * without importing React context (Auth wraps Connectivity).
 */

let enterOfflineOnProfileTimeout: (() => void) | null = null
let markOnlineAfterProfileRecovery: ((source?: string) => void) | null = null
let offlineWasDueToProfileTimeout = false

export function registerProfileFetchOfflineHandler(fn: (() => void) | null): void {
  enterOfflineOnProfileTimeout = fn
}

export function registerProfileFetchRecoveryHandler(fn: ((source?: string) => void) | null): void {
  markOnlineAfterProfileRecovery = fn
}

export function notifyProfileFetchTimedOut(): void {
  offlineWasDueToProfileTimeout = true
  enterOfflineOnProfileTimeout?.()
}

/** Call after profile rows load successfully so we can undo profile-timeout offline only. */
export function notifyProfileFetchSucceeded(): void {
  if (offlineWasDueToProfileTimeout) {
    offlineWasDueToProfileTimeout = false
  }
  // Any successful profile fetch is a strong online signal.
  markOnlineAfterProfileRecovery?.('fetchProfile')
}

export function notifyNetworkOpSucceeded(source: string): void {
  offlineWasDueToProfileTimeout = false
  markOnlineAfterProfileRecovery?.(source)
}
