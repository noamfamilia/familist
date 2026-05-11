'use client'

import { memo } from 'react'

const shellBase =
  'pointer-events-none absolute end-1.5 top-1.5 z-20 flex h-5 w-5 items-center justify-center'

/** List card: show only a persistent sync error indicator (outbound failures). */
export const ListSyncStatusIcon = memo(function ListSyncStatusIcon({
  pendingItems,
  syncError,
}: {
  pendingItems: number
  syncError: boolean
}) {
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

  return null
})
