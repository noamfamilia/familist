'use client'

import { memo } from 'react'

type SyncVisualState = 'pending' | 'synced' | 'error' | 'stale'

function listSyncVisualState(pendingItems: number, syncError: boolean): SyncVisualState {
  const pending = pendingItems > 0
  const err = syncError
  if (pending && !err) return 'pending'
  if (!pending && !err) return 'synced'
  if (pending && err) return 'error'
  return 'stale'
}

/** Per-list outbound sync: pending / synced / error / stale (no icon). Primitives so parent list row can memo-skip when unchanged. */
export const ListSyncStatusIcon = memo(function ListSyncStatusIcon({
  pendingItems,
  syncError,
}: {
  pendingItems: number
  syncError: boolean
}) {
  const state = listSyncVisualState(pendingItems, syncError)
  if (state === 'stale') return null

  const shell =
    'pointer-events-none absolute end-1.5 top-1.5 z-20 flex h-5 w-5 items-center justify-center'

  if (state === 'pending') {
    return (
      <span className={`${shell} text-cyan`} role="status" aria-label="Sync pending">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            d="M12 3v3m0 12v3M4.93 4.93l2.12 2.12m10 10l2.12 2.12M3 12h3m12 0h3M4.93 19.07l2.12-2.12m10-10l2.12-2.12"
          />
        </svg>
      </span>
    )
  }

  if (state === 'synced') {
    return (
      <span className={`${shell} text-teal`} role="status" aria-label="Synced">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    )
  }

  return (
    <span className={`${shell} text-red-500`} role="status" aria-label="Sync error">
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
})
