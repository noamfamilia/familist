/**
 * Debug toggles for diagnostics / perf buffering.
 * For full legacy behavior, set **both** to `true` (panel + in-memory nav/perf buffers).
 */

/** When false, nav/perf lines are not appended to React state (no in-memory buffer growth). */
export const DIAGNOSTICS_DATA_COLLECTION_ENABLED = true

/** When false, the bottom diagnostics panel is not rendered. */
export const DIAGNOSTICS_PANEL_VISIBLE = true

const DEBUG_VERBOSE_STORAGE_KEY = 'DEBUG_VERBOSE'

function envVerboseDefault(): boolean {
  return process.env.NEXT_PUBLIC_DEBUG_VERBOSE === 'true'
}

/** Runtime check for noisy high-frequency debug logs (e.g. gate snapshots). */
export function isDebugVerboseEnabled(): boolean {
  if (typeof window === 'undefined') return envVerboseDefault()
  try {
    const raw = window.localStorage.getItem(DEBUG_VERBOSE_STORAGE_KEY)
    if (raw == null) return envVerboseDefault()
    return raw === 'true'
  } catch {
    return envVerboseDefault()
  }
}

export function setDebugVerboseEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DEBUG_VERBOSE_STORAGE_KEY, enabled ? 'true' : 'false')
  } catch {
    // ignore storage failures
  }
}
