'use client'

import { isPwaDebugEnabled } from '@/lib/pwaDebug'
import { scheduleAfterFirstPaint } from '@/lib/startupPerf'
import { perfLog, registerPerfLogSink } from '@/lib/startupPerfLog'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useToast } from '@/components/ui/Toast'

const PERF_LOG_CAP = 100

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

function DiagnosticsMessageBoxPanel() {
  const [showPwaTools, setShowPwaTools] = useState(false)
  useEffect(() => {
    scheduleAfterFirstPaint(() => setShowPwaTools(isPwaDebugEnabled()))
  }, [])

  const { diagnosticsText, perfLines, clearDiagnostics, clearPerfLog } = useDiagnosticsMessageBox()
  const { success: showSuccess, error: showError } = useToast()

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
    const perf = perfLines.join('\n')
    if (!diagnosticsText) return perf
    if (!perf) return diagnosticsText
    return `${perf}\n\n--- PWA diagnostics ---\n\n${diagnosticsText}`
  }, [diagnosticsText, perfLines])

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
        <span className="text-sm font-semibold text-teal-300">Startup performance</span>
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
          {showPwaTools ? (
            <button
              type="button"
              onClick={clearDiagnostics}
              className="rounded border border-neutral-600 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
            >
              Clear PWA log
            </button>
          ) : null}
        </div>
      </div>
      <pre className="m-0 max-h-[40vh] w-full overflow-auto whitespace-pre-wrap break-words p-4 text-left text-[11px] leading-relaxed sm:text-xs">
        {perfLines.length === 0 ? 'Collecting startup timings…' : perfLines.join('\n')}
      </pre>
      {showPwaTools && diagnosticsText ? (
        <>
          <div className="border-t border-neutral-700 px-3 py-2 text-xs font-semibold text-amber-200">
            PWA diagnostics (debug mode)
          </div>
          <pre className="m-0 max-h-[30vh] w-full overflow-auto whitespace-pre-wrap break-words border-t border-neutral-800 p-4 text-left text-[11px] leading-relaxed text-amber-50/95 sm:text-xs">
            {diagnosticsText}
          </pre>
        </>
      ) : null}
    </section>
  )
}

export function DiagnosticsMessageBoxProvider({ children }: { children: React.ReactNode }) {
  const [diagnosticsText, setDiagnosticsText] = useState('')
  const [perfLines, setPerfLines] = useState<string[]>([])

  useLayoutEffect(() => {
    registerPerfLogSink((line) => {
      setPerfLines((prev) => [...prev, line].slice(-PERF_LOG_CAP))
    })
    perfLog('root mounted')
    return () => registerPerfLogSink(null)
  }, [])

  const appendDiagnostics = useCallback((section: string) => {
    if (!isPwaDebugEnabled()) return
    const stamp = new Date().toISOString()
    setDiagnosticsText((prev) => {
      const block = `[${stamp}]\n${section}`
      return prev ? `${prev}\n\n${block}` : block
    })
  }, [])

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
        <div className="min-h-0 flex-1">{children}</div>
        <DiagnosticsMessageBoxPanel />
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
