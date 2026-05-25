'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type DbSyncQueueRow } from '@/lib/db'
import { describeOutboundSyncRow } from '@/lib/data/outboundSyncDescription'
import {
  outboundQueueRowDetailTail,
  outboundQueueRowStatusLabel,
  type OutboundQueueStatusTone,
} from '@/lib/data/outboundQueueStatus'
import { filterActiveOutboundRows } from '@/lib/data/guestOutboundQueuePolicy'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { copyTextToClipboard } from '@/lib/clipboard'

type RowDisplay = {
  id: string
  displayIndex: number
  description: string
  statusLabel: string
  statusTone: OutboundQueueStatusTone
  detailTail: string
  updatedAt: number
}

export const PENDING_QUEUE_TITLE = 'Pending queue:'
export const QUEUE_HISTORY_TITLE = 'Queue history:'

const sectionRuleClass = 'border-gray-200 dark:border-neutral-600'
const rowIndexClass = 'text-gray-900 dark:text-gray-100'
const rowActionClass = 'text-gray-900 dark:text-gray-100'
const rowMetaClass = 'text-gray-500 dark:text-gray-500'
const detailListClass = 'space-y-1 text-xs text-gray-600 dark:text-gray-400'
const actionBtnClass =
  'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 touch-manipulation hover:bg-gray-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-gray-200 dark:hover:bg-neutral-700'

function rowStatusClass(tone: OutboundQueueStatusTone): string {
  if (tone === 'success') return 'text-green-600 dark:text-green-500'
  if (tone === 'failure') return 'text-red-500 dark:text-red-500'
  return 'text-gray-500 dark:text-gray-500'
}

function formatRowTime(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatRowPlain(row: RowDisplay): string {
  const time = formatRowTime(row.updatedAt)
  const head = `${row.displayIndex}. ${row.description} ${row.statusLabel} ${time}`
  return row.detailTail ? `${head} · ${row.detailTail}` : head
}

function formatRowsCopy(
  title: string,
  rows: RowDisplay[],
  emptyMessage: string,
  preface?: string,
): string {
  const lines: string[] = [title]
  if (preface) lines.push(preface)
  if (rows.length === 0) {
    lines.push(emptyMessage)
    return lines.join('\n')
  }
  const sorted = [...rows].sort(
    (a, b) => a.displayIndex - b.displayIndex || a.id.localeCompare(b.id),
  )
  for (const row of sorted) lines.push(formatRowPlain(row))
  return lines.join('\n')
}

export function formatPendingQueueSectionCopy(
  rows: RowDisplay[],
  connectivityStatus: 'online' | 'recovering' | 'offline',
): string {
  return formatRowsCopy(
    PENDING_QUEUE_TITLE,
    rows,
    'Nothing is waiting to sync.',
    `connectivity: ${connectivityStatus}`,
  )
}

export function formatQueueHistorySectionCopy(rows: RowDisplay[]): string {
  return formatRowsCopy(QUEUE_HISTORY_TITLE, rows, 'No completed activity yet.')
}

function QueueModalRow({ row }: { row: RowDisplay }) {
  return (
    <li className="break-words leading-relaxed">
      <span className={rowIndexClass}>{row.displayIndex}. </span>
      <span className={rowActionClass}>{row.description}</span>{' '}
      <span className={rowStatusClass(row.statusTone)}>{row.statusLabel}</span>{' '}
      <span className={`tabular-nums ${rowMetaClass}`}>{formatRowTime(row.updatedAt)}</span>
      {row.detailTail ? (
        <>
          {' '}
          <span className={rowMetaClass}>· {row.detailTail}</span>
        </>
      ) : null}
    </li>
  )
}

/**
 * Session-scoped cache of rows that left the live queue (sync_queue rows are deleted on success or
 * terminal failure). Resets on full page reload.
 */
const queueHistoryRows = new Map<string, RowDisplay>()
const queueHistoryListeners = new Set<() => void>()

function emitQueueHistoryChange(): void {
  for (const fn of queueHistoryListeners) fn()
}

function recordQueueHistoryRow(row: RowDisplay): void {
  queueHistoryRows.set(row.id, row)
  emitQueueHistoryChange()
}

function subscribeQueueHistory(fn: () => void): () => void {
  queueHistoryListeners.add(fn)
  return () => {
    queueHistoryListeners.delete(fn)
  }
}

function classifyTerminalRow(prev: DbSyncQueueRow): { label: string; tone: OutboundQueueStatusTone } {
  if (prev.status === 'failed' || (prev.last_error && prev.last_error.trim().length > 0)) {
    return { label: 'fail', tone: 'failure' }
  }
  return { label: 'completed', tone: 'success' }
}

function QueueSection({
  title,
  rows,
  emptyMessage,
  onCopy,
  preface,
}: {
  title: string
  rows: RowDisplay[]
  emptyMessage: string
  onCopy: () => void
  preface?: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
        <button type="button" onClick={onCopy} className={actionBtnClass}>
          Copy
        </button>
      </div>
      {preface}
      {rows.length === 0 ? (
        <p className="text-sm text-gray-800 dark:text-gray-200">{emptyMessage}</p>
      ) : (
        <ul className={detailListClass} aria-label={title}>
          {rows.map((row) => (
            <QueueModalRow key={row.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  )
}

export function PendingQueueStatusSection() {
  const { status: connectivityStatus } = useConnectivity()
  const allRows = useLiveQuery(() => db.sync_queue.orderBy('updated_at').toArray(), [], []) ?? []
  const rows = useLiveQuery(async () => filterActiveOutboundRows(allRows), [allRows], []) ?? []
  const [activeDisplayRows, setActiveDisplayRows] = useState<RowDisplay[]>([])
  const [historyDisplayRows, setHistoryDisplayRows] = useState<RowDisplay[]>(
    () => [...queueHistoryRows.values()],
  )
  const [copyHint, setCopyHint] = useState<string | null>(null)

  const previousRawRowsRef = useRef<Map<string, DbSyncQueueRow>>(new Map())
  const previousDisplayRowsRef = useRef<Map<string, RowDisplay>>(new Map())

  useEffect(() => {
    return subscribeQueueHistory(() => {
      setHistoryDisplayRows([...queueHistoryRows.values()])
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    const now = Date.now()
    void (async () => {
      const queueSnapshot = rows
      const next = await Promise.all(
        queueSnapshot.map(async (r, i) => {
          const { label, tone } = outboundQueueRowStatusLabel(r)
          return {
            id: r.id,
            displayIndex:
              typeof r.display_index === 'number' && r.display_index > 0 ? r.display_index : i + 1,
            description: await describeOutboundSyncRow(r),
            statusLabel: label,
            statusTone: tone,
            detailTail: outboundQueueRowDetailTail(r, queueSnapshot, {
              now,
              connectivityStatus,
            }),
            updatedAt: r.updated_at,
          }
        }),
      )
      if (cancelled) return

      const currentIds = new Set(next.map((r) => r.id))
      const prevDisplay = previousDisplayRowsRef.current
      const prevRaw = previousRawRowsRef.current

      for (const [id, prevRow] of prevDisplay) {
        if (currentIds.has(id)) continue
        if (queueHistoryRows.has(id)) continue
        const lastRaw = prevRaw.get(id)
        if (!lastRaw) continue
        const { label, tone } = classifyTerminalRow(lastRaw)
        recordQueueHistoryRow({
          ...prevRow,
          statusLabel: label,
          statusTone: tone,
          detailTail: '',
          updatedAt: Date.now(),
        })
      }

      previousDisplayRowsRef.current = new Map(next.map((r) => [r.id, r]))
      previousRawRowsRef.current = new Map(queueSnapshot.map((r) => [r.id, r]))
      setActiveDisplayRows(next)
    })()
    return () => {
      cancelled = true
    }
  }, [rows, connectivityStatus])

  const sortedActiveRows = useMemo(
    () =>
      [...activeDisplayRows].sort(
        (a, b) => a.displayIndex - b.displayIndex || a.id.localeCompare(b.id),
      ),
    [activeDisplayRows],
  )

  const sortedHistoryRows = useMemo(
    () =>
      [...historyDisplayRows].sort(
        (a, b) => a.displayIndex - b.displayIndex || a.id.localeCompare(b.id),
      ),
    [historyDisplayRows],
  )

  const flashCopyHint = (label: string) => {
    setCopyHint(label)
    window.setTimeout(() => setCopyHint(null), 1500)
  }

  const copyPending = async () => {
    await copyTextToClipboard(formatPendingQueueSectionCopy(sortedActiveRows, connectivityStatus))
    flashCopyHint('Copied')
  }

  const copyHistory = async () => {
    await copyTextToClipboard(formatQueueHistorySectionCopy(sortedHistoryRows))
    flashCopyHint('Copied')
  }

  return (
    <div className="flex flex-col gap-5">
      <hr className={sectionRuleClass} aria-hidden />

      <QueueSection
        title={PENDING_QUEUE_TITLE}
        rows={sortedActiveRows}
        emptyMessage="Nothing is waiting to sync."
        onCopy={() => void copyPending()}
        preface={<p className={`text-xs ${rowMetaClass}`}>connectivity: {connectivityStatus}</p>}
      />

      <hr className={sectionRuleClass} aria-hidden />

      <QueueSection
        title={QUEUE_HISTORY_TITLE}
        rows={sortedHistoryRows}
        emptyMessage="No completed activity yet."
        onCopy={() => void copyHistory()}
      />

      {copyHint ? (
        <p className="text-xs text-teal" role="status">
          {copyHint}
        </p>
      ) : null}
    </div>
  )
}
