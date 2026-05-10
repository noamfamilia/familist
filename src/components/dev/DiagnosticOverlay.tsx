'use client'

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type DbSyncQueueRow } from '@/lib/db'
import { APP_VERSION } from '@/lib/appVersion'
import {
  LIST_MIRROR_LAST_SUCCESS_LIST_ID_META_ID,
  LIST_MIRROR_RUNNING_META_ID,
} from '@/lib/data/listMirror'
import {
  markDexieClearedForCurrentAppMajorInLocalStorage,
  PENDING_SCHEMA_10_MIRROR_RECONCILE_META_ID,
} from '@/lib/data/versionCheck'
import { registerOfflineNavDiagnosticSink } from '@/lib/offlineNavDiagnostics'
import { registerPerfLogSink } from '@/lib/startupPerfLog'
import { useToast } from '@/components/ui/Toast'
import { isDebugVerboseEnabled, setDebugVerboseEnabled } from '@/lib/diagnosticsFlags'

type LogLine = { ts: string; message: string }
const LOG_CAP = 20

/** When true, only lines that look like failures are kept in the live log buffer. */
function isDiagnosticErrorLine(message: string): boolean {
  if (/🔴/.test(message)) return true
  if (/\[ERROR\]/i.test(message)) return true
  if (/\[server\] fail\b/i.test(message)) return true
  if (/\[sync<-server\] error\b/i.test(message)) return true
  if (/\[console\.error\]/i.test(message)) return true
  if (/\bbulkPatchListLabels batch list_ids=/i.test(message)) return true
  return false
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'n/a'
  if (ms < 1_000) return `${Math.round(ms)}ms`
  const s = Math.floor(ms / 1_000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

function useInMemoryLogBuffer(errorsOnlyRef: MutableRefObject<boolean>): [LogLine[], () => void] {
  const [lines, setLines] = useState<LogLine[]>([])

  useEffect(() => {
    const push = (message: string) => {
      if (errorsOnlyRef.current && !isDiagnosticErrorLine(message)) return
      const next: LogLine = { ts: new Date().toISOString(), message }
      setLines((prev) => [...prev.slice(Math.max(0, prev.length - (LOG_CAP - 1))), next])
    }

    registerPerfLogSink(push)
    registerOfflineNavDiagnosticSink(push)

    const originalConsoleError = console.error
    console.error = (...args: unknown[]) => {
      try {
        const text = args
          .map((a) => {
            if (typeof a === 'string') return a
            try {
              return JSON.stringify(a)
            } catch {
              return String(a)
            }
          })
          .join(' ')
        push(`[console.error] ${text}`)
      } catch {
        // ignore log-buffer failures
      }
      originalConsoleError(...args)
    }

    return () => {
      registerPerfLogSink(null)
      registerOfflineNavDiagnosticSink(null)
      console.error = originalConsoleError
    }
  }, [errorsOnlyRef])

  return [lines, () => setLines([])]
}

export function DiagnosticOverlay() {
  const { success: showSuccess, error: showError } = useToast()
  const [isOnline, setIsOnline] = useState(true)
  const [errorsOnlyLog, setErrorsOnlyLog] = useState(false)
  const errorsOnlyRef = useRef(false)
  errorsOnlyRef.current = errorsOnlyLog
  const [logs, clearLogs] = useInMemoryLogBuffer(errorsOnlyRef)
  const [verboseLogging, setVerboseLogging] = useState(false)

  useEffect(() => {
    setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : true)
    setVerboseLogging(isDebugVerboseEnabled())
  }, [])

  useEffect(() => {
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const pendingSchema10Meta = useLiveQuery(
    async () => db.meta.get(PENDING_SCHEMA_10_MIRROR_RECONCILE_META_ID),
    [],
    undefined,
  )
  const mirrorRunMeta = useLiveQuery(async () => db.meta.get(LIST_MIRROR_RUNNING_META_ID), [], undefined)
  const mirrorLastSuccessMeta = useLiveQuery(
    async () => db.meta.get(LIST_MIRROR_LAST_SUCCESS_LIST_ID_META_ID),
    [],
    undefined,
  )
  const syncRows = useLiveQuery(async () => db.sync_queue.toArray(), [], [])

  const totalCount = syncRows.length
  const failedRows = useMemo(() => syncRows.filter((r) => r.status === 'failed'), [syncRows])
  const processingRows = useMemo(() => syncRows.filter((r) => r.status === 'processing'), [syncRows])

  const mirrorRunning = Boolean(
    (mirrorRunMeta?.value as { running?: boolean } | undefined)?.running,
  )
  const mirrorRunningListId =
    (mirrorRunMeta?.value as { list_id?: string } | undefined)?.list_id ?? null
  const mirrorRunningSince =
    (mirrorRunMeta?.value as { since_ms?: number } | undefined)?.since_ms ?? null
  const mirrorLastSuccessListId =
    (mirrorLastSuccessMeta?.value as { list_id?: string } | undefined)?.list_id ?? null
  const mirrorLastSuccessAt =
    (mirrorLastSuccessMeta?.value as { at_iso?: string } | undefined)?.at_iso ?? null

  const emergencyReset = async () => {
    try {
      await db.delete()
      markDexieClearedForCurrentAppMajorInLocalStorage()
      window.location.reload()
    } catch {
      showError('Reset failed')
    }
  }

  const copyLogs = async () => {
    try {
      const text = logs.map((l) => `[${l.ts}] ${l.message}`).join('\n')
      await navigator.clipboard.writeText(text)
      showSuccess('Copied debug logs')
    } catch {
      showError('Could not copy logs')
    }
  }

  const toggleVerboseLogging = () => {
    const next = !verboseLogging
    setVerboseLogging(next)
    setDebugVerboseEnabled(next)
    if (next) {
      showSuccess('Verbose logging enabled')
    } else {
      showSuccess('Verbose logging disabled')
    }
  }

  const toggleErrorsOnlyLog = () => {
    setErrorsOnlyLog((v) => !v)
  }

  return (
    <section className="w-full shrink-0 border-t-4 border-teal-600 bg-neutral-950 text-emerald-50 dark:border-teal-500">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-700 px-3 py-2">
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-teal-300">Diagnostic overlay</span>
          <p className="mt-0.5 text-[10px] leading-snug text-teal-200/70 sm:text-[11px]">
            Live Dexie, queue, mirror worker, and log-buffer state.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleVerboseLogging}
            className={`rounded border px-2 py-1 text-xs ${
              verboseLogging
                ? 'border-emerald-500/60 bg-emerald-900/30 text-emerald-100 hover:bg-emerald-900/50'
                : 'border-neutral-600 bg-neutral-800 text-neutral-200 hover:bg-neutral-700'
            }`}
          >
            Verbose logging: {verboseLogging ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={toggleErrorsOnlyLog}
            className={`rounded border px-2 py-1 text-xs ${
              errorsOnlyLog
                ? 'border-emerald-500/60 bg-emerald-900/30 text-emerald-100 hover:bg-emerald-900/50'
                : 'border-neutral-600 bg-neutral-800 text-neutral-200 hover:bg-neutral-700'
            }`}
          >
            Live log: {errorsOnlyLog ? 'errors only' : 'all'}
          </button>
          <button
            type="button"
            onClick={() => void copyLogs()}
            className="rounded border border-neutral-600 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
          >
            Copy logs
          </button>
          <button
            type="button"
            onClick={clearLogs}
            className="rounded border border-neutral-600 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
          >
            Clear logs
          </button>
          <button
            type="button"
            onClick={() => void emergencyReset()}
            className="rounded border border-red-500/40 bg-red-900/30 px-2 py-1 text-xs text-red-100 hover:bg-red-900/50"
          >
            Emergency reset
          </button>
        </div>
      </div>

      <div className="grid gap-3 border-t border-neutral-800 bg-neutral-900/30 p-3 text-xs sm:grid-cols-2">
        <div className="space-y-1">
          <div className="font-semibold text-teal-200">System health</div>
          <div>APP_VERSION: {APP_VERSION}</div>
          <div>navigator.onLine: {String(isOnline)}</div>
          <div>
            pending_schema_10_full_mirror_reconcile:{' '}
            {String((pendingSchema10Meta?.value as boolean | undefined) ?? false)}
          </div>
        </div>

        <div className="space-y-1">
          <div className="font-semibold text-teal-200">Inbound mirror</div>
          <div>running: {String(mirrorRunning)}</div>
          <div>running_list_id: {mirrorRunningListId ?? '(none)'}</div>
          <div>
            running_for:{' '}
            {mirrorRunning && typeof mirrorRunningSince === 'number'
              ? formatDuration(Date.now() - mirrorRunningSince)
              : '(n/a)'}
          </div>
          <div>last_success_list_id: {mirrorLastSuccessListId ?? '(none)'}</div>
          <div>last_success_at: {mirrorLastSuccessAt ?? '(none)'}</div>
        </div>
      </div>

      <div className="grid gap-3 border-t border-neutral-800 bg-neutral-900/30 p-3 text-xs sm:grid-cols-2">
        <div className="space-y-1">
          <div className="font-semibold text-teal-200">Outbound queue</div>
          <div>total rows: {totalCount}</div>
          <div>failed rows: {failedRows.length}</div>
          <div>processing rows: {processingRows.length}</div>
          {processingRows.length > 0 ? (
            <ul className="mt-1 max-h-28 overflow-auto space-y-1">
              {processingRows.map((r: DbSyncQueueRow) => (
                <li key={r.id} className="rounded bg-neutral-800/70 px-2 py-1">
                  {r.kind}/{r.entity} {r.entity_id} locked_for=
                  {r.locked_at == null ? 'n/a' : formatDuration(Date.now() - r.locked_at)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="space-y-1">
          <div className="font-semibold text-teal-200">Failed rows</div>
          {failedRows.length === 0 ? (
            <div>(none)</div>
          ) : (
            <ul className="max-h-28 overflow-auto space-y-1">
              {failedRows.map((r: DbSyncQueueRow) => (
                <li key={r.id} className="rounded bg-red-900/20 px-2 py-1">
                  {r.kind}/{r.entity} {r.entity_id} err={r.last_error ?? '(none)'}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="border-t border-neutral-800 bg-neutral-900/30 p-3">
        <div className="mb-1 text-xs font-semibold text-teal-200">
          Live logs (last 20){errorsOnlyLog ? ' · showing errors/failures only' : ''}
        </div>
        <pre className="m-0 max-h-[28vh] w-full overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-amber-50/95 sm:text-xs">
          {logs.length > 0
            ? logs.map((l) => `[${l.ts}] ${l.message}`).join('\n')
            : '(no perfLog/console.error entries yet)'}
        </pre>
      </div>
    </section>
  )
}

