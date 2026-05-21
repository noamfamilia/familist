import type { User } from '@supabase/supabase-js'
import type { Profile } from '@/lib/supabase/types'
import { createClient } from '@/lib/supabase/client'
import { enqueueProfilePatch } from '@/lib/data/profileOutboundQueue'

export const GOOGLE_NICKNAME_INITIALIZED_KEY = 'google_nickname_initialized'

export function userHasGoogleIdentity(user: User): boolean {
  return (user.identities ?? []).some((identity) => identity.provider === 'google')
}

export function hasGoogleNicknameBeenApplied(user: User): boolean {
  const meta = user.user_metadata as Record<string, unknown> | undefined
  return meta?.[GOOGLE_NICKNAME_INITIALIZED_KEY] === true
}

/** True when the stored profile nickname is empty or the default guest placeholder. */
export function isProfileNicknameUnset(nickname: string | null | undefined): boolean {
  const trimmed = nickname?.trim() ?? ''
  if (!trimmed) return true
  return trimmed.toLowerCase() === 'guest'
}

export function deriveSuggestedGoogleNickname(user: User): string | null {
  const meta = user.user_metadata as Record<string, unknown> | undefined
  if (!meta) return null

  if (typeof meta.given_name === 'string' && meta.given_name.trim()) {
    return meta.given_name.trim()
  }

  const fullOrName =
    typeof meta.full_name === 'string'
      ? meta.full_name
      : typeof meta.name === 'string'
        ? meta.name
        : ''
  const trimmed = fullOrName.trim()
  if (!trimmed) return null

  const first = trimmed.split(/\s+/)[0]?.trim()
  return first || null
}

/**
 * Sets profile nickname from Google metadata once, when nickname is unset/default.
 * Returns an updated profile row for local state, or null if nothing changed.
 */
export async function applyGoogleNicknameIfNeeded(
  user: User,
  profile: Profile,
): Promise<{ profile: Profile; user: User } | null> {
  if (hasGoogleNicknameBeenApplied(user)) return null
  if (!isProfileNicknameUnset(profile.nickname)) return null

  const suggested = deriveSuggestedGoogleNickname(user)
  if (!suggested) return null

  try {
    await enqueueProfilePatch(user.id, { nickname: suggested })
  } catch {
    return null
  }

  const supabase = createClient()
  const priorMeta =
    user.user_metadata && typeof user.user_metadata === 'object'
      ? (user.user_metadata as Record<string, unknown>)
      : {}
  const { data, error } = await supabase.auth.updateUser({
    data: { ...priorMeta, [GOOGLE_NICKNAME_INITIALIZED_KEY]: true },
  })
  if (error) return null

  const nextUser = data.user ?? user
  return {
    profile: { ...profile, nickname: suggested },
    user: nextUser,
  }
}
