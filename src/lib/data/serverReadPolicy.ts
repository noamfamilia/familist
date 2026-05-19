/**
 * App-data reads (catalog, list detail, profile) must not hit Supabase unless connectivity is `online`.
 * Offline / recovering: hydrate from Dexie + local cache only.
 *
 * In-flight reads started while online are invalidated when the app leaves `online` (generation bump).
 */

import { appendMutationDiagnostic } from '@/lib/offlineNavDiagnostics'

export type ConnectivityStatus = 'online' | 'offline' | 'recovering'

export function canFetchFromServer(status: ConnectivityStatus): boolean {
  return status === 'online'
}

let readStatusGetter: (() => ConnectivityStatus) | null = null

/** Registered from ConnectivityProvider so non-React modules can gate reads. */
export function registerConnectivityStatusForReads(fn: (() => ConnectivityStatus) | null): void {
  readStatusGetter = fn
}

export function getConnectivityStatusForReads(): ConnectivityStatus {
  return readStatusGetter?.() ?? 'online'
}

let serverReadsAllowedGetter: () => boolean = () => true

/** Registered from AuthProvider — false while in local guest mode. */
export function registerServerReadsAllowed(fn: (() => boolean) | null): void {
  serverReadsAllowedGetter = fn ?? (() => true)
}

export function canFetchFromServerNow(): boolean {
  return canFetchFromServer(getConnectivityStatusForReads()) && serverReadsAllowedGetter()
}

/** Bumped on offline / recovering so stale in-flight read results are not applied. */
let readDiscardGeneration = 0

export function bumpReadDiscardGeneration(cause: string): void {
  readDiscardGeneration += 1
  appendMutationDiagnostic(
    `[server-read] discard-generation bump gen=${readDiscardGeneration} cause=${cause}`,
  )
}

/** Capture at the start of a server read (while `online`). */
export function captureReadFlightGeneration(): number {
  return readDiscardGeneration
}

/**
 * True when this read flight is stale: app left `online` or a newer discard generation was issued.
 */
export function shouldDiscardReadFlightResult(capturedGeneration: number): boolean {
  if (!canFetchFromServerNow()) return true
  if (capturedGeneration !== readDiscardGeneration) return true
  return false
}
