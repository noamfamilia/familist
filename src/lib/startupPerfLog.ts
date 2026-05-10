/**
 * Startup performance log: elapsed ms from `markClientBootStart()` (import instrument-client-boot first).
 * Lines are buffered until a UI sink registers (see DiagnosticsMessageBoxProvider).
 */

import { DIAGNOSTICS_DATA_COLLECTION_ENABLED, isDebugVerboseEnabled } from '@/lib/diagnosticsFlags'

let bootT0: number | null = null
const pendingLines: string[] = []
const PENDING_CAP = 50

type PerfSink = (line: string) => void
let sink: PerfSink | null = null

/** Call once from the earliest client chunk (see instrument-client-boot.ts). */
export function markClientBootStart(): void {
  if (bootT0 == null && typeof performance !== 'undefined') {
    bootT0 = performance.now()
  }
}

export function registerPerfLogSink(fn: PerfSink | null): void {
  sink = fn
  if (fn && pendingLines.length > 0) {
    for (const line of pendingLines.splice(0, pendingLines.length)) {
      fn(line)
    }
  }
}

function ensureBootT0(): void {
  if (bootT0 == null && typeof performance !== 'undefined') {
    bootT0 = performance.now()
  }
}

/** Elapsed ms from first perfLog (boot reference). */
export function perfLog(label: string, extra: Record<string, unknown> = {}): void {
  const namespace = namespaceFromLabel(label)
  const msg = withInlineErrorMessage(label, extra)
  log.info(namespace, msg, extra)
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR'

function utcClock(now: Date): string {
  return now.toISOString().slice(11, 19) + 'Z'
}

function relativeMs(): number {
  ensureBootT0()
  const t0 = bootT0 ?? 0
  return Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0)
}

function namespaceFromLabel(label: string): string {
  const first = label.split(/[ /:_-]/).find(Boolean) ?? 'APP'
  const upper = first.toUpperCase()
  if (upper.startsWith('FETCH')) return 'DB'
  if (upper.includes('SYNC')) return 'SYNC'
  if (upper.includes('DEXIE')) return 'DEXIE'
  return upper.slice(0, 24)
}

function hasGateKeyword(text: string): boolean {
  return /\bgate\b/i.test(text)
}

function withInlineErrorMessage(message: string, extra?: Record<string, unknown>): string {
  if (!extra) return message
  const err = extra.error
  const errMsg =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : typeof extra.message === 'string'
          ? extra.message
          : null
  if (!errMsg) return message
  return `${message} :: ${errMsg}`
}

function emojiFor(level: LogLevel, namespace: string, message: string): string {
  if (level === 'ERROR') return '🔴'
  if (/SYNC|MIRROR|QUEUE/i.test(namespace) || /sync|mirror|queue/i.test(message)) return '🔄'
  if (/DEXIE|DB/i.test(namespace) || /dexie|db\.|bulkPut|bulkAdd|put|write/i.test(message)) return '💾'
  return ''
}

function shouldEmit(level: LogLevel, namespace: string, message: string): boolean {
  if (!DIAGNOSTICS_DATA_COLLECTION_ENABLED) return false
  if (level === 'ERROR') return true
  if (level === 'WARN') return true
  /** INFO perf/UI traces only in verbose mode; use `emitServerRoundTripLine` / `logServerRoundTrip` for server I/O. */
  if (level === 'INFO' && !isDebugVerboseEnabled()) return false
  if (!isDebugVerboseEnabled() && hasGateKeyword(`${namespace} ${message}`)) return false
  return true
}

function emitLine(line: string): void {
  if (sink) {
    sink(line)
  } else {
    pendingLines.push(line)
    while (pendingLines.length > PENDING_CAP) pendingLines.shift()
  }
}

/** Compact `[server] …` lines: always mirrored to the perf sink and `console.info` when diagnostics are on. */
export function emitServerRoundTripLine(line: string): void {
  if (!DIAGNOSTICS_DATA_COLLECTION_ENABLED) return
  emitLine(line)
  if (typeof console !== 'undefined' && typeof console.info === 'function') {
    console.info(line)
  }
}

function writeLog(level: LogLevel, namespace: string, message: string, extra?: Record<string, unknown>): void {
  const msg = withInlineErrorMessage(message, extra)
  if (!shouldEmit(level, namespace, msg)) return
  const now = new Date()
  const emoji = emojiFor(level, namespace, msg)
  const rel = relativeMs()
  const prefix = `[${utcClock(now)}] [+${rel}ms] [${level}] [${namespace}]`
  const json = extra && Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : ''
  const decorated = emoji ? `${emoji} ${msg}` : msg
  emitLine(`${prefix} ${decorated}${json}`)
}

export const log = {
  info(namespace: string, message: string, extra: Record<string, unknown> = {}) {
    writeLog('INFO', namespace.toUpperCase(), message, extra)
  },
  warn(namespace: string, message: string, extra: Record<string, unknown> = {}) {
    writeLog('WARN', namespace.toUpperCase(), message, extra)
  },
  error(namespace: string, message: string, extra: Record<string, unknown> = {}) {
    writeLog('ERROR', namespace.toUpperCase(), message, extra)
  },
}
