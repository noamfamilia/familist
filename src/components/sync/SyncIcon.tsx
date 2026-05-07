'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { WifiSlashIcon } from '@/components/ui/ConnectivityWifiIcons'
import { describeSyncQueueRow } from '@/lib/data/syncQueue'
import { useSyncStatus, type SyncVisualStatus } from '@/providers/SyncStatusProvider'
import { Button } from '@/components/ui/Button'

function statusAriaLabel(status: SyncVisualStatus): string {
  switch (status) {
    case 'OFFLINE':
      return 'Sync offline'
    case 'SYNCING':
      return 'Syncing changes to server'
    case 'ERROR':
      return 'Sync errors — open for details'
    case 'PENDING':
      return 'Changes waiting to sync — open for details'
    case 'SYNCED':
      return 'All changes synced'
    default:
      return 'Sync status'
  }
}

function statusTitle(status: SyncVisualStatus): string {
  switch (status) {
    case 'OFFLINE':
      return 'Offline — changes are saved on this device'
    case 'SYNCING':
      return 'Syncing…'
    case 'ERROR':
      return 'Some changes could not sync — tap for details'
    case 'PENDING':
      return 'Waiting to sync — tap for details'
    case 'SYNCED':
      return 'Synced'
    default:
      return 'Sync'
  }
}

function SyncGlyph({
  status,
  compact,
}: {
  status: SyncVisualStatus
  compact?: boolean
}) {
  const dim = compact ? 'h-6 w-6' : 'h-7 w-7 sm:h-8 sm:w-8'

  if (status === 'OFFLINE') {
    return (
      <span className={`inline-flex shrink-0 ${dim}`} aria-hidden>
        <WifiSlashIcon className={`${dim} text-amber-500 dark:text-amber-400 drop-shadow-[0_0_1px_rgba(0,0,0,0.35)]`} />
      </span>
    )
  }

  if (status === 'SYNCING') {
    return (
      <span className={`inline-flex shrink-0 items-center justify-center ${dim}`} aria-hidden>
        <span
          className={`rounded-full bg-blue-500 shadow-sm dark:bg-blue-400 ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4 sm:h-[18px] sm:w-[18px]'} animate-pulse`}
        />
      </span>
    )
  }

  if (status === 'ERROR') {
    return (
      <span className={`inline-flex shrink-0 items-center justify-center ${dim} text-red-600 dark:text-red-500`} aria-hidden>
        <svg className={dim} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    )
  }

  if (status === 'PENDING') {
    return (
      <span className={`inline-flex shrink-0 items-center justify-center ${dim} text-orange-500 dark:text-orange-400`} aria-hidden>
        <svg className={dim} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <circle cx="6" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="18" cy="12" r="2" />
        </svg>
      </span>
    )
  }

  return (
    <span className={`inline-flex shrink-0 items-center justify-center ${dim} text-green-600 dark:text-green-500`} aria-hidden>
      <svg className={dim} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'processing':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
    case 'failed':
      return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
    default:
      return 'bg-orange-100 text-orange-900 dark:bg-orange-900/30 dark:text-orange-100'
  }
}

export function SyncIcon({ compact, className }: { compact?: boolean; className?: string }) {
  const { queueRows, syncVisualStatus, hasFailed, retryFailedSync } = useSyncStatus()
  const [open, setOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const el = wrapRef.current
      if (el && !el.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const onRetry = useCallback(async () => {
    if (!hasFailed) return
    setRetrying(true)
    try {
      await retryFailedSync()
    } finally {
      setRetrying(false)
    }
  }, [hasFailed, retryFailedSync])

  const gap = compact ? 'gap-1' : 'gap-1.5'

  return (
    <div ref={wrapRef} className={`relative inline-flex shrink-0 ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center justify-center rounded-lg outline-none ring-offset-2 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-teal ${gap} ${
          compact ? 'p-0.5' : 'p-1'
        }`}
        aria-label={statusAriaLabel(syncVisualStatus)}
        aria-expanded={open}
        title={statusTitle(syncVisualStatus)}
      >
        <SyncGlyph status={syncVisualStatus} compact={compact} />
      </button>

      {open && (
        <div
          className="absolute left-0 z-[60] mt-1 w-[min(calc(100vw-2rem),22rem)] rounded-lg border border-gray-200 bg-white py-2 shadow-lg dark:border-neutral-600 dark:bg-neutral-900 dark:shadow-black/50 sm:w-80"
          role="dialog"
          aria-label="Outbound sync queue"
        >
          <div className="border-b border-gray-100 px-3 pb-2 dark:border-neutral-700">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Pending changes</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {queueRows.length === 0
                ? 'Nothing in the sync queue.'
                : `${queueRows.length} task${queueRows.length === 1 ? '' : 's'} on this device`}
            </p>
          </div>

          <ul className="max-h-64 overflow-y-auto px-2 py-1 text-sm">
            {queueRows.length === 0 ? (
              <li className="px-2 py-3 text-center text-gray-500 dark:text-gray-400">All clear.</li>
            ) : (
              queueRows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-0.5 rounded-md px-2 py-2 text-left hover:bg-gray-50 dark:hover:bg-neutral-800/80"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 text-gray-800 dark:text-gray-100">{describeSyncQueueRow(row)}</span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(row.status)}`}
                    >
                      {row.status}
                    </span>
                  </div>
                  {row.last_error ? (
                    <span className="text-xs text-red-600 dark:text-red-400 break-words">{row.last_error}</span>
                  ) : null}
                </li>
              ))
            )}
          </ul>

          <div className="border-t border-gray-100 px-3 pt-2 dark:border-neutral-700">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full"
              disabled={!hasFailed || retrying}
              loading={retrying}
              onClick={() => void onRetry()}
            >
              Retry now
            </Button>
            {!hasFailed ? (
              <p className="mt-1 text-center text-[11px] text-gray-400 dark:text-gray-500">No failed tasks to reset.</p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
