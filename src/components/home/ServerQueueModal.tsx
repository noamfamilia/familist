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
import { clearServerSessionLog } from '@/lib/serverSessionLog'

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

function formatPendingQueueText(rows: RowDisplay[]): string {
  if (rows.length === 0) return 'Nothing is waiting to sync.'
  return rows
    .map((row, i) => {
      const head = `${i + 1}. ${row.description}`
      return row.statusLine ? `${head}\n   ${row.statusLine}` : head
    })
    .join('\n\n')
}

function formatHistoryQueueText(
  entries: ReadonlyArray<{
    ts: number
    description: string
    ok: boolean
    durationMs: number
    respondsTo?: string
  }>,
): string {
  if (entries.length === 0) return 'No server requests this session.'
  return [...entries]
    .reverse()
    .map((e) => {
      const time = formatSessionTime(e.ts)
      const status = e.ok ? 'ok' : 'fail'
      const ms = Math.max(0, Math.round(e.durationMs))
      const tail = e.respondsTo ? ` · ${e.respondsTo}` : ''
      return `${time} ${status} ${ms}ms — ${e.description}${tail}`
    })
    .join('\n')
}

const actionBtnClass =
  'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 touch-manipulation hover:bg-gray-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-gray-200 dark:hover:bg-neutral-700'

const textareaClass =
  'min-h-[7rem] w-full flex-1 resize-none rounded-lg border border-gray-200 bg-white p-3 font-mono text-xs leading-relaxed text-gray-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-gray-100'

export function ServerQueueModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { status: connectivityStatus } = useConnectivity()
  const { entries: serverSessionEntries } = useServerSessionLog()
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
  const historyQueueText = useMemo(() => formatHistoryQueueText(serverSessionEntries), [serverSessionEntries])

  const flashCopyHint = (label: string) => {
    setCopyHint(label)
    window.setTimeout(() => setCopyHint(null), 1500)
  }

  const copyPending = async () => {
    await copyTextToClipboard(pendingQueueText)
    flashCopyHint('Pending queue copied')
  }

  const copyHistory = async () => {
    await copyTextToClipboard(historyQueueText)
    flashCopyHint('History copied')
  }

  const clearHistory = () => {
    clearServerSessionLog()
    flashCopyHint('History cleared')
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Server queue"
      size="lg"
      contentClassName="flex max-h-[min(85vh,40rem)] flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <section className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Pending queue:</h3>
            <button type="button" onClick={() => void copyPending()} className={actionBtnClass}>
              Copy
            </button>
          </div>
          <textarea
            readOnly
            value={pendingQueueText}
            aria-label="Pending queue"
            className={textareaClass}
          />
        </section>

        <section className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">History queue:</h3>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void copyHistory()} className={actionBtnClass}>
                Copy
              </button>
              <button type="button" onClick={clearHistory} className={actionBtnClass}>
                Clear
              </button>
            </div>
          </div>
          <textarea
            readOnly
            value={historyQueueText}
            aria-label="History queue"
            className={textareaClass}
          />
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
