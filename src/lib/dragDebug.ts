/**
 * Opt-in list item drag snap diagnostics.
 * Enable with localStorage.DEBUG_DRAG = "1" or URL ?debugDrag=1 (reload if needed).
 */

export function isDragDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (new URLSearchParams(window.location.search).get('debugDrag') === '1') return true
  } catch {
    // ignore
  }
  try {
    return window.localStorage.getItem('DEBUG_DRAG') === '1'
  } catch {
    return false
  }
}
