'use client'

import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Modal } from '@/components/ui/Modal'
import { db, type DbSyncQueueRow } from '@/lib/db'
import { describeOutboundSyncRow } from '@/lib/data/outboundSyncDescription'
import { outboundQueueRowStatusLine } from '@/lib/data/outboundQueueStatus'
import { useServerSessionLog } from '@/hooks/useServerSessionLog'
import { useConnectivity } from '@/providers/ConnectivityProvider'

type RowDisplay = {
  id: string
  description: string
  statusLine: string
}

function formatSessionTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

export function ServerQueueModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { status: connectivityStatus } = useConnectivity()
  const { entries: serverSessionEntries, summary: serverSessionSummary } = useServerSessionLog()
  const rows = useLiveQuery(() => db.sync_queue.orderBy('updated_at').toArray(), [], []) ?? []
  const [displayRows, setDisplayRows] = useState<RowDisplay[]>([])

  useEffect(() => {
    let cancelled = false
    const now = Date.now()
    void (async () => {
      const next = await Promise.all(
        rows.map(async (r) => ({
          id: r.id,
          description: await describeOutboundSyncRow(r),
          statusLine: outboundQueueRowStatusLine(r, rows, { now, connectivityStatus }),
        })),
      )
      if (!cancelled) setDisplayRows(next)
    })()
    return () => {
      cancelled = true
    }
  }, [rows, connectivityStatus])

  const recentServerEntries = serverSessionEntries.slice(-12).reverse()

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Server queue" size="md">
      <section className="mb-4 rounded-lg border border-gray-200 bg-gray-50/80 p-3 dark:border-neutral-600 dark:bg-neutral-900/60">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Server activity this session
        </h3>
        <p className="mt-1 text-sm text-gray-800 dark:text-gray-200">
          {serverSessionSummary.total === 0 ? (
            <>No server requests since this page was opened or refreshed.</>
          ) : (
            <>
              <span className="font-medium">{serverSessionSummary.total}</span> request
              {serverSessionSummary.total === 1 ? '' : 's'} —{' '}
              <span className="text-teal">{serverSessionSummary.ok} ok</span>
              {serverSessionSummary.fail > 0 ? (
                <>
                  , <span className="text-red-500">{serverSessionSummary.fail} failed</span>
                </>
              ) : null}
            </>
          )}
        </p>
        {recentServerEntries.length > 0 ? (
          <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs text-gray-600 dark:text-gray-400">
            {recentServerEntries.map((e, i) => (
              <li key={`${e.ts}-${i}`} className="break-words">
                <span className="tabular-nums text-gray-400 dark:text-gray-500">{formatSessionTime(e.ts)}</span>{' '}
                <span className={e.ok ? 'text-teal' : 'text-red-500'}>{e.ok ? 'ok' : 'fail'}</span>{' '}
                <span className="tabular-nums">{Math.max(0, Math.round(e.durationMs))}ms</span> — {e.description}
                {e.respondsTo ? (
                  <span className="text-gray-400 dark:text-gray-500"> · {e.respondsTo}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
        Changes you make are saved on this device first, then sent to the server in order. If you are offline, items
        stay here until you are back online.
      </p>
      {displayRows.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-2">Nothing is waiting to sync.</p>
      ) : (
        <ul className="max-h-[min(60vh,28rem)] space-y-0 overflow-y-auto pr-1 -mr-1">
          {displayRows.map((row, i) => (
            <li
              key={row.id}
              className={`py-3 ${i > 0 ? 'border-t border-gray-200 dark:border-neutral-600' : ''}`}
            >
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{row.description}</div>
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words">
                {row.statusLine}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-white touch-manipulation hover:opacity-90"
        >
          Close
        </button>
      </div>
    </Modal>
  )
}
