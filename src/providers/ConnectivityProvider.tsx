'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import { collectPwaDiagnostics } from '@/lib/pwaDiagnostics'
import { useDiagnosticsMessageBox } from '@/providers/DiagnosticsMessageBox'
import { USER_MUTATION_WAIT_MSG } from '@/lib/userMutationGate'

type ConnectivityStatus = 'online' | 'syncing' | 'offline'

const CONNECTIVITY_STATUS_KEY = 'familist_connectivity_status'
const TEMP_SYNC_TIMEOUT_MS = 10000
const OFFLINE_TOAST_DURATION_MS = 60 * 60 * 1000
const OFFLINE_PING_INTERVAL_MS = 10000
const OFFLINE_ACTIONS_DISABLED_MSG = 'Offline (actions disabled)'
const SW_STATUS_REQUEST = 'SW_OFFLINE_ASSETS_STATUS_REQUEST'
const SW_STATUS_RESPONSE = 'SW_OFFLINE_ASSETS_STATUS_RESPONSE'

type ConnectivityContextType = {
  status: ConnectivityStatus
  isOfflineActionsDisabled: boolean
  swControlled: boolean
  enterOffline: () => void
  markOnlineRecovered: () => void
  startTempSyncWatch: () => void
  canMutateNow: () => boolean
  blockedMutationMessage: () => string
  offlineAssetsReady: boolean
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
  const { showToast, dismissToast, clearToasts, warning: showWarning } = useToast()
  const { appendDiagnostics } = useDiagnosticsMessageBox()
  const [status, setStatus] = useState<ConnectivityStatus>('online')
  const [offlineAssetsReady, setOfflineAssetsReady] = useState(false)
  const [swControlled, setSwControlled] = useState(false)
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

  const requestOfflineAssetsReady = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
      setOfflineAssetsReady(false)
      setSwControlled(false)
      return
    }
    const controlled = !!navigator.serviceWorker.controller
    setSwControlled(controlled)
    if (!controlled) {
      setOfflineAssetsReady(false)
      return
    }
    navigator.serviceWorker.controller.postMessage({ type: SW_STATUS_REQUEST })
  }, [])

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

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return

    const onMessage = (event: MessageEvent) => {
      const data = event.data || {}
      if (data.type !== SW_STATUS_RESPONSE) return
      setOfflineAssetsReady(Boolean(data.ready))
    }

    const onControllerChange = () => {
      requestOfflineAssetsReady()
    }

    navigator.serviceWorker.addEventListener('message', onMessage)
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    requestOfflineAssetsReady()

    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage)
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [requestOfflineAssetsReady])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return
    if (!navigator.onLine) return
    if (navigator.serviceWorker.controller) return

    const promptKey = 'familist_sw_uncontrolled_prompted'
    try {
      if (sessionStorage.getItem(promptKey) === '1') return
      sessionStorage.setItem(promptKey, '1')
    } catch {
      // Ignore storage errors
    }

    navigator.serviceWorker.ready.then(() => {
      if (navigator.serviceWorker.controller) return
      showWarning('Offline access is not ready. Open the app once while online.')
      showToast('Tap to reload and enable offline mode', 'info', {
        durationMs: 7000,
        action: {
          label: 'Reload',
          onClick: () => window.location.reload(),
        },
      })
    }).catch(() => {
      // Ignore readiness errors
    })
  }, [showToast, showWarning])

  /** Origin/CDN diagnostics + explicit SW registration (same URL next-pwa uses, no query string). */
  useEffect(() => {
    let cancelled = false

    const run = async () => {
      try {
        let appendPwaBlock = true
        try {
          if (sessionStorage.getItem('familist_pwa_diag_banner') === '1') {
            appendPwaBlock = false
          } else {
            sessionStorage.setItem('familist_pwa_diag_banner', '1')
          }
        } catch {
          appendPwaBlock = true
        }

        const d = await collectPwaDiagnostics()
        if (cancelled) return
        console.log('[PWA DIAG]', d)

        if (appendPwaBlock) {
          appendDiagnostics(`[PWA DIAG]\n${JSON.stringify(d, null, 2)}`)
        }

        if (!('serviceWorker' in navigator)) {
          if (appendPwaBlock) {
            appendDiagnostics('pwa: no serviceWorker in navigator')
          }
          return
        }

        try {
          const reg = await navigator.serviceWorker.register(d.swRegistrationUrl, { scope: '/' })
          if (cancelled) return
          console.log('[PWA] explicit register ok', reg.scope, reg.active?.scriptURL)
          appendDiagnostics(
            `sw-reg OK\nscope=${reg.scope}\nactive=${reg.active?.scriptURL ?? 'null'}\nwaiting=${reg.waiting?.scriptURL ?? 'null'}`,
          )
        } catch (e) {
          if (cancelled) return
          const msg = e instanceof Error ? e.message : String(e)
          appendDiagnostics(`sw-reg FAIL\n${msg}`)
        }
      } catch (e) {
        console.error('[PWA DIAG] failed', e)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [appendDiagnostics])

  return (
    <ConnectivityContext.Provider
      value={{
        status,
        isOfflineActionsDisabled: status === 'offline',
        swControlled,
        enterOffline,
        markOnlineRecovered,
        startTempSyncWatch,
        canMutateNow,
        blockedMutationMessage,
        offlineAssetsReady,
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

