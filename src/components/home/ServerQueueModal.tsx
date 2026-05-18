'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Modal } from '@/components/ui/Modal'
import { db } from '@/lib/db'
import { describeOutboundSyncRow } from '@/lib/data/outboundSyncDescription'
import {
  outboundQueueRowDetailTail,
  outboundQueueRowStatusLabel,
  type OutboundQueueStatusTone,
} from '@/lib/data/outboundQueueStatus'
import { clearServerQueueModalState } from '@/lib/serverQueueModalState'
import { useServerSessionLog } from '@/hooks/useServerSessionLog'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { copyTextToClipboard } from '@/lib/clipboard'
import type { ServerSessionEntry } from '@/lib/serverSessionLog'

type RowDisplay = {
  id: string
  displayIndex: number
  description: string
  statusLabel: string
  statusTone: OutboundQueueStatusTone
  detailTail: string
  updatedAt: number
}

const PENDING_QUEUE_TITLE = 'Pending queue:'
const SERVER_ACTIVITY_TITLE = 'Server activity'

const rowIndexClass = 'text-gray-900 dark:text-gray-100'
const rowActionClass = 'text-gray-900 dark:text-gray-100'
const rowMetaClass = 'text-gray-500 dark:text-gray-500'

function rowStatusClass(tone: OutboundQueueStatusTone): string {
  if (tone === 'success') return 'text-green-600 dark:text-green-500'
  if (tone === 'failure') return 'text-red-500 dark:text-red-500'
  return 'text-gray-500 dark:text-gray-500'
}

/** Local time without milliseconds (e.g. 08:40:50). */
function formatRowTime(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatPendingQueueRowPlain(row: RowDisplay): string {
  const time = formatRowTime(row.updatedAt)
  const head = `${row.displayIndex}. ${row.description} ${row.statusLabel} ${time}`
  return row.detailTail ? `${head} · ${row.detailTail}` : head
}

function serverActivityStatus(e: ServerSessionEntry): { label: string; tone: OutboundQueueStatusTone } {
  return e.ok ? { label: 'ok', tone: 'success' } : { label: 'fail', tone: 'failure' }
}

function formatServerActivityRowPlain(e: ServerSessionEntry): string {
  const { label } = serverActivityStatus(e)
  const time = formatRowTime(e.ts)
  const head = `${e.index}. ${e.description} ${label} ${time}`
  return e.respondsTo ? `${head} · ${e.respondsTo}` : head
}

function formatPendingQueueSection(
  rows: RowDisplay[],
  connectivityStatus: 'online' | 'recovering' | 'offline',
): string {
  const lines: string[] = [PENDING_QUEUE_TITLE, `connectivity: ${connectivityStatus}`]
  if (rows.length === 0) {
    lines.push('Nothing is waiting to sync.')
    return lines.join('\n')
  }
  const sorted = [...rows].sort((a, b) => a.displayIndex - b.displayIndex || a.id.localeCompare(b.id))
  for (const row of sorted) {
    lines.push(formatPendingQueueRowPlain(row))
  }
  return lines.join('\n')
}

function formatServerActivitySection(entries: readonly ServerSessionEntry[]): string {
  const lines: string[] = [SERVER_ACTIVITY_TITLE]
  if (entries.length === 0) {
    lines.push('No server requests yet.')
    return lines.join('\n')
  }
  for (const e of entries) {
    lines.push(formatServerActivityRowPlain(e))
  }
  return lines.join('\n')
}

function formatFullServerQueueModalCopy(
  pendingRows: RowDisplay[],
  connectivityStatus: 'online' | 'recovering' | 'offline',
  serverEntries: readonly ServerSessionEntry[],
): string {
  return `${formatPendingQueueSection(pendingRows, connectivityStatus)}\n\n${formatServerActivitySection(serverEntries)}`
}

const actionBtnClass =
  'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 touch-manipulation hover:bg-gray-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-gray-200 dark:hover:bg-neutral-700'

const detailListClass = 'space-y-1 text-xs text-gray-600 dark:text-gray-400'
const sectionRuleClass = 'border-gray-200 dark:border-neutral-600'

function QueueModalRow({
  index,
  description,
  statusLabel,
  statusTone,
  time,
  detailTail,
}: {
  index: number
  description: string
  statusLabel: string
  statusTone: OutboundQueueStatusTone
  time: string
  detailTail?: string
}) {
  return (
    <li className="break-words leading-relaxed">
      <span className={rowIndexClass}>{index}. </span>
      <span className={rowActionClass}>{description}</span>
      {' '}
      <span className={rowStatusClass(statusTone)}>{statusLabel}</span>
      {' '}
      <span className={`tabular-nums ${rowMetaClass}`}>{time}</span>
      {detailTail ? (
        <>
          {' '}
          <span className={rowMetaClass}>· {detailTail}</span>
        </>
      ) : null}
    </li>
  )
}

function PendingQueueRow({ row }: { row: RowDisplay }) {
  return (
    <QueueModalRow
      index={row.displayIndex}
      description={row.description}
      statusLabel={row.statusLabel}
      statusTone={row.statusTone}
      time={formatRowTime(row.updatedAt)}
      detailTail={row.detailTail || undefined}
    />
  )
}

function ServerActivityRow({ entry }: { entry: ServerSessionEntry }) {
  const { label, tone } = serverActivityStatus(entry)
  return (
    <QueueModalRow
      index={entry.index}
      description={entry.description}
      statusLabel={label}
      statusTone={tone}
      time={formatRowTime(entry.ts)}
      detailTail={entry.respondsTo}
    />
  )
}

export function ServerQueueModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { status: connectivityStatus } = useConnectivity()
  const { entries: serverSessionEntries, revision: serverLogRevision } = useServerSessionLog()
  const rows = useLiveQuery(() => db.sync_queue.orderBy('updated_at').toArray(), [], []) ?? []
  const [displayRows, setDisplayRows] = useState<RowDisplay[]>([])
  const [copyHint, setCopyHint] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const now = Date.now()
    void (async () => {
      const next = await Promise.all(
        rows.map(async (r, i) => {
          const { label, tone } = outboundQueueRowStatusLabel(r)
          return {
            id: r.id,
            displayIndex: typeof r.display_index === 'number' && r.display_index > 0 ? r.display_index : i + 1,
            description: await describeOutboundSyncRow(r),
            statusLabel: label,
            statusTone: tone,
            detailTail: outboundQueueRowDetailTail(r, rows, { now, connectivityStatus }),
            updatedAt: r.updated_at,
          }
        }),
      )
      if (!cancelled) setDisplayRows(next)
    })()
    return () => {
      cancelled = true
    }
  }, [rows, connectivityStatus])

  const sortedDisplayRows = useMemo(
    () => [...displayRows].sort((a, b) => a.displayIndex - b.displayIndex || a.id.localeCompare(b.id)),
    [displayRows],
  )

  const fullCopyText = useMemo(
    () => formatFullServerQueueModalCopy(sortedDisplayRows, connectivityStatus, serverSessionEntries),
    [sortedDisplayRows, connectivityStatus, serverSessionEntries, serverLogRevision],
  )

  const flashCopyHint = (label: string) => {
    setCopyHint(label)
    window.setTimeout(() => setCopyHint(null), 1500)
  }

  const copyAll = async () => {
    await copyTextToClipboard(fullCopyText)
    flashCopyHint('Copied')
  }

  const clearAll = async () => {
    await clearServerQueueModalState()
    flashCopyHint('Cleared')
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Server queue"
      size="lg"
      contentClassName="!max-w-lg max-sm:!max-w-none"
      fullScreenMobile
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => void copyAll()} className={actionBtnClass}>
            Copy
          </button>
          <button type="button" onClick={() => void clearAll()} className={actionBtnClass}>
            Clear
          </button>
        </div>

        <hr className={sectionRuleClass} aria-hidden />

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{PENDING_QUEUE_TITLE}</h3>
          <p className={`text-xs ${rowMetaClass}`}>connectivity: {connectivityStatus}</p>
          {sortedDisplayRows.length === 0 ? (
            <p className="text-sm text-gray-800 dark:text-gray-200">Nothing is waiting to sync.</p>
          ) : (
            <ul className={detailListClass} aria-label="Pending queue">
              {sortedDisplayRows.map((row) => (
                <PendingQueueRow key={row.id} row={row} />
              ))}
            </ul>
          )}
        </section>

        <hr className={sectionRuleClass} aria-hidden />

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{SERVER_ACTIVITY_TITLE}</h3>
          {serverSessionEntries.length === 0 ? (
            <p className="text-sm text-gray-800 dark:text-gray-200">No server requests yet.</p>
          ) : (
            <ul className={detailListClass} aria-label="Server activity">
              {serverSessionEntries.map((e) => (
                <ServerActivityRow key={`${e.index}-${e.ts}`} entry={e} />
              ))}
            </ul>
          )}
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
