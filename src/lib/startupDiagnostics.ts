/**
 * Opt-in startup perf / breakdown panel (no PWA heavy hooks required).
 * Enable: URL ?debugStartup=1 or localStorage DEBUG_STARTUP = "1" (reload if needed).
 */

export function isStartupDiagnosticsEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (new URLSearchParams(window.location.search).get('debugStartup') === '1') return true
  } catch {
    // ignore
  }
  try {
    return window.localStorage.getItem('DEBUG_STARTUP') === '1'
  } catch {
    return false
  }
}

export type PerfBreakdownRow = {
  tMs: number
  label: string
  deltaMs: number | null
  raw: string
}

/** Parse `[perf +Nms] label` lines into ordered rows with deltas. */
export function parsePerfLinesToBreakdown(perfLines: string[]): PerfBreakdownRow[] {
  const re = /^\[perf \+(\d+)ms\] (.+)$/
  const rows: PerfBreakdownRow[] = []
  let prevT: number | null = null

  for (const raw of perfLines) {
    const m = raw.match(re)
    if (!m) continue
    const tMs = Number(m[1])
    let label = m[2].trimEnd()
    const jsonTail = label.match(/^(.+?)\s(\{[\s\S]*\})$/)
    if (jsonTail?.[1] && jsonTail[2]?.startsWith('{')) {
      try {
        JSON.parse(jsonTail[2])
        label = jsonTail[1].trimEnd()
      } catch {
        // keep full label if not valid JSON
      }
    }
    const deltaMs = prevT === null ? null : tMs - prevT
    rows.push({ tMs, label, deltaMs, raw })
    prevT = tMs
  }
  return rows
}

export function formatBreakdownForCopy(rows: PerfBreakdownRow[]): string {
  if (rows.length === 0) return ''
  const lines = [
    '--- Startup breakdown (t+ = ms since boot, Δ = ms since previous row) ---',
    ['t+ms', 'Δms', 'step'].join('\t'),
    ...rows.map((r) => `${r.tMs}\t${r.deltaMs ?? '—'}\t${r.label}`),
  ]
  return lines.join('\n')
}
