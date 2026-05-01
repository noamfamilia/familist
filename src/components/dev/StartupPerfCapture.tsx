'use client'

import { useEffect } from 'react'
import { markStartup } from '@/lib/startupPerf'

/** First-client-mount timing (approximates post-hydration / first paint window). */
export function StartupPerfCapture() {
  useEffect(() => {
    markStartup('layout_client_effect')
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        markStartup('after_second_raf')
      })
    })
    return () => cancelAnimationFrame(id)
  }, [])
  return null
}
