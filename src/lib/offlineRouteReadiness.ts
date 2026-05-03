import { getActiveCacheUserId } from '@/lib/cache'

const KEY_VERIFIED_PREFIX = 'normal_offline_route_ready_v1'
const KEY_LAST_PREFIX = 'normal_offline_route_last_v1'

export function getClientBuildId(): string {
  return process.env.NEXT_PUBLIC_BUILD_ID || 'unknown'
}

/** Marker is only written when build id is non-empty and not the sentinel `unknown`. */
export function isClientBuildIdKnown(): boolean {
  const id = getClientBuildId()
  return id.length > 0 && id !== 'unknown'
}

function resolveUserId(userId?: string): string | null {
  return userId || getActiveCacheUserId()
}

function verifiedKey(userId: string, listId: string, buildId: string): string {
  return `${KEY_VERIFIED_PREFIX}_${userId}_${listId}_${buildId}`
}

function lastKey(userId: string, listId: string): string {
  return `${KEY_LAST_PREFIX}_${userId}_${listId}`
}

export type LastOfflineRouteMarker = { buildId: string; verifiedAt: number }

/**
 * Persist proof that this user opened `/list/[id]` on this build with full ListPage + data + SW shell.
 * Scoped by userId, listId, and current NEXT_PUBLIC_BUILD_ID.
 */
export function setNormalOfflineRouteReadyMarker(userId: string, listId: string): void {
  if (typeof window === 'undefined') return
  if (!isClientBuildIdKnown()) return
  const buildId = getClientBuildId()
  const now = Date.now()
  try {
    localStorage.setItem(verifiedKey(userId, listId, buildId), String(now))
    const payload: LastOfflineRouteMarker = { buildId, verifiedAt: now }
    localStorage.setItem(lastKey(userId, listId), JSON.stringify(payload))
  } catch {
    // ignore
  }
}

/** True when a marker exists for (scoped user, listId, current build). */
export function normalOfflineRouteReady(listId: string, userId?: string): boolean {
  const uid = resolveUserId(userId)
  if (!uid || typeof window === 'undefined') return false
  if (!isClientBuildIdKnown()) return false
  const buildId = getClientBuildId()
  try {
    const v = localStorage.getItem(verifiedKey(uid, listId, buildId))
    return v != null && v !== ''
  } catch {
    return false
  }
}

/** Last successful verification (any build), for diagnostics when current build has no marker. */
export function getLastOfflineRouteMarkerRecord(listId: string, userId?: string): LastOfflineRouteMarker | null {
  const uid = resolveUserId(userId)
  if (!uid || typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(lastKey(uid, listId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'buildId' in parsed &&
      'verifiedAt' in parsed &&
      typeof (parsed as { buildId: unknown }).buildId === 'string' &&
      typeof (parsed as { verifiedAt: unknown }).verifiedAt === 'number'
    ) {
      return { buildId: (parsed as LastOfflineRouteMarker).buildId, verifiedAt: (parsed as LastOfflineRouteMarker).verifiedAt }
    }
    return null
  } catch {
    return null
  }
}
