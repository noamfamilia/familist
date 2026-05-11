/** Nested body `overflow: hidden` for fixed overlays/modals (ref-counted). */

let lockCount = 0
let savedOverflow = ''

export function pushBodyScrollLock(): void {
  if (typeof document === 'undefined') return
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  lockCount++
}

export function popBodyScrollLock(): void {
  if (typeof document === 'undefined') return
  if (lockCount <= 0) return
  lockCount--
  if (lockCount === 0) {
    document.body.style.overflow = savedOverflow
  }
}
