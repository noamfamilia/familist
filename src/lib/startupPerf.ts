import { isPwaDebugEnabled } from '@/lib/pwaDebug'

/** Schedule work after paint (does not block first paint). */
export function scheduleAfterFirstPaint(fn: () => void): void {
  if (typeof window === 'undefined') return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setTimeout(fn, 0)
    })
  })
}

/** Low-cost Performance marks; console only when PWA debug is on. */
export function markStartup(phase: string, detail?: Record<string, unknown>): void {
  if (typeof performance === 'undefined') return
  const name = `familist:${phase}`
  try {
    performance.mark(name)
  } catch {
    // ignore
  }
  if (isPwaDebugEnabled()) {
    const ms = Math.round(performance.now())
    if (detail && Object.keys(detail).length > 0) {
      console.info('[familist:startup]', phase, `${ms}ms`, detail)
    } else {
      console.info('[familist:startup]', phase, `${ms}ms`)
    }
  }
}
