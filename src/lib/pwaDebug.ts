/**
 * Opt-in PWA / SW diagnostics (heavy precache-verify, full diag panel).
 * Enable with localStorage.DEBUG_PWA = "1" or URL ?debugPwa=1 (then reload if needed).
 */

export function isPwaDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (new URLSearchParams(window.location.search).get('debugPwa') === '1') return true
  } catch {
    // ignore
  }
  try {
    return window.localStorage.getItem('DEBUG_PWA') === '1'
  } catch {
    return false
  }
}
