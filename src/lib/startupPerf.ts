/** Schedule work after paint (does not block first paint). */
export function scheduleAfterFirstPaint(fn: () => void): void {
  if (typeof window === 'undefined') return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setTimeout(fn, 0)
    })
  })
}
