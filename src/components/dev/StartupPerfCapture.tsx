'use client'

import '@/lib/instrument-client-boot'
import { perfLog } from '@/lib/startupPerfLog'
import { scheduleAfterFirstPaint } from '@/lib/startupPerf'
import { useEffect } from 'react'

/** Long tasks (>50ms) — only when PerformanceObserver supports `longtask`. */
function observeLongTasks(): void {
  if (typeof PerformanceObserver === 'undefined') return
  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        perfLog('LONG TASK', { durationMs: Math.round(entry.duration) })
      }
    })
    obs.observe({ entryTypes: ['longtask'] })
  } catch {
    // longtask not supported
  }
}

export function StartupPerfCapture() {
  useEffect(() => {
    observeLongTasks()
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        perfLog('first visible UI rendered')
      })
    })
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    scheduleAfterFirstPaint(() => {
      perfLog('IndexedDB read start')
      const t0 = performance.now()
      perfLog('IndexedDB read end', {
        durationMs: Math.round(performance.now() - t0),
        listCount: 0,
        itemCount: 0,
        reason: 'not used in app',
      })
    })
  }, [])

  return null
}
