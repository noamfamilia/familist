'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Modal } from '@/components/ui/Modal'
import { db } from '@/lib/db'
import { describeOutboundSyncRow } from '@/lib/data/outboundSyncDescription'
import { outboundQueueRowStatusLine } from '@/lib/data/outboundQueueStatus'
import { useServerSessionLog } from '@/hooks/useServerSessionLog'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { copyTextToClipboard } from '@/lib/clipboard'
import { clearServerSessionLog, type ServerSessionEntry } from '@/lib/serverSessionLog'

type RowDisplay = {
  id: string
  description: string
  statusLine: string
}

/** Local time with milliseconds (e.g. 08:40:50.571). */
function formatSessionTimeWithMs(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    })
  } catch {
    const base = d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    return `${base}.${String(d.getMilliseconds()).padStart(3, '0')}`
  }
}

function formatPendingQueueText(rows: RowDisplay[]): string {
  if (rows.length === 0) return 'Nothing is waiting to sync.'
  return rows
    .map((row, i) => {
      const head = `${i + 1}. ${row.description}`
      return row.statusLine ? `${head}\n   ${row.statusLine}` : head
    })
    .join('\n\n')
}

function formatServerActivityCopyLine(e: ServerSessionEntry): string {
  const time = formatSessionTimeWithMs(e.ts)
  const status = e.ok ? 'ok' : 'fail'
  const tail = e.respondsTo ? ` · ${e.respondsTo}` : ''
  return `${time} ${status} — ${e.description}${tail}`
}

function formatServerActivityCopyText(entries: readonly ServerSessionEntry[]): string {
  if (entries.length === 0) return 'No server requests yet.'
  return [...entries].reverse().map(formatServerActivityCopyLine).join('\n')
}

const actionBtnClass =
  'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 touch-manipulation hover:bg-gray-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-gray-200 dark:hover:bg-neutral-700'

const preBlockClass =
  'w-full rounded-lg border border-gray-200 bg-white p-3 font-mono text-xs leading-relaxed text-gray-800 whitespace-pre-wrap break-words dark:border-neutral-600 dark:bg-neutral-900 dark:text-gray-100'

export function ServerQueueModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { status: connectivityStatus } = useConnectivity()
  const { entries: serverSessionEntries, summary: serverSessionSummary } = useServerSessionLog()
  const rows = useLiveQuery(() => db.sync_queue.orderBy('updated_at').toArray(), [], []) ?? []
  const [displayRows, setDisplayRows] = useState<RowDisplay[]>([])
  const [copyHint, setCopyHint] = useState<string | null>(null)

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

  const pendingQueueText = useMemo(() => formatPendingQueueText(displayRows), [displayRows])
  const serverActivityCopyText = useMemo(
    () => formatServerActivityCopyText(serverSessionEntries),
    [serverSessionEntries],
  )
  const serverActivityNewestFirst = useMemo(
    () => [...serverSessionEntries].reverse(),
    [serverSessionEntries],
  )

  const flashCopyHint = (label: string) => {
    setCopyHint(label)
    window.setTimeout(() => setCopyHint(null), 1500)
  }

  const copyPending = async () => {
    await copyTextToClipboard(pendingQueueText)
    flashCopyHint('Pending queue copied')
  }

  const copyServerActivity = async () => {
    await copyTextToClipboard(serverActivityCopyText)
    flashCopyHint('Server activity copied')
  }

  const clearServerActivity = () => {
    clearServerSessionLog()
    flashCopyHint('Server activity cleared')
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Server queue" size="lg">
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Pending queue:</h3>
            <button type="button" onClick={() => void copyPending()} className={actionBtnClass}>
              Copy
            </button>
          </div>
          <pre className={preBlockClass} aria-label="Pending queue">
            {pendingQueueText}
          </pre>
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Server activity</h3>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void copyServerActivity()} className={actionBtnClass}>
                Copy
              </button>
              <button type="button" onClick={clearServerActivity} className={actionBtnClass}>
                Clear
              </button>
            </div>
          </div>
          <p className="text-sm text-gray-800 dark:text-gray-200">
            {serverSessionSummary.total === 0 ? (
              <>No server requests yet.</>
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
          {serverActivityNewestFirst.length > 0 ? (
            <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
              {serverActivityNewestFirst.map((e, i) => (
                <li key={`${e.ts}-${i}`} className="break-words">
                  <span className="tabular-nums text-gray-400 dark:text-gray-500">
                    {formatSessionTimeWithMs(e.ts)}
                  </span>{' '}
                  <span className={e.ok ? 'text-teal' : 'text-red-500'}>{e.ok ? 'ok' : 'fail'}</span>
                  {' — '}
                  {e.description}
                  {e.respondsTo ? (
                    <span className="text-gray-400 dark:text-gray-500"> · {e.respondsTo}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      {copyHint ? (
        <p className="text-center text-xs text-teal" role="status">
          {copyHint}
        </p>
      ) : null}
    </Modal>
  )
}
