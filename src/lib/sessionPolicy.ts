import { getConnectivityStatusForReads } from '@/lib/data/serverReadPolicy'

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
  return isAuthenticatedSession() && getConnectivityStatusForReads() === 'online'
}
