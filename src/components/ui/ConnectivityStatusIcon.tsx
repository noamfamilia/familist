'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { WifiOnIcon, WifiSlashIcon } from '@/components/ui/ConnectivityWifiIcons'

function subscribeNavigatorOnline(cb: () => void) {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

function getNavigatorOnlineSnapshot() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}

function getNavigatorOnlineServerSnapshot() {
  return true
}

const ONLINE_BRIEF_MS = 5000

function useOnlineBriefPulse() {
  const online = useSyncExternalStore(
    subscribeNavigatorOnline,
    getNavigatorOnlineSnapshot,
    getNavigatorOnlineServerSnapshot,
  )
  const prevOnlineRef = useRef(online)
  const [showBriefOnline, setShowBriefOnline] = useState(false)

  useEffect(() => {
    const prev = prevOnlineRef.current
    prevOnlineRef.current = online
    if (prev === false && online === true) {
      setShowBriefOnline(true)
      const t = window.setTimeout(() => setShowBriefOnline(false), ONLINE_BRIEF_MS)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [online])

  return { online, showBriefOnline }
}

/** Offline: red wifi-slash. After reconnecting from offline: cyan wifi ~5s, then hidden. */
export function ConnectivityStatusIcon({ className }: { className?: string }) {
  const { online, showBriefOnline } = useOnlineBriefPulse()

  if (!online) {
    return (
      <span className={`inline-flex shrink-0 ${className ?? ''}`} role="img" aria-label="No network">
        <WifiSlashIcon className="h-7 w-7 sm:h-8 sm:w-8 text-red-500" />
      </span>
    )
  }

  if (showBriefOnline) {
    return (
      <span className={`inline-flex shrink-0 ${className ?? ''}`} role="img" aria-label="Back online">
        <WifiOnIcon className="h-7 w-7 sm:h-8 sm:w-8 text-cyan-500" />
      </span>
    )
  }

  return null
}

/** Slightly smaller for list page title row */
export function ConnectivityStatusIconCompact({ className }: { className?: string }) {
  const { online, showBriefOnline } = useOnlineBriefPulse()

  if (!online) {
    return (
      <span className={`inline-flex shrink-0 ${className ?? ''}`} role="img" aria-label="No network">
        <WifiSlashIcon className="h-6 w-6 sm:h-7 sm:w-7 text-red-500" />
      </span>
    )
  }

  if (showBriefOnline) {
    return (
      <span className={`inline-flex shrink-0 ${className ?? ''}`} role="img" aria-label="Back online">
        <WifiOnIcon className="h-6 w-6 sm:h-7 sm:w-7 text-cyan-500" />
      </span>
    )
  }

  return null
}
