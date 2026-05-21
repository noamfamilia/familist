/**
 * Tracks whether any app server round-trip completed since the latest authenticated
 * activation (sign-in / session restore). Used so profile startup timeout does not
 * force offline when catalog or other reads already reached the server.
 */

import { appendConnectivityDebugLine } from '@/lib/connectivityDebugLog'

let activationEpoch = 0
let serverResponseSinceActivation = false

/** Start a new window when an authenticated session is activated. */
export function beginActivationServerProgressWindow(): void {
  activationEpoch += 1
  serverResponseSinceActivation = false
  appendConnectivityDebugLine(
    `[activation] begin window epoch=${activationEpoch} serverResponseSinceActivation=false`,
  )
}

export function hasActivationServerResponse(): boolean {
  return serverResponseSinceActivation
}

/** Call when any server round-trip completes during the current activation window. */
export function markActivationServerResponse(): void {
  if (activationEpoch === 0) return
  if (!serverResponseSinceActivation) {
    appendConnectivityDebugLine(
      `[activation] server response received epoch=${activationEpoch} (profile-timeout offline guard cleared)`,
    )
  }
  serverResponseSinceActivation = true
}
