import type { User } from '@supabase/supabase-js'
import type { Profile } from '@/lib/supabase/types'

export function resolveAuthDisplayName(user: User | null, profile: Profile | null): string {
  if (!user) return 'Guest'
  if (profile?.nickname?.trim()) return profile.nickname.trim()
  const meta = user.user_metadata as Record<string, unknown> | undefined
  if (typeof meta?.given_name === 'string' && meta.given_name.trim()) return meta.given_name.trim()
  if (typeof meta?.full_name === 'string' && meta.full_name.trim()) {
    return meta.full_name.trim().split(/\s+/)[0] ?? meta.full_name.trim()
  }
  if (typeof meta?.nickname === 'string' && meta.nickname.trim()) return meta.nickname.trim()
  if (user.email) {
    const local = user.email.split('@')[0]?.trim()
    if (local) return local
  }
  return 'User'
}
