'use client'

import { isPwaDebugEnabled } from '@/lib/pwaDebug'
import {
  formatBreakdownForCopy,
  parsePerfLinesToBreakdown,
} from '@/lib/startupDiagnostics'
import { scheduleAfterFirstPaint } from '@/lib/startupPerf'
import { perfLog, registerPerfLogSink } from '@/lib/startupPerfLog'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import {
  appendOfflineNavDiagnostic,
  registerOfflineNavDiagnosticSink,
} from '@/lib/offlineNavDiagnostics'
import {
  DIAGNOSTICS_DATA_COLLECTION_ENABLED,
  DIAGNOSTICS_PANEL_VISIBLE,
} from '@/lib/diagnosticsFlags'

const PERF_LOG_CAP = 100
/** Trim oldest log text so the panel stays responsive after long sessions. */
const DIAG_TEXT_MAX_CHARS = 120_000

async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
}

type DiagnosticsContextValue = {
  diagnosticsText: string
  perfLines: string[]
  appendDiagnostics: (section: string) => void
  clearDiagnostics: () => void
  clearPerfLog: () => void
}

const DiagnosticsContext = createContext<DiagnosticsContextValue | undefined>(undefined)

/** Path + lifecycle observers for offline nav debugging (must render under DiagnosticsContext.Provider). */
function GlobalNavDiagnosticsLogger() {
  const pathname = usePathname()
  const prevPathRef = useRef<string | null>(null)

  useEffect(() => {
    const iso = new Date().toISOString()
    const prev = prevPathRef.current
    prevPathRef.current = pathname
    if (prev === null) {
      appendOfflineNavDiagnostic(
        `[pathname] initial path=${pathname} ts=${iso} onLine=${typeof navigator !== 'undefined' && navigator.onLine ? 1 : 0}`,
      )
      return
    }
    if (prev !== pathname) {
      appendOfflineNavDiagnostic(
        `[pathname-change]\noldPath=${prev}\nnewPath=${pathname}\nts=${iso}\nonLine=${navigator.onLine ? 1 : 0}`,
      )
    }
  }, [pathname])

  useEffect(() => {
    const onOffline = () => appendOfflineNavDiagnostic('[browser] window "offline"')
    const onOnline = () => appendOfflineNavDiagnostic('[browser] window "online"')
    const onPop = () =>
      appendOfflineNavDiagnostic(
        `[history] popstate path=${window.location.pathname}${window.location.search}`,
      )
    const onVis = () =>
      appendOfflineNavDiagnostic(
        `[visibilitychange] state=${document.visibilityState} path=${window.location.pathname}${window.location.search}`,
      )
    const onPageHide = (e: PageTransitionEvent) => {
      appendOfflineNavDiagnostic(
        `[pagehide] persisted=${e.persisted ? 1 : 0} path=${window.location.pathname}${window.location.search}`,
      )
    }
    const onPageShow = (e: PageTransitionEvent) => {
      appendOfflineNavDiagnostic(
        `[pageshow] persisted=${e.persisted ? 1 : 0} path=${window.location.pathname}${window.location.search}`,
      )
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason
      const msg =
        r instanceof Error ? `${r.name}: ${r.message}` : typeof r === 'string' ? r : JSON.stringify(r)
      appendOfflineNavDiagnostic(`[unhandledrejection] ${msg}`)
    }
    const onError = (e: ErrorEvent) => {
      appendOfflineNavDiagnostic(
        `[window error] ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`,
      )
    }
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    window.addEventListener('popstate', onPop)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('error', onError)
    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('popstate', onPop)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('error', onError)
    }
  }, [])

  return null
}

function DiagnosticsMessageBoxPanel() {
  const [showPwaTools, setShowPwaTools] = useState(false)
  useEffect(() => {
    scheduleAfterFirstPaint(() => setShowPwaTools(isPwaDebugEnabled()))
  }, [])

  const { diagnosticsText, perfLines, clearDiagnostics, clearPerfLog } = useDiagnosticsMessageBox()
  const { success: showSuccess, error: showError } = useToast()

  const breakdownRows = useMemo(() => parsePerfLinesToBreakdown(perfLines), [perfLines])

  const probeUrl = useMemo(() => {
    if (typeof window === 'undefined') return ''
    const id = process.env.NEXT_PUBLIC_BUILD_ID || 'unknown'
    return `${window.location.origin}/sw.js?v=${encodeURIComponent(id)}`
  }, [])

  const openProbe = useCallback(() => {
    if (!probeUrl) return
    window.open(probeUrl, '_blank', 'noopener,noreferrer')
  }, [probeUrl])

  const combinedText = useMemo(() => {
    const breakdown = formatBreakdownForCopy(breakdownRows)
    const perf = perfLines.join('\n')
    const parts: string[] = []
    if (breakdown) parts.push(breakdown)
    if (perf) parts.push(perf)
    const head = parts.join('\n\n')
    if (!diagnosticsText) return head
    if (!head) return diagnosticsText
    return `${head}\n\n--- PWA diagnostics ---\n\n${diagnosticsText}`
  }, [breakdownRows, diagnosticsText, perfLines])

  const copyAll = useCallback(async () => {
    if (!combinedText) return
    try {
      await copyTextToClipboard(combinedText)
      showSuccess('Copied startup log and diagnostics')
    } catch {
      showError('Could not copy')
    }
  }, [combinedText, showError, showSuccess])

  return (
    <section
      className="w-full shrink-0 border-t-4 border-teal-600 bg-neutral-950 text-emerald-50 dark:border-teal-500"
      aria-label="Startup performance log"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-700 px-3 py-2">
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-teal-300">Diagnostics (always on)</span>
          <p className="mt-0.5 text-[10px] leading-snug text-teal-200/70 sm:text-[11px]">
            Nav / offline / connectivity events append below. Optional startup breakdown:{' '}
            <code className="rounded bg-neutral-800 px-0.5">?debugStartup=1</code> · PWA heavy tools:{' '}
            <code className="rounded bg-neutral-800 px-0.5">?debugPwa=1</code>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showPwaTools ? (
            <button
              type="button"
              onClick={openProbe}
              className="rounded border border-neutral-600 bg-neutral-800 px-2 py-1 text-xs text-teal-300 hover:bg-neutral-700"
            >
              Open /sw.js?v=build
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void copyAll()}
            disabled={!combinedText}
            className="rounded border border-neutral-600 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
          >
            Copy all
          </button>
          <button
            type="button"
            onClick={clearPerfLog}
            className="rounded border border-neutral-600 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
          >
            Clear perf
          </button>
          <button
            type="button"
            onClick={clearDiagnostics}
            className="rounded border border-neutral-600 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
          >
            Clear nav log
          </button>
        </div>
      </div>

      {breakdownRows.length > 0 ? (
        <div className="border-b border-neutral-800 px-3 py-2">
          <div className="mb-1.5 text-xs font-semibold text-teal-200/95">Breakdown (Δ = ms since previous row)</div>
          <div className="max-h-[28vh] overflow-auto rounded border border-neutral-800 bg-neutral-900/40">
            <table className="w-full border-collapse text-left text-[11px] sm:text-xs">
              <thead>
                <tr className="border-b border-neutral-700 text-teal-200/90">
                  <th className="sticky top-0 bg-neutral-900/95 px-2 py-1.5 font-medium">Step</th>
                  <th className="sticky top-0 bg-neutral-900/95 px-2 py-1.5 text-right font-medium tabular-nums">t+ ms</th>
                  <th className="sticky top-0 bg-neutral-900/95 px-2 py-1.5 text-right font-medium tabular-nums">Δ ms</th>
                </tr>
              </thead>
              <tbody>
                {breakdownRows.map((r, i) => (
                  <tr key={`${r.tMs}-${i}`} className="border-b border-neutral-800/80 last:border-0">
                    <td className="max-w-[55vw] break-words px-2 py-1 font-mono text-emerald-100/95 sm:max-w-none">
                      {r.label}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-emerald-50/90">{r.tMs}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-teal-300/90">
                      {r.deltaMs == null ? '—' : r.deltaMs}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <pre className="m-0 max-h-[40vh] w-full overflow-auto whitespace-pre-wrap break-words p-4 text-left text-[11px] leading-relaxed sm:text-xs">
        {perfLines.length === 0 ? 'Startup timings: none yet (optional ?debugStartup=1).' : perfLines.join('\n')}
      </pre>
      <div className="border-t border-neutral-700 px-3 py-2 text-xs font-semibold text-amber-200">
        Nav &amp; connectivity log
      </div>
      <pre className="m-0 max-h-[30vh] w-full overflow-auto whitespace-pre-wrap break-words border-t border-neutral-800 bg-neutral-900/30 p-4 text-left text-[11px] leading-relaxed text-amber-50/95 sm:text-xs">
        {diagnosticsText || '(no events yet — navigate or go offline to populate)'}
      </pre>
    </section>
  )
}

export function DiagnosticsMessageBoxProvider({ children }: { children: React.ReactNode }) {
  const [diagnosticsText, setDiagnosticsText] = useState('')
  const [perfLines, setPerfLines] = useState<string[]>([])
  useLayoutEffect(() => {
    perfLog('root mounted')
  }, [])

  useEffect(() => {
    registerPerfLogSink((line) => {
      if (!DIAGNOSTICS_DATA_COLLECTION_ENABLED) return
      setPerfLines((prev) => [...prev, line].slice(-PERF_LOG_CAP))
    })
    return () => registerPerfLogSink(null)
  }, [])

  const appendDiagnostics = useCallback((section: string) => {
    if (!DIAGNOSTICS_DATA_COLLECTION_ENABLED) return
    const stamp = new Date().toISOString()
    setDiagnosticsText((prev) => {
      const block = `[${stamp}]\n${section}`
      const next = prev ? `${prev}\n\n${block}` : block
      if (next.length <= DIAG_TEXT_MAX_CHARS) return next
      return next.slice(-DIAG_TEXT_MAX_CHARS)
    })
  }, [])

  useLayoutEffect(() => {
    registerOfflineNavDiagnosticSink((section) => {
      appendDiagnostics(section)
    })
    return () => registerOfflineNavDiagnosticSink(null)
  }, [appendDiagnostics])

  useEffect(() => {
    if (!DIAGNOSTICS_DATA_COLLECTION_ENABLED) return
    appendDiagnostics('[diagnostics] always-on nav/connectivity log started')
  }, [appendDiagnostics])

  const clearDiagnostics = useCallback(() => {
    setDiagnosticsText('')
  }, [])

  const clearPerfLog = useCallback(() => {
    setPerfLines([])
  }, [])

  const value = useMemo(
    () => ({ diagnosticsText, perfLines, appendDiagnostics, clearDiagnostics, clearPerfLog }),
    [diagnosticsText, perfLines, appendDiagnostics, clearDiagnostics, clearPerfLog],
  )

  return (
    <DiagnosticsContext.Provider value={value}>
      <div className="flex min-h-screen flex-col">
        <GlobalNavDiagnosticsLogger />
        <div className="min-h-0 flex-1">{children}</div>
        {DIAGNOSTICS_PANEL_VISIBLE ? <DiagnosticsMessageBoxPanel /> : null}
      </div>
    </DiagnosticsContext.Provider>
  )
}

export function useDiagnosticsMessageBox() {
  const ctx = useContext(DiagnosticsContext)
  if (!ctx) {
    throw new Error('useDiagnosticsMessageBox must be used within DiagnosticsMessageBoxProvider')
  }
  return ctx
}
