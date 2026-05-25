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
import { clearServerQueueModalState } from '@/lib/serverQueueModalState'
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

const rowIndexClass = 'text-gray-900 dark:text-gray-100'
const rowActionClass = 'text-gray-900 dark:text-gray-100'
const rowMetaClass = 'text-gray-500 dark:text-gray-500'

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

function formatPendingQueueRowPlain(row: RowDisplay): string {
  const time = formatRowTime(row.updatedAt)
  const head = `${row.displayIndex}. ${row.description} ${row.statusLabel} ${time}`
  return row.detailTail ? `${head} · ${row.detailTail}` : head
}

export function formatPendingQueueSectionCopy(
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

const actionBtnClass =
  'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 touch-manipulation hover:bg-gray-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-gray-200 dark:hover:bg-neutral-700'

const detailListClass = 'space-y-1 text-xs text-gray-600 dark:text-gray-400'

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

/**
 * Session-scoped cache of rows that left the live queue (sync_queue rows are deleted on success or
 * terminal failure). Keeps them visible in the modal until the user clicks Clear or the page reloads.
 */
const terminalQueueRows = new Map<string, RowDisplay>()
const terminalQueueListeners = new Set<() => void>()

function emitTerminalQueueChange(): void {
  for (const fn of terminalQueueListeners) fn()
}

function recordTerminalQueueRow(row: RowDisplay): void {
  terminalQueueRows.set(row.id, row)
  emitTerminalQueueChange()
}

function clearTerminalQueueRows(): void {
  if (terminalQueueRows.size === 0) return
  terminalQueueRows.clear()
  emitTerminalQueueChange()
}

function subscribeTerminalQueueRows(fn: () => void): () => void {
  terminalQueueListeners.add(fn)
  return () => {
    terminalQueueListeners.delete(fn)
  }
}

function classifyTerminalRow(prev: DbSyncQueueRow): { label: string; tone: OutboundQueueStatusTone } {
  if (prev.status === 'failed' || (prev.last_error && prev.last_error.trim().length > 0)) {
    return { label: 'fail', tone: 'failure' }
  }
  return { label: 'completed', tone: 'success' }
}

export function PendingQueueStatusSection() {
  const { status: connectivityStatus } = useConnectivity()
  const allRows = useLiveQuery(() => db.sync_queue.orderBy('updated_at').toArray(), [], []) ?? []
  const rows = useLiveQuery(async () => filterActiveOutboundRows(allRows), [allRows], []) ?? []
  const [activeDisplayRows, setActiveDisplayRows] = useState<RowDisplay[]>([])
  const [copyHint, setCopyHint] = useState<string | null>(null)
  const [, setTerminalVersion] = useState(0)

  const previousRawRowsRef = useRef<Map<string, DbSyncQueueRow>>(new Map())
  const previousDisplayRowsRef = useRef<Map<string, RowDisplay>>(new Map())

  useEffect(() => {
    return subscribeTerminalQueueRows(() => setTerminalVersion((v) => v + 1))
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
        if (terminalQueueRows.has(id)) continue
        const lastRaw = prevRaw.get(id)
        if (!lastRaw) continue
        const { label, tone } = classifyTerminalRow(lastRaw)
        recordTerminalQueueRow({
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

  const sortedDisplayRows = useMemo(() => {
    const map = new Map<string, RowDisplay>()
    for (const r of terminalQueueRows.values()) map.set(r.id, r)
    for (const r of activeDisplayRows) map.set(r.id, r)
    return [...map.values()].sort(
      (a, b) => a.displayIndex - b.displayIndex || a.id.localeCompare(b.id),
    )
  }, [activeDisplayRows])

  const copyText = useMemo(
    () => formatPendingQueueSectionCopy(sortedDisplayRows, connectivityStatus),
    [sortedDisplayRows, connectivityStatus],
  )

  const flashCopyHint = (label: string) => {
    setCopyHint(label)
    window.setTimeout(() => setCopyHint(null), 1500)
  }

  const copyAll = async () => {
    await copyTextToClipboard(copyText)
    flashCopyHint('Copied')
  }

  const clearAll = async () => {
    clearTerminalQueueRows()
    previousDisplayRowsRef.current = new Map()
    previousRawRowsRef.current = new Map()
    await clearServerQueueModalState()
    flashCopyHint('Cleared')
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{PENDING_QUEUE_TITLE}</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void copyAll()} className={actionBtnClass}>
            Copy
          </button>
          <button type="button" onClick={() => void clearAll()} className={actionBtnClass}>
            Clear
          </button>
        </div>
      </div>
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
      {copyHint ? (
        <p className="text-xs text-teal" role="status">
          {copyHint}
        </p>
      ) : null}
    </section>
  )
}
