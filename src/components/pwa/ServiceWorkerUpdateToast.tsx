'use client'

import { useEffect, useRef } from 'react'
import { useToast } from '@/components/ui/Toast'

const PWA_ENABLED = process.env.NEXT_PUBLIC_PWA_ENABLED === 'true'

/**
 * Shows a persistent "New version ready" toast when an updated service worker takes over
 * mid-session (`skipWaiting` + `clientsClaim` activate it as soon as it installs). The page
 * keeps running the old build until reloaded, so the toast offers a one-tap refresh.
 */
export function ServiceWorkerUpdateToast() {
  const { showToast } = useToast()
  const shownRef = useRef(false)

  useEffect(() => {
    if (!PWA_ENABLED) return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !navigator.serviceWorker) {
      return
    }

    // The first-ever SW install also fires `controllerchange` (via clientsClaim); only a
    // controller *replacement* means a new app version, so require a pre-existing controller.
    let wasControlled = !!navigator.serviceWorker.controller

    const onControllerChange = () => {
      const previouslyControlled = wasControlled
      wasControlled = true
      if (!previouslyControlled || shownRef.current) return
      shownRef.current = true
      showToast('New version ready', 'info', {
        durationMs: 0,
        tapToAction: true,
        action: { label: 'Refresh', onClick: () => window.location.reload() },
      })
    }

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [showToast])

  return null
}
