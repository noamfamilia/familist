/**
 * Navigation diagnostics after the browser has been offline at least once this tab
 * (`navigator.onLine === false` arms the session; logging continues if the user goes
 * back online, so full A→E offline navigation traces are captured).
 *
 * Registered by DiagnosticsMessageBoxProvider to forward into the nav log.
 */

import { DIAGNOSTICS_DATA_COLLECTION_ENABLED } from '@/lib/diagnosticsFlags'

type Sink = (section: string) => void

let sink: Sink | null = null
let offlineNavSessionArmed = false
let lastDiagnosticPerfNow: number | null = null

export function registerOfflineNavDiagnosticSink(fn: Sink | null) {
  sink = fn
}

export function appendOfflineNavDiagnostic(section: string) {
  if (!DIAGNOSTICS_DATA_COLLECTION_ENABLED) return
  if (typeof navigator === 'undefined') return
  if (!navigator.onLine) offlineNavSessionArmed = true
  if (!offlineNavSessionArmed) return
  const nowPerf = typeof performance !== 'undefined' ? performance.now() : null
  const deltaMs = nowPerf == null || lastDiagnosticPerfNow == null ? null : Math.round(nowPerf - lastDiagnosticPerfNow)
  if (nowPerf != null) lastDiagnosticPerfNow = nowPerf
  const prefix = `[time=${new Date().toISOString()} deltaMs=${deltaMs == null ? 'n/a' : String(deltaMs)}]`
  sink?.(`${prefix} ${section}`)
}

/** List-detail cache breakdown: always forwarded when diagnostics sink is registered (no offline-session gate). */
export function appendListDetailCacheDiagnostic(section: string) {
  if (!DIAGNOSTICS_DATA_COLLECTION_ENABLED) return
  const nowPerf = typeof performance !== 'undefined' ? performance.now() : null
  const deltaMs = nowPerf == null || lastDiagnosticPerfNow == null ? null : Math.round(nowPerf - lastDiagnosticPerfNow)
  if (nowPerf != null) lastDiagnosticPerfNow = nowPerf
  const prefix = `[time=${new Date().toISOString()} deltaMs=${deltaMs == null ? 'n/a' : String(deltaMs)}]`
  sink?.(`${prefix} ${section}`)
}
