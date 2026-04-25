'use client'

import { useState, useEffect } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showBanner, setShowBanner] = useState(false)
  const [isIOS, setIsIOS] = useState(false)

  useEffect(() => {
    // Only show on mobile devices
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    if (!isMobile) {
      return
    }

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      return
    }

    // Check if dismissed recently (within 7 days)
    const dismissed = localStorage.getItem('pwa-install-dismissed')
    if (dismissed) {
      const dismissedDate = new Date(dismissed)
      const daysSinceDismissed = (Date.now() - dismissedDate.getTime()) / (1000 * 60 * 60 * 24)
      if (daysSinceDismissed < 7) {
        return
      }
    }

    // Check for iOS
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream
    setIsIOS(isIOSDevice)

    if (isIOSDevice) {
      // iOS doesn't support beforeinstallprompt, show banner with instructions
      const isInStandaloneMode = ('standalone' in window.navigator) && (window.navigator as any).standalone
      if (!isInStandaloneMode) {
        setShowBanner(true)
      }
    } else {
      // Listen for install prompt event
      const handler = (e: Event) => {
        e.preventDefault()
        setDeferredPrompt(e as BeforeInstallPromptEvent)
        setShowBanner(true)
      }

      window.addEventListener('beforeinstallprompt', handler)
      return () => window.removeEventListener('beforeinstallprompt', handler)
    }
  }, [])

  const handleInstall = async () => {
    if (isIOS) {
      // Show iOS instructions
      alert('To install:\n1. Tap the Share button (□↑)\n2. Scroll down and tap "Add to Home Screen"')
      return
    }

    if (!deferredPrompt) return

    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice

    if (outcome === 'accepted') {
      setShowBanner(false)
    }
    setDeferredPrompt(null)
  }

  const handleDismiss = () => {
    setShowBanner(false)
    localStorage.setItem('pwa-install-dismissed', new Date().toISOString())
  }

  if (!showBanner) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-teal text-white px-4 py-3 flex items-center justify-between gap-3 z-50 shadow-lg dark:shadow-black/40">
      <span className="text-sm flex-1">
        Install MyFamiList for quick access
      </span>
      <button
        onClick={handleInstall}
        className="px-3 py-1.5 bg-white dark:bg-neutral-900 text-teal rounded-lg text-sm font-medium hover:bg-gray-100 dark:hover:bg-neutral-700"
      >
        Install
      </button>
      <button
        onClick={handleDismiss}
        className="text-white/80 hover:text-white text-xl leading-none"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
