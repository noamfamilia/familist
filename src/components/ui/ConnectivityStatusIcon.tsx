'use client'

import { WifiOnIcon, WifiSlashIcon } from '@/components/ui/ConnectivityWifiIcons'
import { useConnectivity } from '@/providers/ConnectivityProvider'

/**
 * Mirrors ConnectivityProvider state machine (not navigator alone):
 * - offline: red wifi-slash
 * - recovering: cyan wifi-on for the whole recovery phase (no 5s auto-hide)
 * - online: hidden
 */
export function ConnectivityStatusIcon({ className }: { className?: string }) {
  const { status } = useConnectivity()

  if (status === 'offline') {
    return (
      <span className={`inline-flex shrink-0 ${className ?? ''}`} role="img" aria-label="Offline">
        <WifiSlashIcon className="h-7 w-7 sm:h-8 sm:w-8 text-red-500" />
      </span>
    )
  }

  if (status === 'recovering') {
    return (
      <span className={`inline-flex shrink-0 ${className ?? ''}`} role="img" aria-label="Reconnecting">
        <WifiOnIcon className="h-7 w-7 sm:h-8 sm:w-8 text-cyan-500" />
      </span>
    )
  }

  return null
}

/** Slightly smaller for list page title row */
export function ConnectivityStatusIconCompact({ className }: { className?: string }) {
  const { status } = useConnectivity()

  if (status === 'offline') {
    return (
      <span className={`inline-flex shrink-0 ${className ?? ''}`} role="img" aria-label="Offline">
        <WifiSlashIcon className="h-6 w-6 sm:h-7 sm:w-7 text-red-500" />
      </span>
    )
  }

  if (status === 'recovering') {
    return (
      <span className={`inline-flex shrink-0 ${className ?? ''}`} role="img" aria-label="Reconnecting">
        <WifiOnIcon className="h-6 w-6 sm:h-7 sm:w-7 text-cyan-500" />
      </span>
    )
  }

  return null
}
