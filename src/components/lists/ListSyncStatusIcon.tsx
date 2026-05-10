'use client'

import { memo, useEffect, useState } from 'react'
import {
  RECENT_SUCCESS_FADE_MS,
  RECENT_SUCCESS_HOLD_MS,
  RECENT_SUCCESS_WINDOW_MS,
} from '@/stores/listsCatalogStore'

const shellBase =
  'pointer-events-none absolute end-1.5 top-1.5 z-20 flex h-5 w-5 items-center justify-center'
const shellGreen = `${shellBase} text-green-600 dark:text-green-500`
const shellCyan = `${shellBase} text-cyan`
const shellTeal = `${shellBase} text-teal-600 dark:text-teal-400`

/**
 * Catalog: outbound pending → cyan check; background realtime prefetch → cyan then teal hold+fade;
 * outbound success (Dexie L2) → green hold+fade.
 */
export const ListSyncStatusIcon = memo(function ListSyncStatusIcon({
  pendingItems,
  syncError,
  recentSuccessStartedAt,
  remoteDetailInflight = false,
  remotePulseStartedAt = 0,
}: {
  pendingItems: number
  syncError: boolean
  recentSuccessStartedAt: number
  remoteDetailInflight?: boolean
  remotePulseStartedAt?: number
}) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const tRecent = recentSuccessStartedAt > 0 ? recentSuccessStartedAt : 0
    const tRemote = remotePulseStartedAt > 0 ? remotePulseStartedAt : 0
    const anchor = Math.max(tRecent, tRemote)
    if (anchor <= 0) return
    const totalMs = Math.max(0, anchor + RECENT_SUCCESS_WINDOW_MS - Date.now()) + 100
    const id = window.setInterval(() => setTick((n) => n + 1), 100)
    const done = window.setTimeout(() => clearInterval(id), totalMs)
    return () => {
      clearInterval(id)
      clearTimeout(done)
    }
  }, [recentSuccessStartedAt, remotePulseStartedAt])

  if (syncError && pendingItems > 0) {
    return (
      <span className={`${shellBase} text-red-500 dark:text-red-400`} role="status" aria-label="Sync error">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M12 8v5M12 16h.01" />
        </svg>
      </span>
    )
  }

  if (pendingItems > 0) {
    return (
      <span className={shellCyan} role="status" aria-label="Sync pending">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
        </svg>
      </span>
    )
  }

  if (remoteDetailInflight) {
    return (
      <span className={shellCyan} role="status" aria-label="Updating list from server">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
        </svg>
      </span>
    )
  }

  if (remotePulseStartedAt > 0) {
    void tick
    const elapsed = Date.now() - remotePulseStartedAt
    if (elapsed >= RECENT_SUCCESS_WINDOW_MS) {
      return null
    }
    const opacity =
      elapsed <= RECENT_SUCCESS_HOLD_MS
        ? 1
        : Math.max(0, 1 - (elapsed - RECENT_SUCCESS_HOLD_MS) / RECENT_SUCCESS_FADE_MS)

    return (
      <span
        className={shellTeal}
        style={{ opacity }}
        role="status"
        aria-label="List updated from server"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
        </svg>
      </span>
    )
  }

  if (recentSuccessStartedAt > 0) {
    void tick
    const elapsed = Date.now() - recentSuccessStartedAt
    if (elapsed >= RECENT_SUCCESS_WINDOW_MS) {
      return null
    }
    const opacity =
      elapsed <= RECENT_SUCCESS_HOLD_MS
        ? 1
        : Math.max(0, 1 - (elapsed - RECENT_SUCCESS_HOLD_MS) / RECENT_SUCCESS_FADE_MS)

    return (
      <span
        className={shellGreen}
        style={{ opacity }}
        role="status"
        aria-label="Synced"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
        </svg>
      </span>
    )
  }

  return null
})
