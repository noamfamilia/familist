/**
 * Navigation diagnostics after the browser has been offline at least once this tab
 * (`navigator.onLine === false` arms the session; logging continues if the user goes
 * back online, so full A→E offline navigation traces are captured).
 *
 * Registered by DiagnosticsMessageBoxProvider to forward into the nav log.
 */

import { DIAGNOSTICS_DATA_COLLECTION_ENABLED, isDebugVerboseEnabled } from '@/lib/diagnosticsFlags'

type Sink = (section: string) => void

let sink: Sink | null = null
let lastDiagnosticPerfNow: number | null = null

export function registerOfflineNavDiagnosticSink(fn: Sink | null) {
  sink = fn
}

export function appendOfflineNavDiagnostic(section: string) {
  // Legacy diagnostics are intentionally suppressed.
  void section
}

export function appendMutationDiagnostic(section: string) {
  if (!DIAGNOSTICS_DATA_COLLECTION_ENABLED) return
  const line = formatDiagnosticLine(section)
  if (line) sink?.(line)
}

/** List-detail cache breakdown: always forwarded when diagnostics sink is registered (no offline-session gate). */
export function appendListDetailCacheDiagnostic(section: string) {
  if (!DIAGNOSTICS_DATA_COLLECTION_ENABLED) return
  const line = formatDiagnosticLine(section)
  if (line) sink?.(line)
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR'

function utcClock(now: Date): string {
  return now.toISOString().slice(11, 19) + 'Z'
}

function levelFromMessage(message: string): LogLevel {
  if (/error|fail|exception|denied/i.test(message)) return 'ERROR'
  if (/warn|retry|defer|timeout/i.test(message)) return 'WARN'
  return 'INFO'
}

function namespaceFromMessage(message: string): string {
  if (/\[sync->server\]|sync|mirror|queue/i.test(message)) return 'SYNC'
  if (/dexie|db|bulkadd|bulkput|\.put\(|\.update\(/i.test(message)) return 'DB'
  if (/fetchlists|fetchlist|get_list_data/i.test(message)) return 'DB'
  if (/mutation/i.test(message)) return 'MUTATION'
  return 'APP'
}

function shouldEmit(level: LogLevel, namespace: string, message: string): boolean {
  if (level === 'ERROR') return true
  if (namespace === 'SYNC') return true
  if (!isDebugVerboseEnabled() && /\bgate\b/i.test(message)) return false
  return true
}

function emojiFor(level: LogLevel, namespace: string, message: string): string {
  if (level === 'ERROR') return '🔴'
  if (namespace === 'SYNC' || /sync|mirror|queue/i.test(message)) return '🔄'
  if (namespace === 'DB') return '💾'
  return ''
}

function inlineErrorMessage(message: string): string {
  const m = message.match(/(?:msg|message|error|err)=([^ ]+)/i)
  if (!m) return message
  const detail = m[1]?.trim()
  if (!detail || message.includes('::')) return message
  return `${message} :: ${detail}`
}

function formatDiagnosticLine(section: string): string | null {
  const nowPerf = typeof performance !== 'undefined' ? performance.now() : null
  const deltaMs = nowPerf == null || lastDiagnosticPerfNow == null ? null : Math.round(nowPerf - lastDiagnosticPerfNow)
  if (nowPerf != null) lastDiagnosticPerfNow = nowPerf
  const level = levelFromMessage(section)
  const namespace = namespaceFromMessage(section)
  const message = inlineErrorMessage(section)
  if (!shouldEmit(level, namespace, message)) return null
  const emoji = emojiFor(level, namespace, message)
  const prefix = `[${utcClock(new Date())}] [+${
    deltaMs == null ? 'n/a' : String(deltaMs)
  }ms] [${level}] [${namespace}]`
  return emoji ? `${prefix} ${emoji} ${message}` : `${prefix} ${message}`
}
