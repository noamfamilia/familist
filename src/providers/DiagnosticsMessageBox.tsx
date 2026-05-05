'use client'

import { registerPerfLogSink } from '@/lib/startupPerfLog'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, useRef } from 'react'
import { useToast } from '@/components/ui/Toast'
import {
  appendOfflineNavDiagnostic,
  registerOfflineNavDiagnosticSink,
} from '@/lib/offlineNavDiagnostics'
import {
  DIAGNOSTICS_DATA_COLLECTION_ENABLED,
  DIAGNOSTICS_PANEL_VISIBLE,
} from '@/lib/diagnosticsFlags'

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
  appendDiagnostics: (section: string) => void
  clearDiagnostics: () => void
}

const DiagnosticsContext = createContext<DiagnosticsContextValue | undefined>(undefined)

function DiagnosticsMessageBoxPanel() {
  const { diagnosticsText, clearDiagnostics } = useDiagnosticsMessageBox()
  const { success: showSuccess, error: showError } = useToast()

  const combinedText = useMemo(() => {
    return diagnosticsText
  }, [diagnosticsText])

  const copyAll = useCallback(async () => {
    if (!combinedText) return
    try {
      await copyTextToClipboard(combinedText)
      showSuccess('Copied mutation diagnostics')
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
          <span className="text-sm font-semibold text-teal-300">Mutation diagnostics</span>
          <p className="mt-0.5 text-[10px] leading-snug text-teal-200/70 sm:text-[11px]">
            Per mutation, short local + server summaries.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            onClick={clearDiagnostics}
            className="rounded border border-neutral-600 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
          >
            Clear
          </button>
        </div>
      </div>
      <pre className="m-0 max-h-[30vh] w-full overflow-auto whitespace-pre-wrap break-words border-t border-neutral-800 bg-neutral-900/30 p-4 text-left text-[11px] leading-relaxed text-amber-50/95 sm:text-xs">
        {diagnosticsText || '(no mutation events yet)'}
      </pre>
    </section>
  )
}

export function DiagnosticsMessageBoxProvider({ children }: { children: React.ReactNode }) {
  const [diagnosticsText, setDiagnosticsText] = useState('')
  useEffect(() => registerPerfLogSink(null), [])

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

  const clearDiagnostics = useCallback(() => {
    setDiagnosticsText('')
  }, [])

  const value = useMemo(
    () => ({ diagnosticsText, appendDiagnostics, clearDiagnostics }),
    [diagnosticsText, appendDiagnostics, clearDiagnostics],
  )

  return (
    <DiagnosticsContext.Provider value={value}>
      <div className="flex min-h-screen flex-col">
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
