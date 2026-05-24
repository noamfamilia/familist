'use client'

import { useEffect, useLayoutEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { User } from '@supabase/supabase-js'
import { resolveUserAvatarUrl } from '@/lib/authAvatar'
import { avatarCacheMetaId, parseAvatarCacheEntry, readAvatarCacheEntry } from '@/lib/avatarCache'
import { getOrCreateAvatarBlobUrl } from '@/lib/avatarDisplaySession'
import { useAvatarDisplayStore } from '@/stores/avatarDisplayStore'
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

const DEFAULT_LIGHT = '/profile.png'
const DEFAULT_DARK = '/profile_dark_trans.png'

export function ProfileAvatar({
  user,
  guest = false,
  actorUserId = null,
  size = 32,
  className = '',
}: ProfileAvatarProps) {
  const cacheUserId = !guest ? user?.id ?? actorUserId ?? null : null
  const remoteUrl = !guest ? resolveUserAvatarUrl(user ?? null) : null

  const photoSrc = useAvatarDisplayStore((s) =>
    !guest && cacheUserId && s.activeUserId === cacheUserId && !s.useFallback ? s.photoSrc : null,
  )
  const applyPhotoSrc = useAvatarDisplayStore((s) => s.applyPhotoSrc)
  const beginSession = useAvatarDisplayStore((s) => s.beginSession)
  const setUseFallback = useAvatarDisplayStore((s) => s.setUseFallback)

  useEffect(() => {
    if (guest || !cacheUserId) return
    beginSession(cacheUserId, remoteUrl)
  }, [beginSession, cacheUserId, guest, remoteUrl])

  /** `undefined` = liveQuery loading; `null` = no row; object = row. */
  const cacheRow = useLiveQuery(
    async () => {
      if (!cacheUserId) return null
      return (await db.meta.get(avatarCacheMetaId(cacheUserId))) ?? null
    },
    [cacheUserId, guest],
  )

  useLayoutEffect(() => {
    if (!cacheUserId || guest) return

    let cancelled = false
    void readAvatarCacheEntry(cacheUserId).then((entry) => {
      if (cancelled || !entry) return
      const url = getOrCreateAvatarBlobUrl(cacheUserId, entry)
      applyPhotoSrc(cacheUserId, url, entry.sourceUrl)
    })

    return () => {
      cancelled = true
    }
  }, [applyPhotoSrc, cacheUserId, guest])

  useEffect(() => {
    if (cacheRow === undefined || guest || !cacheUserId) return

    const entry = parseAvatarCacheEntry(cacheRow?.value)
    if (!entry) return

    const url = getOrCreateAvatarBlobUrl(cacheUserId, entry)
    applyPhotoSrc(cacheUserId, url, entry.sourceUrl)
  }, [applyPhotoSrc, cacheRow, cacheUserId, guest])

  const sizeClass = className.includes('w-') ? className : `w-8 h-8 ${className}`.trim()
  const photoShapeClass = guest ? '' : ' rounded-full object-cover ring-1 ring-black/5 dark:ring-white/10'
  const showPhoto = !guest && !!photoSrc

  return (
    <span className={`relative inline-block shrink-0 ${sizeClass}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={DEFAULT_LIGHT}
        alt=""
        width={size}
        height={size}
        className={`block h-full w-full dark:hidden${guest ? '' : photoShapeClass}`}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={DEFAULT_DARK}
        alt=""
        width={size}
        height={size}
        className={`hidden h-full w-full dark:block${guest ? '' : photoShapeClass}`}
      />
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoSrc}
          alt=""
          width={size}
          height={size}
          className={`absolute inset-0 h-full w-full${photoShapeClass}`}
          referrerPolicy="no-referrer"
          onError={() => {
            if (cacheUserId) setUseFallback(cacheUserId)
          }}
        />
      ) : null}
    </span>
  )
}
