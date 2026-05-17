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

const detailListClass = 'space-y-1 text-xs text-gray-600 dark:text-gray-400'

export function ServerQueueModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { status: connectivityStatus } = useConnectivity()
  const { entries: serverSessionEntries, summary: serverSessionSummary, revision: serverLogRevision } =
    useServerSessionLog()
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
    [serverSessionEntries, serverLogRevision],
  )
  const serverActivityNewestFirst = useMemo(
    () => [...serverSessionEntries].reverse(),
    [serverSessionEntries, serverLogRevision],
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
          {displayRows.length === 0 ? (
            <p className="text-sm text-gray-800 dark:text-gray-200">Nothing is waiting to sync.</p>
          ) : (
            <ul className={detailListClass} aria-label="Pending queue">
              {displayRows.map((row, i) => (
                <li key={row.id} className="break-words">
                  <span className="font-medium text-gray-800 dark:text-gray-200">
                    {i + 1}. {row.description}
                  </span>
                  {row.statusLine ? (
                    <div className="mt-0.5 whitespace-pre-wrap text-gray-500 dark:text-gray-500">
                      {row.statusLine}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <hr className="border-gray-200 dark:border-neutral-600" aria-hidden />

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
          {serverSessionSummary.total === 0 ? (
            <p className="text-sm text-gray-800 dark:text-gray-200">No server requests yet.</p>
          ) : (
            <div className="space-y-1 text-sm text-gray-800 dark:text-gray-200">
              <p>
                requests succeeded -{' '}
                <span className="font-medium tabular-nums text-teal">{serverSessionSummary.ok}</span>
              </p>
              <p>
                requests failed -{' '}
                <span className="font-medium tabular-nums text-red-500">{serverSessionSummary.fail}</span>
              </p>
            </div>
          )}
          {serverActivityNewestFirst.length > 0 ? (
            <ul className={`mt-2 ${detailListClass}`}>
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
