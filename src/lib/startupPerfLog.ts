/**
 * Startup performance log: elapsed ms from `markClientBootStart()` (import instrument-client-boot first).
 * Lines are buffered until a UI sink registers (see DiagnosticsMessageBoxProvider).
 */

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
  ensureBootT0()
  const t0 = bootT0 ?? 0
  const t = Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0)
  const extraKeys = Object.keys(extra)
  const line =
    extraKeys.length > 0
      ? `[perf +${t}ms] ${label} ${JSON.stringify(extra)}`
      : `[perf +${t}ms] ${label}`
  // Match requested shape: log(`[perf +${t}ms] ${label}`, extra)
  if (extraKeys.length > 0) {
    console.info(`[perf +${t}ms] ${label}`, extra)
  } else {
    console.info(`[perf +${t}ms] ${label}`)
  }
  if (sink) {
    sink(line)
  } else {
    pendingLines.push(line)
    while (pendingLines.length > PENDING_CAP) pendingLines.shift()
  }
}
