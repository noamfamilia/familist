/**
 * Navigation diagnostics after the browser has been offline at least once this tab
 * (`navigator.onLine === false` arms the session; logging continues if the user goes
 * back online, so full A→E offline navigation traces are captured).
 *
 * Registered by DiagnosticsMessageBoxProvider to forward into the nav log.
 */

type Sink = (section: string) => void

let sink: Sink | null = null
let offlineNavSessionArmed = false

export function registerOfflineNavDiagnosticSink(fn: Sink | null) {
  sink = fn
}

export function appendOfflineNavDiagnostic(section: string) {
  if (typeof navigator === 'undefined') return
  if (!navigator.onLine) offlineNavSessionArmed = true
  if (!offlineNavSessionArmed) return
  sink?.(section)
}
