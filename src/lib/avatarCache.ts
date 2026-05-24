import type { User } from '@supabase/supabase-js'
import { resolveUserAvatarUrl } from '@/lib/authAvatar'
import { db } from '@/lib/db'

const META_PREFIX = 'avatar_cache_'
const MAX_BYTES = 256 * 1024

export type AvatarCacheEntry = {
  sourceUrl: string
  mimeType: string
  bytes: Uint8Array
  fetchedAt: number
}

export function avatarCacheMetaId(userId: string): string {
  return `${META_PREFIX}${userId}`
}

export function parseAvatarCacheEntry(value: unknown): AvatarCacheEntry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as AvatarCacheEntry
  if (typeof entry.sourceUrl !== 'string' || entry.sourceUrl.length === 0) return null
  if (typeof entry.mimeType !== 'string' || entry.mimeType.length === 0) return null
  if (!(entry.bytes instanceof Uint8Array) || entry.bytes.byteLength === 0) return null
  if (typeof entry.fetchedAt !== 'number') return null
  return entry
}

export async function readAvatarCacheEntry(userId: string): Promise<AvatarCacheEntry | null> {
  const row = await db.meta.get(avatarCacheMetaId(userId))
  return parseAvatarCacheEntry(row?.value)
}

async function writeAvatarCacheEntry(userId: string, entry: AvatarCacheEntry): Promise<void> {
  await db.meta.put({
    id: avatarCacheMetaId(userId),
    value: entry,
    updated_at: Date.now(),
  })
}

/** Best-effort fetch + Dexie persist for offline avatar display. */
export async function cacheUserAvatarIfNeeded(user: User): Promise<boolean> {
  const sourceUrl = resolveUserAvatarUrl(user)
  if (!sourceUrl) return false

  const existing = await readAvatarCacheEntry(user.id)
  if (existing?.sourceUrl === sourceUrl) return true

  try {
    const res = await fetch(sourceUrl, { referrerPolicy: 'no-referrer' })
    if (!res.ok) return false

    const buf = await res.arrayBuffer()
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return false

    const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg'
    await writeAvatarCacheEntry(user.id, {
      sourceUrl,
      mimeType,
      bytes: new Uint8Array(buf),
      fetchedAt: Date.now(),
    })
    return true
  } catch {
    return false
  }
}
