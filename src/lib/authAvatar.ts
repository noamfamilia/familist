import type { User } from '@supabase/supabase-js'

function pickUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function resolveUserAvatarUrl(user: User | null | undefined): string | null {
  if (!user) return null

  const meta = user.user_metadata as Record<string, unknown> | undefined
  const fromMeta = pickUrl(meta?.picture) ?? pickUrl(meta?.avatar_url)
  if (fromMeta) return fromMeta

  const googleIdentity = user.identities?.find((identity) => identity.provider === 'google')
  const idData = googleIdentity?.identity_data as Record<string, unknown> | undefined
  return pickUrl(idData?.picture) ?? pickUrl(idData?.avatar_url)
}
