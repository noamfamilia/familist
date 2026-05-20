import { getConnectivityStatusForReads, isServerSessionActive } from '@/lib/data/serverReadPolicy'

export type SessionMode = 'guest' | 'authenticated'

let sessionModeGetter: (() => SessionMode) | null = null

/** Registered from AuthProvider so non-React modules can gate reads/sync. */
export function registerSessionModeGetter(fn: (() => SessionMode) | null): void {
  sessionModeGetter = fn
}

export function getSessionMode(): SessionMode {
  return sessionModeGetter?.() ?? 'authenticated'
}

export function isAuthenticatedSession(): boolean {
  return getSessionMode() === 'authenticated'
}

export function canOutboundSyncNow(): boolean {
  return (
    isAuthenticatedSession() &&
    isServerSessionActive() &&
    getConnectivityStatusForReads() === 'online'
  )
}

/** Shown when a signed-out guest attempts join/share or other account-only server actions. */
export const GUEST_JOIN_SHARE_BLOCKED_MSG =
  "Guests can't join or share lists. Sign in or sign up to continue."
