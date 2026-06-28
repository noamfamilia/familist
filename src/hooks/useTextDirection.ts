'use client'

import { useAuth } from '@/providers/AuthProvider'
import { getCachedTextDirection } from '@/lib/cache'

export type TextDirection = 'ltr' | 'rtl'

/** Profile text direction for card layout; does not mutate document.dir. */
export function useTextDirection(): TextDirection {
  const { profile, activeActorId } = useAuth()
  const fromProfile = profile?.text_direction
  if (fromProfile === 'rtl' || fromProfile === 'ltr') return fromProfile
  const cached = activeActorId ? getCachedTextDirection(activeActorId) : null
  return cached ?? 'ltr'
}
