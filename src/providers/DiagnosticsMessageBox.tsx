'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'

type DiagnosticsContextValue = {
  diagnosticsText: string
  appendDiagnostics: (section: string) => void
  clearDiagnostics: () => void
}

const DiagnosticsContext = createContext<DiagnosticsContextValue | undefined>(undefined)

function DiagnosticsMessageBoxPanel() {
  const { diagnosticsText, clearDiagnostics } = useDiagnosticsMessageBox()

  const probeUrl = useMemo(() => {
    if (typeof window === 'undefined') return ''
    const id = process.env.NEXT_PUBLIC_BUILD_ID || 'unknown'
    return `${window.location.origin}/sw.js?v=${encodeURIComponent(id)}`
  }, [])

  const openProbe = useCallback(() => {
    if (!probeUrl) return
    window.open(probeUrl, '_blank', 'noopener,noreferrer')
  }, [probeUrl])

  if (!diagnosticsText) return null

  return (
    <section
      className="w-full shrink-0 border-t-4 border-teal-600 bg-neutral-950 text-emerald-50 dark:border-teal-500"
      aria-label="Diagnostics"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-700 px-3 py-2">
        <span className="text-sm font-semibold text-teal-300">Diagnostics</span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openProbe}
            className="rounded border border-neutral-600 bg-neutral-800 px-2 py-1 text-xs text-teal-300 hover:bg-neutral-700"
          >
            Open /sw.js?v=build
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
      <pre className="m-0 w-full overflow-visible whitespace-pre-wrap break-words p-4 text-left text-[11px] leading-relaxed sm:text-xs">
        {diagnosticsText}
      </pre>
    </section>
  )
}

export function DiagnosticsMessageBoxProvider({ children }: { children: React.ReactNode }) {
  const [diagnosticsText, setDiagnosticsText] = useState('')

  const appendDiagnostics = useCallback((section: string) => {
    const stamp = new Date().toISOString()
    setDiagnosticsText((prev) => {
      const block = `[${stamp}]\n${section}`
      return prev ? `${prev}\n\n${block}` : block
    })
  }, [])

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
