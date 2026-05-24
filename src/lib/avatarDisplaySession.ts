import type { AvatarCacheEntry } from '@/lib/avatarCache'

const HINT_KEY = 'avatar_display_hint_v1'

type AvatarDisplayHint = {
  userId: string
  sourceUrl: string
}

/** Sync read of last-known avatar URL (survives pull-to-refresh like list localStorage cache). */
export function readAvatarDisplayHint(userId: string | null | undefined): string | null {
  if (!userId || typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(HINT_KEY)
    if (!raw) return null
    const hint = JSON.parse(raw) as AvatarDisplayHint
    if (hint.userId !== userId || typeof hint.sourceUrl !== 'string') return null
    const trimmed = hint.sourceUrl.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

export function writeAvatarDisplayHint(userId: string, sourceUrl: string): void {
  if (typeof window === 'undefined') return
  const trimmed = sourceUrl.trim()
  if (!trimmed) return
  try {
    localStorage.setItem(HINT_KEY, JSON.stringify({ userId, sourceUrl: trimmed } satisfies AvatarDisplayHint))
  } catch {
    // private mode / quota
  }
}

export function clearAvatarDisplaySession(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(HINT_KEY)
  } catch {
    // ignore
  }
  revokeAllAvatarBlobUrls()
}

const blobUrlByUserSource = new Map<string, string>()

function blobCacheKey(userId: string, sourceUrl: string): string {
  return `${userId}|${sourceUrl}`
}

/** Reuse object URLs across ProfileAvatar remounts (pull-to-refresh, menu open). */
export function getOrCreateAvatarBlobUrl(userId: string, entry: AvatarCacheEntry): string {
  const key = blobCacheKey(userId, entry.sourceUrl)
  const existing = blobUrlByUserSource.get(key)
  if (existing) return existing

  const blob = new Blob([entry.bytes], { type: entry.mimeType })
  const url = URL.createObjectURL(blob)
  blobUrlByUserSource.set(key, url)
  return url
}

function revokeAllAvatarBlobUrls(): void {
  for (const url of blobUrlByUserSource.values()) {
    URL.revokeObjectURL(url)
  }
  blobUrlByUserSource.clear()
}
