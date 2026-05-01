/**
 * Lets AuthProvider call Connectivity's enterOffline when profile fetch exceeds the startup timeout,
 * without importing React context (Auth wraps Connectivity).
 */

let enterOfflineOnProfileTimeout: (() => void) | null = null
let markOnlineAfterProfileRecovery: (() => void) | null = null
let offlineWasDueToProfileTimeout = false

export function registerProfileFetchOfflineHandler(fn: (() => void) | null): void {
  enterOfflineOnProfileTimeout = fn
}

export function registerProfileFetchRecoveryHandler(fn: (() => void) | null): void {
  markOnlineAfterProfileRecovery = fn
}

export function notifyProfileFetchTimedOut(): void {
  offlineWasDueToProfileTimeout = true
  enterOfflineOnProfileTimeout?.()
}

/** Call after profile rows load successfully so we can undo profile-timeout offline only. */
export function notifyProfileFetchSucceeded(): void {
  if (!offlineWasDueToProfileTimeout) return
  offlineWasDueToProfileTimeout = false
  markOnlineAfterProfileRecovery?.()
}
