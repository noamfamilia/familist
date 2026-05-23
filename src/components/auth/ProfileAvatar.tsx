'use client'

import { useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { ThemedImage } from '@/components/ui/ThemedImage'
import { resolveUserAvatarUrl } from '@/lib/authAvatar'

type ProfileAvatarProps = {
  user?: User | null
  /** When true, always use the default guest icon. */
  guest?: boolean
  size?: number
  className?: string
}

export function ProfileAvatar({ user, guest = false, size = 32, className = '' }: ProfileAvatarProps) {
  const [useFallback, setUseFallback] = useState(false)
  const avatarUrl = !guest ? resolveUserAvatarUrl(user ?? null) : null
  const showGooglePhoto = !!avatarUrl && !useFallback
  const sizeClass = className.includes('w-') ? className : `w-8 h-8 ${className}`.trim()

  if (showGooglePhoto) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        width={size}
        height={size}
        className={`${sizeClass} rounded-full object-cover ring-1 ring-black/5 dark:ring-white/10`}
        referrerPolicy="no-referrer"
        onError={() => setUseFallback(true)}
      />
    )
  }

  return (
    <ThemedImage
      src="/profile.png"
      alt=""
      width={size}
      height={size}
      className={`${sizeClass}${guest ? '' : ' rounded-full'}`}
    />
  )
}
