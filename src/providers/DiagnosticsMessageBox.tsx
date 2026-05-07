'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import {
  DIAGNOSTICS_DATA_COLLECTION_ENABLED,
  DIAGNOSTICS_PANEL_VISIBLE,
} from '@/lib/diagnosticsFlags'
import { DiagnosticOverlay } from '@/components/dev/DiagnosticOverlay'

const DIAG_TEXT_MAX_CHARS = 120_000

type DiagnosticsContextValue = {
  diagnosticsText: string
  appendDiagnostics: (section: string) => void
  clearDiagnostics: () => void
}

const DiagnosticsContext = createContext<DiagnosticsContextValue | undefined>(undefined)

function DiagnosticsMessageBoxPanel() {
  return <DiagnosticOverlay />
}

export function DiagnosticsMessageBoxProvider({ children }: { children: React.ReactNode }) {
  const [diagnosticsText, setDiagnosticsText] = useState('')

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

  const clearDiagnostics = useCallback(() => {
    setDiagnosticsText('')
  }, [])

  const value = useMemo(
    () => ({ diagnosticsText, appendDiagnostics, clearDiagnostics }),
    [diagnosticsText, appendDiagnostics, clearDiagnostics],
  )

  return (
    <DiagnosticsContext.Provider value={value}>
      {children}
      {DIAGNOSTICS_PANEL_VISIBLE ? <DiagnosticsMessageBoxPanel /> : null}
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
