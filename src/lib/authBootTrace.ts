import { log } from '@/lib/startupPerfLog'
import type { AuthPhase, GuestEntryPath } from '@/lib/authBootStorage'
/** Mirrors SessionMode without importing sessionPolicy (avoids init cycles). */
export type AuthBootSessionMode = 'resolving' | 'authenticated' | 'guest'

export type AuthBootTracePayload = {
  event: string
  reason: string
  guestPath?: GuestEntryPath
  authPhaseBefore: AuthPhase
  authPhaseAfter: AuthPhase
  loadingBefore: boolean
  loadingAfter: boolean
  authenticatedEstablished: boolean
  initialSessionReceived: boolean
  initialSessionTimedOut: boolean
  initialSessionSettledNull: boolean
  sessionUserId: string | null
  getSessionUserId?: string | null
  getSessionErrorCode?: string | null
  hasUsableAuthBlob: boolean
  lastAuthUserId: string | null
  activeCacheUserBefore: string | null
  activeCacheUserAfter: string | null
  bootstrapUserIdBefore: string | null
  bootstrapUserIdAfter: string | null
  sessionMode: AuthBootSessionMode
  didEnterGuestMode: boolean
  didEnterAuthenticatedMode: boolean
  didClearActiveCacheUser: boolean
  hardRecoveryInProgress: boolean
  explicitSignOutInProgress: boolean
}

export function logAuthBootTrace(payload: AuthBootTracePayload): void {
  log.info('AUTH_BOOT_TRACE', payload.event, payload)
}
