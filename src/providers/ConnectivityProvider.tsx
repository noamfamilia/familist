'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useToast } from '@/components/ui/Toast'
import type { PwaDiagnostics } from '@/lib/pwaDiagnostics'
import { collectPwaDiagnostics } from '@/lib/pwaDiagnostics'
import { isPwaDebugEnabled, isPwaDeepDebugEnabled } from '@/lib/pwaDebug'
import { scheduleAfterFirstPaint } from '@/lib/startupPerf'
import { registerConnectivityFailureHandler } from '@/lib/connectivityFailureBridge'
import {
  bumpReadDiscardGeneration,
  registerConnectivityStatusForReads,
  type ConnectivityStatus as ServerReadConnectivityStatus,
} from '@/lib/data/serverReadPolicy'
import { registerProfileFetchOfflineHandler } from '@/lib/profileFetchConnectivityBridge'
import {
  RECOVERY_HEALTH_TIMEOUT_MS,
  runRecoveryHealthCheck,
} from '@/lib/recoveryHealthCheck'
import { runSwPrecacheVerification } from '@/lib/swPrecacheVerify'
import { appendConnectivityDebugLine } from '@/lib/connectivityDebugLog'
import {
  connectivityProbeDelayForStep,
  MAX_PROBE_BACKOFF_STEP,
  POST_ONLINE_PROBE_DELAY_MS,
} from '@/lib/connectivityBackoff'
import { scheduleOutboundSyncKick } from '@/lib/outboundSyncKick'
import {
  OFFLINE_ACTIONS_DISABLED_MSG,
  RECOVERING_MUTATIONS_DISABLED_MSG,
} from '@/lib/mutationToastPolicy'
import { USER_MUTATION_WAIT_MSG } from '@/lib/userMutationGate'
import type { ServerWorkOutcome } from '@/lib/connectivityErrors'

type ConnectivityStatus = 'online' | 'recovering' | 'offline'

/** Lie-fi: no successful / application server response while in-flight work runs (online/recovering only). */
const SERVER_PROGRESS_STALL_MS = 15_000

const CONNECTIVITY_STATUS_KEY = 'familist_connectivity_status'
const LEGACY_OFFLINE_WALL_PURGE_KEY = 'familist_legacy_offline_wall_purged_v2'
const SW_STATUS_REQUEST = 'SW_OFFLINE_ASSETS_STATUS_REQUEST'
const SW_STATUS_RESPONSE = 'SW_OFFLINE_ASSETS_STATUS_RESPONSE'
const SW_FALLBACK_REGISTER_COUNT_KEY = 'familist_sw_js_fallback_register_count'
/** Serwist registration appears asynchronously; avoid calling register() until this elapses with no registration */
const SW_NEXT_PWA_MAX_WAIT_MS = 12_000
const SW_NEXT_PWA_POLL_MS = 200
/** Extra getRegistration() checks before fallback to avoid racing Serwist registration */
const SW_FALLBACK_REGISTER_GRACE_MS = 600
/** When PWA debug is off, short poll only — do not block startup on long Serwist wait */
const SW_QUIET_MAX_WAIT_MS = 3_000
const SW_QUIET_POLL_MS = 500
const BOOT_ONLINE_GRACE_MS = 1_500
const OFFLINE_BANNER_DEBOUNCE_MS = 3_000
/** Online heartbeat + offline backoff probes (see recovery health 10s). */
const REACHABILITY_PROBE_TIMEOUT_MS = 5_000
const ONLINE_HEARTBEAT_INTERVAL_MS = 15_000
/** Minimum time the recovering icon stays visible after health succeeds, before going online. */
const RECOVERY_MIN_VISIBLE_MS = 1_000
const PWA_ENABLED = process.env.NEXT_PUBLIC_PWA_ENABLED === 'true'

function navigatorReportsOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Attach statechange + updatefound so we log installing → installed → activating → activated or redundant.
 * Listeners are deduped per ServiceWorker / ServiceWorkerRegistration instance.
 */
function createSwLifecycleHandlers() {
  const seenWorkers = new WeakSet<ServiceWorker>()
  const registrationsWithUpdateFound = new WeakSet<ServiceWorkerRegistration>()
  const disposers: Array<() => void> = []

  const attachWorker = (sw: ServiceWorker, label: string) => {
    if (seenWorkers.has(sw)) return
    seenWorkers.add(sw)
    const onState = () => {
      if (isPwaDebugEnabled()) {
        console.log('SW statechange', { label, state: sw.state, scriptURL: sw.scriptURL })
      }
      if (sw.state === 'redundant' && isPwaDebugEnabled()) {
        console.warn('[SW] redundant', sw.scriptURL)
      }
    }
    sw.addEventListener('statechange', onState)
    disposers.push(() => sw.removeEventListener('statechange', onState))
  }

  const attachToRegistration = (reg: ServiceWorkerRegistration) => {
    if (reg.installing) attachWorker(reg.installing, 'installing')
    if (reg.waiting) attachWorker(reg.waiting, 'waiting')
    if (reg.active) attachWorker(reg.active, 'active')
    if (!registrationsWithUpdateFound.has(reg)) {
      registrationsWithUpdateFound.add(reg)
      const onUpdateFound = () => {
        const w = reg.installing
        if (w) attachWorker(w, 'updatefound')
      }
      reg.addEventListener('updatefound', onUpdateFound)
      disposers.push(() => reg.removeEventListener('updatefound', onUpdateFound))
    }
  }

  return { attachToRegistration, dispose: () => disposers.forEach((d) => d()) }
}

function logFallbackSwRegister() {
  try {
    const n = Number(sessionStorage.getItem(SW_FALLBACK_REGISTER_COUNT_KEY) || '0') + 1
    sessionStorage.setItem(SW_FALLBACK_REGISTER_COUNT_KEY, String(n))
    if (n > 1 && isPwaDebugEnabled()) {
      console.warn(
        `[sw-register-fallback] fallback register() invoked ${n} times this tab — possible supersession race with serwist`,
      )
    }
  } catch {
    /* ignore */
  }
}

type ConnectivityContextType = {
  status: ConnectivityStatus
  online: boolean
  internetReachable: boolean | null
  /** True when connectivity status is `offline` (show offline indicator). */
  isOffline: boolean
  /** True when connectivity status is `recovering` (show cloud-only indicator). */
  isRecovering: boolean
  /** Legacy gate for dimming controls; kept false so offline UX stays fully interactive except sheet import. */
  isOfflineActionsDisabled: boolean
  /** When true, add/archive/restore item may be queued locally until status is online. */
  allowItemMutationQueue: boolean
  recoveryFetchGeneration: number
  swControlled: boolean
  enterOffline: (cause?: string) => void
  markOnlineRecovered: (cause?: string) => void
  /** Begin a tracked in-flight server request (Supabase RPC/query/mutation). */
  beginServerWork: () => void
  /** End tracked server work; success/application_error advance stall clock; connectivity_failure does not. */
  endServerWork: (outcome: ServerWorkOutcome) => void
  /** While in-flight work is active, bump stall clock after meaningful local progress (e.g. after RPC await, before slow IDB). */
  pulseServerWorkProgress: () => void
  startTempSyncWatch: () => void
  canMutateNow: () => boolean
  blockedMutationMessage: () => string
  offlineAssetsReady: boolean
  showOfflineBanner: boolean
}

const ConnectivityContext = createContext<ConnectivityContextType | undefined>(undefined)

async function probeInternetReachable(): Promise<boolean> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeoutId =
    controller != null
      ? setTimeout(() => {
          controller.abort()
        }, REACHABILITY_PROBE_TIMEOUT_MS)
      : null
  try {
    const probeUrl = `/api/reachability?ts=${Date.now()}`
    const res = await fetch(probeUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: controller?.signal,
      headers: {
        Accept: 'application/json',
      },
    })
    return res.ok
  } catch {
    return false
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId)
  }
}

export function ConnectivityProvider({ children }: { children: React.ReactNode }) {
  const { dismissToast } = useToast()
  const [hasMounted, setHasMounted] = useState(false)
  const [status, setStatus] = useState<ConnectivityStatus>('online')
  const [offlineAssetsReady, setOfflineAssetsReady] = useState(false)
  const [swControlled, setSwControlled] = useState(false)
  const [internetReachable, setInternetReachable] = useState<boolean | null>(null)
  const [showOfflineBanner, setShowOfflineBanner] = useState(false)

  useEffect(() => {
    setHasMounted(true)
  }, [])

  useLayoutEffect(() => {
    if (bootLoggedRef.current) return
    bootLoggedRef.current = true
    const onLine = typeof navigator !== 'undefined' ? navigator.onLine : true
    appendConnectivityDebugLine(
      `[connectivity] boot ConnectivityProvider mount initialStatus=online navigator.onLine=${onLine}`,
    )
  }, [])

  useEffect(() => {
    let cancelled = false
    const runLegacyOfflineWallPurge = async () => {
      if (typeof window === 'undefined' || !('caches' in window)) return
      try {
        if (localStorage.getItem(LEGACY_OFFLINE_WALL_PURGE_KEY) === '1') return
      } catch {
        // ignore storage access errors
      }
      try {
        const cacheNames = await caches.keys()
        for (const cacheName of cacheNames) {
          if (cancelled) return
          const cache = await caches.open(cacheName)
          const requests = await cache.keys()
          for (const req of requests) {
            const url = new URL(req.url)
            if (url.pathname === '/~offline') {
              await cache.delete(req)
            }
          }
        }
        try {
          localStorage.setItem(LEGACY_OFFLINE_WALL_PURGE_KEY, '1')
        } catch {
          // ignore storage access errors
        }
      } catch {
        // best-effort cleanup only
      }
    }
    void runLegacyOfflineWallPurge()
    return () => {
      cancelled = true
    }
  }, [])

  /** Bumped only when leaving `recovering` → `online` to refresh catalog once. */
  const [recoveryFetchGeneration, setRecoveryFetchGeneration] = useState(0)
  const bumpCatalogRefreshAfterOnline = useCallback(() => {
    setRecoveryFetchGeneration((n) => n + 1)
  }, [])

  const activeRecoveryFlightIdRef = useRef<string | null>(null)
  const recoveryAbortRef = useRef<AbortController | null>(null)
  const recoveryHealthTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recoveringEnteredAtRef = useRef(0)
  const startRecoveryHealthCheckRef = useRef<() => void>(() => {})

  const statusRef = useRef<ConnectivityStatus>('online')
  const bootStartedAtRef = useRef(Date.now())
  const bootLoggedRef = useRef(false)
  const offlineBannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    if (offlineBannerTimeoutRef.current) {
      clearTimeout(offlineBannerTimeoutRef.current)
      offlineBannerTimeoutRef.current = null
    }
    if (status !== 'offline') {
      setShowOfflineBanner(false)
      return
    }
    offlineBannerTimeoutRef.current = setTimeout(() => {
      if (statusRef.current === 'offline') {
        setShowOfflineBanner(true)
      }
    }, OFFLINE_BANNER_DEBOUNCE_MS)
    return () => {
      if (offlineBannerTimeoutRef.current) {
        clearTimeout(offlineBannerTimeoutRef.current)
        offlineBannerTimeoutRef.current = null
      }
    }
  }, [status])

  const serverWorkInFlightRef = useRef(0)
  const serverLastProgressAtRef = useRef(Date.now())
  const enterOfflineRef = useRef<(cause?: string) => void>(() => {})

  const beginServerWork = useCallback(() => {
    const prev = serverWorkInFlightRef.current
    serverWorkInFlightRef.current += 1
    if (
      prev === 0 &&
      (statusRef.current === 'online' || statusRef.current === 'recovering')
    ) {
      serverLastProgressAtRef.current = Date.now()
    }
  }, [])

  const endServerWork = useCallback((outcome: ServerWorkOutcome) => {
    if (outcome === 'success' || outcome === 'application_error') {
      if (statusRef.current === 'online' || statusRef.current === 'recovering') {
        serverLastProgressAtRef.current = Date.now()
      }
    }
    serverWorkInFlightRef.current = Math.max(0, serverWorkInFlightRef.current - 1)
  }, [])

  const pulseServerWorkProgress = useCallback(() => {
    if (serverWorkInFlightRef.current <= 0) return
    if (statusRef.current !== 'online' && statusRef.current !== 'recovering') return
    serverLastProgressAtRef.current = Date.now()
  }, [])

  const syncToastIdRef = useRef<string | null>(null)
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const probeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const probeInFlightRef = useRef(false)
  const probeStepRef = useRef(0)
  const consecutiveProbeFailuresRef = useRef(0)
  const lastNetworkSuccessAtRef = useRef(Date.now())
  /** After `window` `online` (or tab visible while browser reports online), next probe uses POST_ONLINE_PROBE_DELAY_MS. */
  const useNextProbeDelay1sRef = useRef(false)
  /** While true, first probe failure after post-online schedule must not advance backoff step (next wait stays 1s). */
  const skipNextProbeStepIncrementRef = useRef(false)
  const scheduleNextProbeRef = useRef<() => void>(() => {})

  const dismissSyncingToast = useCallback(() => {
    if (!syncToastIdRef.current) return
    dismissToast(syncToastIdRef.current)
    syncToastIdRef.current = null
  }, [dismissToast])

  const clearSyncTimeout = useCallback(() => {
    if (!syncTimeoutRef.current) return
    clearTimeout(syncTimeoutRef.current)
    syncTimeoutRef.current = null
  }, [])

  const clearProbeSchedule = useCallback(() => {
    if (!probeTimeoutRef.current) return
    clearTimeout(probeTimeoutRef.current)
    probeTimeoutRef.current = null
  }, [])

  const clearRecoveryHealthTimeout = useCallback(() => {
    if (!recoveryHealthTimeoutRef.current) return
    clearTimeout(recoveryHealthTimeoutRef.current)
    recoveryHealthTimeoutRef.current = null
  }, [])

  const cancelRecoveryHealth = useCallback(() => {
    clearRecoveryHealthTimeout()
    activeRecoveryFlightIdRef.current = null
    recoveryAbortRef.current?.abort()
    recoveryAbortRef.current = null
  }, [clearRecoveryHealthTimeout])

  const markOnlineRecovered = useCallback((cause = 'unknown') => {
    const prev = statusRef.current
    cancelRecoveryHealth()
    clearSyncTimeout()
    dismissSyncingToast()
    clearProbeSchedule()
    probeStepRef.current = 0
    consecutiveProbeFailuresRef.current = 0
    probeInFlightRef.current = false
    useNextProbeDelay1sRef.current = false
    skipNextProbeStepIncrementRef.current = false
    lastNetworkSuccessAtRef.current = Date.now()
    setInternetReachable(true)
    statusRef.current = 'online'
    setStatus('online')
    try {
      localStorage.setItem(CONNECTIVITY_STATUS_KEY, 'online')
    } catch {
      // Ignore storage errors
    }
    if (prev === 'recovering') {
      bumpCatalogRefreshAfterOnline()
    }
    scheduleOutboundSyncKick(`mark-online-recovered:${cause}`)
  }, [
    
    bumpCatalogRefreshAfterOnline,
    cancelRecoveryHealth,
    clearProbeSchedule,
    clearSyncTimeout,
    dismissSyncingToast,
  ])

  const startRecoveryHealthCheck = useCallback(() => {
    cancelRecoveryHealth()
    const flightId = crypto.randomUUID()
    activeRecoveryFlightIdRef.current = flightId
    const abortController = new AbortController()
    recoveryAbortRef.current = abortController

    bumpReadDiscardGeneration('enter-recovering')
    recoveringEnteredAtRef.current = Date.now()
    statusRef.current = 'recovering'
    flushSync(() => {
      setStatus('recovering')
    })

    void (async () => {
      if (activeRecoveryFlightIdRef.current !== flightId) return
      if (abortController.signal.aborted) return

      recoveryHealthTimeoutRef.current = setTimeout(() => {
        if (activeRecoveryFlightIdRef.current !== flightId) return
        enterOfflineRef.current('recovery-health-timeout')
      }, RECOVERY_HEALTH_TIMEOUT_MS)

      const result = await runRecoveryHealthCheck(flightId, abortController.signal)
      if (activeRecoveryFlightIdRef.current !== flightId) return

      clearRecoveryHealthTimeout()

      if (result === 'ok') {
        const visibleMs = Date.now() - recoveringEnteredAtRef.current
        const remainingVisibleMs = RECOVERY_MIN_VISIBLE_MS - visibleMs
        if (remainingVisibleMs > 0) {
          await sleep(remainingVisibleMs)
        }
        if (activeRecoveryFlightIdRef.current !== flightId) return
        activeRecoveryFlightIdRef.current = null
        recoveryAbortRef.current = null
        markOnlineRecovered('recovery-health')
        return
      }

      activeRecoveryFlightIdRef.current = null
      recoveryAbortRef.current = null
      enterOfflineRef.current('recovery-health-connectivity-failure')
    })()
  }, [cancelRecoveryHealth, clearRecoveryHealthTimeout, markOnlineRecovered])

  startRecoveryHealthCheckRef.current = startRecoveryHealthCheck

  const scheduleNextProbe = useCallback(() => {
    clearProbeSchedule()
    if (typeof window === 'undefined') return
    if (statusRef.current === 'online' || statusRef.current === 'recovering') return
    if (!navigatorReportsOnline()) return
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return

    const use1s = useNextProbeDelay1sRef.current
    if (use1s) {
      useNextProbeDelay1sRef.current = false
      skipNextProbeStepIncrementRef.current = true
    }
    const delay = use1s ? POST_ONLINE_PROBE_DELAY_MS : connectivityProbeDelayForStep(probeStepRef.current)
    probeTimeoutRef.current = setTimeout(() => {
      void (async () => {
        if (statusRef.current === 'online') return
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
          return
        }
        if (probeInFlightRef.current) {
          scheduleNextProbeRef.current()
          return
        }
        probeInFlightRef.current = true
        const probeStartedAt = performance.now()
        const ok = await probeInternetReachable()
        probeInFlightRef.current = false
        // `statusRef` can flip to `online` while the probe fetch runs; ref type does not model that.
        if ((statusRef.current as ConnectivityStatus) === 'online') return
        const s = statusRef.current

        if (!ok) {
          if (skipNextProbeStepIncrementRef.current) {
            skipNextProbeStepIncrementRef.current = false
          } else {
            probeStepRef.current = Math.min(probeStepRef.current + 1, MAX_PROBE_BACKOFF_STEP)
          }
          scheduleNextProbeRef.current()
          return
        }

        probeStepRef.current = 0
        consecutiveProbeFailuresRef.current = 0
        skipNextProbeStepIncrementRef.current = false
        lastNetworkSuccessAtRef.current = Date.now()
        if (statusRef.current === 'offline') {
          startRecoveryHealthCheckRef.current()
        } else {
        }
      })()
    }, delay)
  }, [clearProbeSchedule])

  useLayoutEffect(() => {
    scheduleNextProbeRef.current = scheduleNextProbe
  }, [scheduleNextProbe])

  useLayoutEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      scheduleOutboundSyncKick('mount-navigator-onLine')
    }
  }, [])

  const enterOffline = useCallback((cause = 'unknown') => {
    const prev = statusRef.current
    cancelRecoveryHealth()
    clearSyncTimeout()
    dismissSyncingToast()
    clearProbeSchedule()
    probeStepRef.current = 0
    consecutiveProbeFailuresRef.current = 0
    probeInFlightRef.current = false
    useNextProbeDelay1sRef.current = false
    skipNextProbeStepIncrementRef.current = false
    bumpReadDiscardGeneration(`enter-offline:${cause}`)
    serverLastProgressAtRef.current = Date.now()
    setInternetReachable(false)
    statusRef.current = 'offline'
    setStatus('offline')
    try {
      localStorage.setItem(CONNECTIVITY_STATUS_KEY, 'offline')
    } catch {
      // Ignore storage errors
    }
    if (navigatorReportsOnline()) {
      queueMicrotask(() => {
        scheduleNextProbeRef.current()
      })
    }
  }, [
    
    cancelRecoveryHealth,
    clearProbeSchedule,
    clearSyncTimeout,
    dismissSyncingToast,
  ])

  enterOfflineRef.current = enterOffline

  useEffect(() => {
    if (status === 'online' || status === 'recovering') {
      if (serverWorkInFlightRef.current > 0) {
        serverLastProgressAtRef.current = Date.now()
      }
    }
  }, [status])

  useEffect(() => {
    const id = window.setInterval(() => {
      const s = statusRef.current
      if (s !== 'online') return
      if (serverWorkInFlightRef.current <= 0) return
      if (Date.now() - serverLastProgressAtRef.current >= SERVER_PROGRESS_STALL_MS) {
        enterOfflineRef.current('server-progress-watchdog')
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    registerConnectivityFailureHandler((cause) => {
      enterOfflineRef.current(cause)
    })
    registerProfileFetchOfflineHandler(() => {
      enterOfflineRef.current('profile-fetch-timeout')
    })
    registerConnectivityStatusForReads(() => statusRef.current as ServerReadConnectivityStatus)
    return () => {
      registerConnectivityFailureHandler(null)
      registerProfileFetchOfflineHandler(null)
      registerConnectivityStatusForReads(null)
    }
  }, [])

  const startTempSyncWatch = useCallback(() => {
    // Status transitions use cloud icons only; no syncing toast.
  }, [])

  const canMutateNow = useCallback(() => {
    if (status === 'online') return true
    const browserOffline = typeof navigator !== 'undefined' && !navigator.onLine
    const offlineCatalogOk =
      (status === 'offline' || browserOffline || status === 'recovering') &&
      swControlled &&
      offlineAssetsReady
    return offlineCatalogOk
  }, [offlineAssetsReady, status, swControlled])

  const blockedMutationMessage = useCallback(() => {
    if (status === 'offline') return OFFLINE_ACTIONS_DISABLED_MSG
    if (status === 'recovering') return RECOVERING_MUTATIONS_DISABLED_MSG
    return USER_MUTATION_WAIT_MSG
  }, [status])

  const requestOfflineAssetsReady = useCallback(() => {
    if (!PWA_ENABLED) {
      setOfflineAssetsReady(false)
      setSwControlled(false)
      return
    }
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
    navigator.serviceWorker.controller?.postMessage({ type: SW_STATUS_REQUEST })
  }, [])

  useEffect(() => {
    if (!PWA_ENABLED) return
    if (typeof navigator === 'undefined') return
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker) {
      return
    }
    let cancelled = false
    const disposers: Array<() => void> = []
    const t0 = performance.now()
    void navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (cancelled) return
        if (!reg) return

        const onUpdateFound = () => {
        }
        reg.addEventListener('updatefound', onUpdateFound)
        disposers.push(() => reg.removeEventListener('updatefound', onUpdateFound))

        const trackWorker = (sw: ServiceWorker | null) => {
          if (!sw) return
          const onState = () => {
          }
          sw.addEventListener('statechange', onState)
          disposers.push(() => sw.removeEventListener('statechange', onState))
        }
        trackWorker(reg.installing)
        trackWorker(reg.waiting)
        trackWorker(reg.active)
      })
      .catch((e) => {
        if (cancelled) return
      })
    return () => {
      cancelled = true
      disposers.forEach((d) => d())
    }
  }, [])

  useEffect(() => {
    const withinBootGrace = Date.now() - bootStartedAtRef.current < BOOT_ONLINE_GRACE_MS
    const navigatorOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
    const computedOnline = withinBootGrace || internetReachable !== false
  }, [internetReachable, offlineAssetsReady, swControlled])

  useEffect(() => {
    let cancelled = false
    const runOnlineHeartbeat = async (cause: string) => {
      if (cancelled) return
      if (statusRef.current !== 'online') return
      if (!navigatorReportsOnline()) return

      const firstAttemptStartedAt = performance.now()
      let ok = await probeInternetReachable()
      const firstAttemptMs = Math.round(performance.now() - firstAttemptStartedAt)
      const sinceBootMs = Date.now() - bootStartedAtRef.current
      if (!ok && firstAttemptMs < 250 && sinceBootMs < BOOT_ONLINE_GRACE_MS + 1_000) {
        await sleep(300)
        if (cancelled) return
        ok = await probeInternetReachable()
      }
      if (cancelled) return
      if (statusRef.current !== 'online') return

      setInternetReachable(ok)
      if (ok) {
        lastNetworkSuccessAtRef.current = Date.now()
        return
      }

      if (sinceBootMs < BOOT_ONLINE_GRACE_MS) {
        return
      }

      enterOfflineRef.current(`heartbeat-failed:${cause}`)
    }
    void runOnlineHeartbeat('initial')
    const id = window.setInterval(() => {
      void runOnlineHeartbeat('interval')
    }, ONLINE_HEARTBEAT_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => {
    const onOffline = () => {
      enterOffline('window-offline-event')
    }
    const onOnline = () => {
      if (statusRef.current === 'offline') {
        clearProbeSchedule()
        probeStepRef.current = 0
        useNextProbeDelay1sRef.current = true
        skipNextProbeStepIncrementRef.current = false
        queueMicrotask(() => {
          scheduleNextProbeRef.current()
        })
      }
      if (statusRef.current === 'online') {
        scheduleOutboundSyncKick('window-online')
      }
    }
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      enterOffline('initial-navigator-offline')
    }
    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      clearSyncTimeout()
      clearProbeSchedule()
    }
  }, [clearProbeSchedule, clearSyncTimeout, enterOffline])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      if (statusRef.current === 'online') {
        scheduleOutboundSyncKick('visibility-visible')
      }
      const s = statusRef.current
      if (s === 'offline' && navigatorReportsOnline()) {
        clearProbeSchedule()
        probeStepRef.current = 0
        useNextProbeDelay1sRef.current = true
        skipNextProbeStepIncrementRef.current = false
        queueMicrotask(() => {
          scheduleNextProbeRef.current()
        })
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [clearProbeSchedule])

  useEffect(() => {
    if (!PWA_ENABLED) {
      setOfflineAssetsReady(false)
      setSwControlled(false)
      return
    }
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

  /**
   * PWA / SW registration + diagnostics (deferred until after first paint).
   * Heavy work (collectPwaDiagnostics, lifecycle append, long poll) runs only when DEBUG_PWA / ?debugPwa=1.
   * Precache URL probes: manual via PWA debug toolbar / window.__familistRunPrecacheVerify(); AUTO only with ?debugPwaDeep=1.
   */
  useEffect(() => {
    if (!PWA_ENABLED) return
    let cancelled = false
    let disposeSwListeners: (() => void) | undefined

    const runInner = async () => {
      const debug = isPwaDebugEnabled()
      const logDiag = debug
        ? (section: string) => {
            console.log(section)
          }
        : () => {}

      try {
        let appendPwaBlock = debug
        if (appendPwaBlock) {
          try {
            if (sessionStorage.getItem('familist_pwa_diag_banner') === '1') {
              appendPwaBlock = false
            } else {
              sessionStorage.setItem('familist_pwa_diag_banner', '1')
            }
          } catch {
            appendPwaBlock = true
          }
        }

        if (!('serviceWorker' in navigator)) {
          if (debug) {
            const d = await collectPwaDiagnostics()
            if (cancelled) return
            if (appendPwaBlock) {
              logDiag(`[PWA DIAG]\n${JSON.stringify(d, null, 2)}`)
              logDiag('pwa: no serviceWorker in navigator')
            }
          }
          return
        }

        const diagPromise: Promise<PwaDiagnostics | null> = debug
          ? collectPwaDiagnostics()
          : Promise.resolve(null)

        let attachToRegistration: ((r: ServiceWorkerRegistration) => void) | null = null
        if (debug) {
          const lifecycle = createSwLifecycleHandlers()
          disposeSwListeners = lifecycle.dispose
          attachToRegistration = lifecycle.attachToRegistration
        }

        const maxWaitMs = debug ? SW_NEXT_PWA_MAX_WAIT_MS : SW_QUIET_MAX_WAIT_MS
        const pollMs = debug ? SW_NEXT_PWA_POLL_MS : SW_QUIET_POLL_MS
        const maxIterations = Math.max(1, Math.ceil(maxWaitMs / pollMs))

        let reg: ServiceWorkerRegistration | undefined
        for (let i = 0; i < maxIterations; i++) {
          if (cancelled) {
            await diagPromise.catch(() => {})
            return
          }
          reg = await navigator.serviceWorker.getRegistration()
          if (reg) {
            attachToRegistration?.(reg)
            if (appendPwaBlock) {
              logDiag(
                `SW lifecycle listeners attached (poll #${i + 1}, serwist may still be registering; our register() not used yet)`,
              )
            }
            break
          }
          await sleep(pollMs)
        }

        let registeredByUs = false
        if (!reg && !cancelled) {
          await sleep(SW_FALLBACK_REGISTER_GRACE_MS)
          if (cancelled) {
            await diagPromise.catch(() => {})
            return
          }
          reg = await navigator.serviceWorker.getRegistration()
          if (reg) {
            attachToRegistration?.(reg)
            if (appendPwaBlock) {
              logDiag(
                'SW registration appeared during grace — serwist (or other); fallback register() skipped',
              )
            }
          }
        }

        if (!reg && !cancelled) {
          logFallbackSwRegister()
          reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
          registeredByUs = true
          attachToRegistration?.(reg)
        }

        const d = await diagPromise
        if (cancelled) return
        if (debug && d) {
          console.log('[PWA DIAG]', d)
          if (appendPwaBlock) {
            logDiag(`[PWA DIAG]\n${JSON.stringify(d, null, 2)}`)
          }
        }

        if (!reg) {
          if (appendPwaBlock) {
            logDiag('sw-reg: no registration after fallback path (unexpected)')
          }
          return
        }

        if (appendPwaBlock) {
          logDiag(
            `SW registration source: ${registeredByUs ? 'fallback register() after extended wait + grace (serwist never showed a registration)' : 'existing registration — serwist or prior session; our register() NOT called'}`,
          )
        }

        try {
          const regSnap = {
            scope: reg.scope,
            installing: reg.installing?.scriptURL,
            installingState: reg.installing?.state,
            waiting: reg.waiting?.scriptURL,
            waitingState: reg.waiting?.state,
            active: reg.active?.scriptURL,
            activeState: reg.active?.state,
          }
          if (debug) {
            logDiag(`SW reg (after wait / register)\n${JSON.stringify(regSnap, null, 2)}`)

            const regsNow = await navigator.serviceWorker.getRegistrations()
            logDiag(
              `getRegistrations (after wait / register) n=${regsNow.length}\n${JSON.stringify(
                regsNow.map((r) => ({
                  scope: r.scope,
                  installing: r.installing?.scriptURL,
                  installingState: r.installing?.state,
                  waiting: r.waiting?.scriptURL,
                  waitingState: r.waiting?.state,
                  active: r.active?.scriptURL,
                  activeState: r.active?.state,
                })),
                null,
                2,
              )}`,
            )

            const controller = navigator.serviceWorker.controller

            logDiag(
              `[SW controller]\n${JSON.stringify(
                {
                  controller: controller
                    ? {
                        scriptURL: controller.scriptURL,
                        state: controller.state,
                      }
                    : null,
                  swControlled: !!controller,
                },
                null,
                2,
              )}`,
            )
          }
        } catch (e) {
          if (cancelled) return
          const msg = e instanceof Error ? e.message : String(e)
          logDiag(`sw-reg FAIL\n${msg}`)
        }
      } catch (e) {
        if (debug) {
          console.error('[PWA DIAG] failed', e)
        }
      }
    }

    scheduleAfterFirstPaint(() => {
      if (cancelled) return
      void runInner()
    })

    return () => {
      cancelled = true
      disposeSwListeners?.()
    }
  }, [])

  /** Manual precache verify when DEBUG_PWA / ?debugPwa=1 (also exposed on window for console). */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as Window & { __familistRunPrecacheVerify?: () => Promise<void> }
    w.__familistRunPrecacheVerify = async () => {
      if (!isPwaDebugEnabled()) {
        console.warn('[familist] Set localStorage.DEBUG_PWA="1" or add ?debugPwa=1 then reload.')
        return
      }
      try {
        await runSwPrecacheVerification()
      } catch (e) {
        console.error('[precache-verify]', e)
      }
    }
    return () => {
      delete w.__familistRunPrecacheVerify
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    scheduleAfterFirstPaint(async () => {
      if (cancelled || !isPwaDeepDebugEnabled()) return
      const latch = 'familist_precache_verify_auto_done'
      try {
        if (sessionStorage.getItem(latch) === '1') return
        sessionStorage.setItem(latch, '1')
      } catch {
        return
      }
      try {
        await runSwPrecacheVerification()
      } catch (e) {
        console.error('[precache-verify]', e)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <ConnectivityContext.Provider
      value={{
        status,
        online: status === 'online',
        internetReachable,
        isOffline: status === 'offline',
        isRecovering: status === 'recovering',
        isOfflineActionsDisabled: false,
        allowItemMutationQueue: status !== 'online',
        recoveryFetchGeneration,
        swControlled,
        enterOffline,
        markOnlineRecovered,
        beginServerWork,
        endServerWork,
        pulseServerWorkProgress,
        startTempSyncWatch,
        canMutateNow,
        blockedMutationMessage,
        offlineAssetsReady,
        showOfflineBanner,
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

