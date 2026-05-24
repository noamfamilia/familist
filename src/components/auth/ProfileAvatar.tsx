'use client'

import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { User } from '@supabase/supabase-js'
import { ThemedImage } from '@/components/ui/ThemedImage'
import { resolveUserAvatarUrl } from '@/lib/authAvatar'
import { avatarCacheMetaId, parseAvatarCacheEntry } from '@/lib/avatarCache'
import { db } from '@/lib/db'

type ProfileAvatarProps = {
  user?: User | null
  /** When true, always use the default guest icon. */
  guest?: boolean
  size?: number
  className?: string
}

export function ProfileAvatar({ user, guest = false, size = 32, className = '' }: ProfileAvatarProps) {
  const [useFallback, setUseFallback] = useState(false)
  const [blobDisplayUrl, setBlobDisplayUrl] = useState<string | null>(null)
  const remoteUrl = !guest ? resolveUserAvatarUrl(user ?? null) : null
  const userId = user?.id ?? null

  const cacheRow = useLiveQuery(
    async () => (userId && !guest ? db.meta.get(avatarCacheMetaId(userId)) : undefined),
    [userId, guest],
  )

  useEffect(() => {
    setUseFallback(false)
  }, [userId, remoteUrl])

  useEffect(() => {
    const entry = parseAvatarCacheEntry(cacheRow?.value)
    if (!entry) {
      setBlobDisplayUrl(null)
      return
    }

    const blob = new Blob([entry.bytes], { type: entry.mimeType })
    const objectUrl = URL.createObjectURL(blob)
    setBlobDisplayUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [cacheRow])

  const imgSrc = blobDisplayUrl ?? remoteUrl
  const showGooglePhoto = !!imgSrc && !useFallback
  const sizeClass = className.includes('w-') ? className : `w-8 h-8 ${className}`.trim()

  if (showGooglePhoto) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imgSrc}
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
