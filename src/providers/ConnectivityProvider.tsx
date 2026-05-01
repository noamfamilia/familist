'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import { USER_MUTATION_WAIT_MSG } from '@/lib/userMutationGate'

type ConnectivityStatus = 'online' | 'syncing' | 'offline'

const CONNECTIVITY_STATUS_KEY = 'familist_connectivity_status'
const TEMP_SYNC_TIMEOUT_MS = 10000
const OFFLINE_TOAST_DURATION_MS = 60 * 60 * 1000
const OFFLINE_PING_INTERVAL_MS = 10000
const OFFLINE_ACTIONS_DISABLED_MSG = 'Offline (actions disabled)'

type ConnectivityContextType = {
  status: ConnectivityStatus
  isOfflineActionsDisabled: boolean
  enterOffline: () => void
  markOnlineRecovered: () => void
  startTempSyncWatch: () => void
  canMutateNow: () => boolean
  blockedMutationMessage: () => string
}

const ConnectivityContext = createContext<ConnectivityContextType | undefined>(undefined)

async function probeInternetReachable(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false
  try {
    const res = await fetch('/manifest.json', { cache: 'no-store' })
    return res.ok
  } catch {
    return false
  }
}

export function ConnectivityProvider({ children }: { children: React.ReactNode }) {
  const { showToast, dismissToast, clearToasts } = useToast()
  const [status, setStatus] = useState<ConnectivityStatus>('online')
  const syncToastIdRef = useRef<string | null>(null)
  const offlineToastIdRef = useRef<string | null>(null)
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const offlinePingIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const dismissSyncingToast = useCallback(() => {
    if (!syncToastIdRef.current) return
    dismissToast(syncToastIdRef.current)
    syncToastIdRef.current = null
  }, [dismissToast])

  const dismissOfflineToast = useCallback(() => {
    if (!offlineToastIdRef.current) return
    dismissToast(offlineToastIdRef.current)
    offlineToastIdRef.current = null
  }, [dismissToast])

  const clearSyncTimeout = useCallback(() => {
    if (!syncTimeoutRef.current) return
    clearTimeout(syncTimeoutRef.current)
    syncTimeoutRef.current = null
  }, [])

  const clearOfflinePing = useCallback(() => {
    if (!offlinePingIntervalRef.current) return
    clearInterval(offlinePingIntervalRef.current)
    offlinePingIntervalRef.current = null
  }, [])

  const markOnlineRecovered = useCallback(() => {
    clearSyncTimeout()
    dismissSyncingToast()
    clearOfflinePing()
    const wasOffline = status === 'offline'
    dismissOfflineToast()
    setStatus('online')
    try {
      localStorage.setItem(CONNECTIVITY_STATUS_KEY, 'online')
    } catch {
      // Ignore storage errors
    }
    if (wasOffline) {
      showToast('Back online', 'success', { durationMs: 3000 })
    }
  }, [clearOfflinePing, clearSyncTimeout, dismissOfflineToast, dismissSyncingToast, showToast, status])

  const enterOffline = useCallback(() => {
    clearSyncTimeout()
    dismissSyncingToast()
    clearToasts()
    offlineToastIdRef.current = null
    setStatus('offline')
    try {
      localStorage.setItem(CONNECTIVITY_STATUS_KEY, 'offline')
    } catch {
      // Ignore storage errors
    }
    offlineToastIdRef.current = showToast('Offline (actions disabled)', 'error', {
      durationMs: OFFLINE_TOAST_DURATION_MS,
    })
    if (!offlinePingIntervalRef.current) {
      offlinePingIntervalRef.current = setInterval(() => {
        void probeInternetReachable().then((ok) => {
          if (ok) markOnlineRecovered()
        })
      }, OFFLINE_PING_INTERVAL_MS)
    }
  }, [clearSyncTimeout, clearToasts, dismissSyncingToast, markOnlineRecovered, showToast])

  const startTempSyncWatch = useCallback(() => {
    if (status === 'offline') return
    if (status !== 'syncing') setStatus('syncing')
    if (!syncToastIdRef.current) {
      syncToastIdRef.current = showToast('Syncing with server ...', 'info', { durationMs: TEMP_SYNC_TIMEOUT_MS + 1000 })
    }
    if (syncTimeoutRef.current) return
    syncTimeoutRef.current = setTimeout(() => {
      syncTimeoutRef.current = null
      enterOffline()
    }, TEMP_SYNC_TIMEOUT_MS)
  }, [enterOffline, showToast, status])

  const canMutateNow = useCallback(() => {
    if (status === 'offline') {
      return false
    }
    return true
  }, [status])

  const blockedMutationMessage = useCallback(() => (
    status === 'offline' ? OFFLINE_ACTIONS_DISABLED_MSG : USER_MUTATION_WAIT_MSG
  ), [status])

  useEffect(() => {
    try {
      if (localStorage.getItem(CONNECTIVITY_STATUS_KEY) === 'offline') {
        setStatus('offline')
        enterOffline()
      }
    } catch {
      // Ignore storage errors
    }
    const onOffline = () => enterOffline()
    const onOnline = () => {
      void probeInternetReachable().then((ok) => {
        if (ok) markOnlineRecovered()
      })
    }
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      enterOffline()
    }
    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      clearSyncTimeout()
      clearOfflinePing()
    }
  }, [clearOfflinePing, clearSyncTimeout, enterOffline, markOnlineRecovered])

  return (
    <ConnectivityContext.Provider
      value={{
        status,
        isOfflineActionsDisabled: status === 'offline',
        enterOffline,
        markOnlineRecovered,
        startTempSyncWatch,
        canMutateNow,
        blockedMutationMessage,
      }}
    >
      {children}
    </ConnectivityContext.Provider>
  )
}

export function useConnectivity() {
  const context = useContext(ConnectivityContext)
  if (!context) throw new Error('useConnectivity must be used within ConnectivityProvider')
  return context
}

