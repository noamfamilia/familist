'use client'

import { useEffect, useRef, useState } from 'react'
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
  /** Account actor id for Dexie avatar cache before Supabase `user` is set (e.g. session restore). */
  actorUserId?: string | null
  size?: number
  className?: string
}

function avatarCacheEntryKey(entry: { sourceUrl: string; fetchedAt: number }): string {
  return `${entry.sourceUrl}|${entry.fetchedAt}`
}

export function ProfileAvatar({
  user,
  guest = false,
  actorUserId = null,
  size = 32,
  className = '',
}: ProfileAvatarProps) {
  const [useFallback, setUseFallback] = useState(false)
  const [blobDisplayUrl, setBlobDisplayUrl] = useState<string | null>(null)
  const blobKeyRef = useRef<string | null>(null)
  const blobUrlRef = useRef<string | null>(null)
  const remoteUrl = !guest ? resolveUserAvatarUrl(user ?? null) : null
  const cacheUserId = !guest ? user?.id ?? actorUserId ?? null : null

  const cacheRow = useLiveQuery(
    async () => (cacheUserId ? db.meta.get(avatarCacheMetaId(cacheUserId)) : undefined),
    [cacheUserId, guest],
  )

  useEffect(() => {
    setUseFallback(false)
  }, [cacheUserId, remoteUrl])

  useEffect(() => {
    const entry = parseAvatarCacheEntry(cacheRow?.value)
    if (!entry) {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
        blobKeyRef.current = null
      }
      setBlobDisplayUrl(null)
      return
    }

    const key = avatarCacheEntryKey(entry)
    if (blobKeyRef.current === key && blobUrlRef.current) {
      setBlobDisplayUrl(blobUrlRef.current)
      return
    }

    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
    }

    const blob = new Blob([entry.bytes], { type: entry.mimeType })
    const objectUrl = URL.createObjectURL(blob)
    blobKeyRef.current = key
    blobUrlRef.current = objectUrl
    setBlobDisplayUrl(objectUrl)
  }, [cacheRow])

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
        blobKeyRef.current = null
      }
    }
  }, [])

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
