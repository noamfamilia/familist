/**
 * In-memory connectivity / offline diagnostics for the Connectivity debug modal.
 * Always collected (no debug flag). Cleared only via the modal Clear control.
 */

const LOG_CAP = 400
const lines: string[] = []
const listeners = new Set<() => void>()

let lastPerfNow: number | null = null

function utcClock(now: Date): string {
  return now.toISOString().slice(11, 19) + 'Z'
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  }
}

function formatLine(message: string): string {
  const nowPerf = typeof performance !== 'undefined' ? performance.now() : null
  const deltaMs =
    nowPerf == null || lastPerfNow == null ? null : Math.round(nowPerf - lastPerfNow)
  if (nowPerf != null) lastPerfNow = nowPerf
  return `[${utcClock(new Date())}] [+${deltaMs == null ? 'n/a' : String(deltaMs)}ms] ${message}`
}

/** Append a raw diagnostic line (timestamp + delta added here). */
export function appendConnectivityDebugLine(section: string): void {
  const trimmed = section.trim()
  if (!trimmed) return
  lines.push(formatLine(trimmed))
  while (lines.length > LOG_CAP) lines.shift()
  notify()
}

export function getConnectivityDebugLines(): readonly string[] {
  return lines
}

export function clearConnectivityDebugLog(): void {
  lines.length = 0
  lastPerfNow = null
  notify()
}

export function subscribeConnectivityDebugLog(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const CONNECTIVITY_DEBUG_LOG_TITLE = 'Connectivity log:'

export function formatConnectivityDebugModalCopy(
  connectivityStatus: 'online' | 'recovering' | 'offline',
  logLines: readonly string[],
): string {
  const header = [CONNECTIVITY_DEBUG_LOG_TITLE, `connectivity: ${connectivityStatus}`]
  if (logLines.length === 0) {
    header.push('No connectivity events yet this session.')
    return header.join('\n')
  }
  return [...header, '', ...logLines].join('\n')
}
