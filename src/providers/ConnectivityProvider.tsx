'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import type { PwaDiagnostics } from '@/lib/pwaDiagnostics'
import { collectPwaDiagnostics } from '@/lib/pwaDiagnostics'
import { isPwaDebugEnabled, isPwaDeepDebugEnabled } from '@/lib/pwaDebug'
import { scheduleAfterFirstPaint } from '@/lib/startupPerf'
import { perfLog } from '@/lib/startupPerfLog'
import {
  registerProfileFetchOfflineHandler,
  registerProfileFetchRecoveryHandler,
} from '@/lib/profileFetchConnectivityBridge'
import { runSwPrecacheVerification } from '@/lib/swPrecacheVerify'
import { useDiagnosticsMessageBox } from '@/providers/DiagnosticsMessageBox'
import { appendOfflineNavDiagnostic } from '@/lib/offlineNavDiagnostics'
import { USER_MUTATION_WAIT_MSG } from '@/lib/userMutationGate'

type ConnectivityStatus = 'online' | 'syncing' | 'offline'

const CONNECTIVITY_STATUS_KEY = 'familist_connectivity_status'
const TEMP_SYNC_TIMEOUT_MS = 10000
const OFFLINE_PING_INTERVAL_MS = 10000
const OFFLINE_ACTIONS_DISABLED_MSG = 'Offline (actions disabled)'
const SW_STATUS_REQUEST = 'SW_OFFLINE_ASSETS_STATUS_REQUEST'
const SW_STATUS_RESPONSE = 'SW_OFFLINE_ASSETS_STATUS_RESPONSE'
const SW_FALLBACK_REGISTER_COUNT_KEY = 'familist_sw_js_fallback_register_count'
/** next-pwa registers asynchronously; avoid calling register() until this elapses with no registration */
const SW_NEXT_PWA_MAX_WAIT_MS = 12_000
const SW_NEXT_PWA_POLL_MS = 200
/** Extra getRegistration() checks before fallback to avoid racing next-pwa */
const SW_FALLBACK_REGISTER_GRACE_MS = 600
/** When PWA debug is off, short poll only — do not block startup on long next-pwa wait */
const SW_QUIET_MAX_WAIT_MS = 3_000
const SW_QUIET_POLL_MS = 500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Attach statechange + updatefound so we log installing → installed → activating → activated or redundant.
 * Listeners are deduped per ServiceWorker / ServiceWorkerRegistration instance.
 */
function createSwLifecycleHandlers(appendDiagnostics: (section: string) => void) {
  const seenWorkers = new WeakSet<ServiceWorker>()
  const registrationsWithUpdateFound = new WeakSet<ServiceWorkerRegistration>()
  const disposers: Array<() => void> = []

  const attachWorker = (sw: ServiceWorker, label: string) => {
    if (seenWorkers.has(sw)) return
    seenWorkers.add(sw)
    appendDiagnostics(
      `SW worker [${label}] snapshot\nstate=${sw.state}\nscriptURL=${sw.scriptURL}`,
    )
    const onState = () => {
      console.log('SW statechange', { label, state: sw.state, scriptURL: sw.scriptURL })
      appendDiagnostics(
        `SW statechange [${label}]\nstate=${sw.state}\nscriptURL=${sw.scriptURL}`,
      )
      if (sw.state === 'redundant') {
        console.warn('[SW] redundant', sw.scriptURL)
        appendDiagnostics(
          'SW reached redundant — use Remote debugging or SW DevTools console for install/precache errors (page-side precache-verify can still be ok).',
        )
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

function logFallbackSwRegister(appendDiagnostics: (section: string) => void) {
  try {
    const n = Number(sessionStorage.getItem(SW_FALLBACK_REGISTER_COUNT_KEY) || '0') + 1
    sessionStorage.setItem(SW_FALLBACK_REGISTER_COUNT_KEY, String(n))
    appendDiagnostics(
      `[sw-register-fallback] about to call register('/sw.js') invoke#${n} at ${new Date().toISOString()}`,
    )
    if (n > 1) {
      appendDiagnostics(
        `[sw-register-fallback] WARNING: fallback register() invoked ${n} times this tab — possible supersession race with next-pwa`,
      )
    }
  } catch {
    appendDiagnostics(`[sw-register-fallback] about to call register('/sw.js') (sessionStorage blocked)`)
  }
}

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

function PwaDebugPrecacheButton({
  appendDiagnostics,
}: {
  appendDiagnostics: (section: string) => void
}) {
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    scheduleAfterFirstPaint(() => setEnabled(isPwaDebugEnabled()))
  }, [])

  const onRun = useCallback(async () => {
    if (!isPwaDebugEnabled()) return
    setBusy(true)
    const t0 = performance.now()
    perfLog('precache-verify MANUAL start')
    try {
      const stats = await runSwPrecacheVerification(appendDiagnostics)
      perfLog('precache-verify MANUAL end', {
        durationMs: Math.round(performance.now() - t0),
        totalChecks: stats?.totalChecks ?? 0,
        failCount: stats?.failCount ?? 0,
      })
    } catch (e) {
      appendDiagnostics(
        `[precache-verify] manual error: ${e instanceof Error ? e.message : String(e)}`,
      )
      perfLog('precache-verify MANUAL end', {
        durationMs: Math.round(performance.now() - t0),
        totalChecks: 0,
        failCount: 0,
        error: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBusy(false)
    }
  }, [appendDiagnostics])

  if (!enabled) return null

  return (
    <div
      className="pointer-events-auto fixed bottom-14 right-2 z-[60] flex flex-col gap-1 rounded border border-amber-600/80 bg-neutral-900/95 p-2 text-[11px] text-amber-100 shadow-lg"
      aria-label="PWA debug tools"
    >
      <span className="font-semibold text-amber-300">PWA debug</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => void onRun()}
        className="rounded bg-amber-700 px-2 py-1 text-left text-white hover:bg-amber-600 disabled:opacity-50"
      >
        {busy ? 'Precache verify…' : 'Run precache verify'}
      </button>
    </div>
  )
}

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
  const { showToast, dismissToast } = useToast()
  const { appendDiagnostics } = useDiagnosticsMessageBox()
  const [status, setStatus] = useState<ConnectivityStatus>('online')
  const [offlineAssetsReady, setOfflineAssetsReady] = useState(false)
  const [swControlled, setSwControlled] = useState(false)

  useEffect(() => {
    const onLine = typeof navigator !== 'undefined' ? navigator.onLine : true
    appendOfflineNavDiagnostic(
      `[connectivity] status=${status} swControlled=${swControlled} offlineAssetsReady=${offlineAssetsReady} navigator.onLine=${onLine}`,
    )
  }, [status, swControlled, offlineAssetsReady])
  const syncToastIdRef = useRef<string | null>(null)
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const offlinePingIntervalRef = useRef<NodeJS.Timeout | null>(null)

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

  const clearOfflinePing = useCallback(() => {
    if (!offlinePingIntervalRef.current) return
    clearInterval(offlinePingIntervalRef.current)
    offlinePingIntervalRef.current = null
  }, [])

  const markOnlineRecovered = useCallback(() => {
    clearSyncTimeout()
    dismissSyncingToast()
    clearOfflinePing()
    setStatus('online')
    try {
      localStorage.setItem(CONNECTIVITY_STATUS_KEY, 'online')
    } catch {
      // Ignore storage errors
    }
  }, [clearOfflinePing, clearSyncTimeout, dismissSyncingToast])

  const enterOffline = useCallback(() => {
    clearSyncTimeout()
    dismissSyncingToast()
    setStatus('offline')
    try {
      localStorage.setItem(CONNECTIVITY_STATUS_KEY, 'offline')
    } catch {
      // Ignore storage errors
    }
    if (!offlinePingIntervalRef.current) {
      offlinePingIntervalRef.current = setInterval(() => {
        void probeInternetReachable().then((ok) => {
          if (ok) markOnlineRecovered()
        })
      }, OFFLINE_PING_INTERVAL_MS)
    }
  }, [clearSyncTimeout, dismissSyncingToast, markOnlineRecovered])

  useEffect(() => {
    registerProfileFetchOfflineHandler(() => {
      enterOffline()
    })
    registerProfileFetchRecoveryHandler(() => {
      markOnlineRecovered()
    })
    return () => {
      registerProfileFetchOfflineHandler(null)
      registerProfileFetchRecoveryHandler(null)
    }
  }, [enterOffline, markOnlineRecovered])

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
    if (typeof navigator === 'undefined') return
    perfLog('SW controller check', { swControlled: !!navigator.serviceWorker?.controller })
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker) {
      perfLog('SW getRegistration start')
      perfLog('SW getRegistration end', {
        durationMs: 0,
        hasRegistration: false,
        activeState: null,
        controller: false,
      })
      return
    }
    let cancelled = false
    const disposers: Array<() => void> = []
    const t0 = performance.now()
    perfLog('SW getRegistration start')
    void navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (cancelled) return
        perfLog('SW getRegistration end', {
          durationMs: Math.round(performance.now() - t0),
          hasRegistration: !!reg,
          activeState: reg?.active?.state ?? null,
          controller: !!navigator.serviceWorker?.controller,
        })
        if (!reg) return

        const onUpdateFound = () => {
          perfLog('SW updatefound')
        }
        reg.addEventListener('updatefound', onUpdateFound)
        disposers.push(() => reg.removeEventListener('updatefound', onUpdateFound))

        const trackWorker = (sw: ServiceWorker | null) => {
          if (!sw) return
          const onState = () => {
            perfLog('SW statechange', { state: sw.state })
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
        perfLog('SW getRegistration end', {
          durationMs: Math.round(performance.now() - t0),
          hasRegistration: false,
          activeState: null,
          controller: !!navigator.serviceWorker?.controller,
          error: e instanceof Error ? e.message : String(e),
        })
      })
    return () => {
      cancelled = true
      disposers.forEach((d) => d())
    }
  }, [])

  useEffect(() => {
    perfLog('offline readiness computed', {
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      swControlled,
      assetsReady: offlineAssetsReady,
      cachedDataReady: undefined,
    })
  }, [offlineAssetsReady, swControlled])

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

  /**
   * PWA / SW registration + diagnostics (deferred until after first paint).
   * Heavy work (collectPwaDiagnostics, lifecycle append, long poll) runs only when DEBUG_PWA / ?debugPwa=1.
   * Precache URL probes: manual via PWA debug toolbar / window.__familistRunPrecacheVerify(); AUTO only with ?debugPwaDeep=1.
   */
  useEffect(() => {
    let cancelled = false
    let disposeSwListeners: (() => void) | undefined

    const runInner = async () => {
      const debug = isPwaDebugEnabled()
      const logDiag = debug ? appendDiagnostics : () => {}

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
            console.log('[PWA DIAG]', d)
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
          const lifecycle = createSwLifecycleHandlers(logDiag)
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
                `SW lifecycle listeners attached (poll #${i + 1}, next-pwa may still be registering; our register() not used yet)`,
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
                'SW registration appeared during grace — next-pwa (or other); fallback register() skipped',
              )
            }
          }
        }

        if (!reg && !cancelled) {
          logFallbackSwRegister(appendDiagnostics)
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
            `SW registration source: ${registeredByUs ? 'fallback register() after extended wait + grace (next-pwa never showed a registration)' : 'existing registration — next-pwa or prior session; our register() NOT called'}`,
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
            console.log('SW reg', regSnap)
            logDiag(`SW reg (after wait / register)\n${JSON.stringify(regSnap, null, 2)}`)

            const regsNow = await navigator.serviceWorker.getRegistrations()
            console.log('SW getRegistrations (after wait / register)', regsNow.length, regsNow)
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
        console.error('[PWA DIAG] failed', e)
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
  }, [appendDiagnostics])

  /** Manual precache verify when DEBUG_PWA / ?debugPwa=1 (also exposed on window for console). */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as Window & { __familistRunPrecacheVerify?: () => Promise<void> }
    w.__familistRunPrecacheVerify = async () => {
      if (!isPwaDebugEnabled()) {
        console.warn('[familist] Set localStorage.DEBUG_PWA="1" or add ?debugPwa=1 then reload.')
        return
      }
      const t0 = performance.now()
      perfLog('precache-verify MANUAL start')
      try {
        const stats = await runSwPrecacheVerification(appendDiagnostics)
        perfLog('precache-verify MANUAL end', {
          durationMs: Math.round(performance.now() - t0),
          totalChecks: stats?.totalChecks ?? 0,
          failCount: stats?.failCount ?? 0,
        })
      } catch (e) {
        console.error('[precache-verify]', e)
        appendDiagnostics(`[precache-verify] runner error: ${e instanceof Error ? e.message : String(e)}`)
        perfLog('precache-verify MANUAL end', {
          durationMs: Math.round(performance.now() - t0),
          totalChecks: 0,
          failCount: 0,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
    return () => {
      delete w.__familistRunPrecacheVerify
    }
  }, [appendDiagnostics])

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
      perfLog('precache-verify AUTO start')
      const t0 = performance.now()
      try {
        const stats = await runSwPrecacheVerification(() => {})
        perfLog('precache-verify AUTO end', {
          durationMs: Math.round(performance.now() - t0),
          totalChecks: stats?.totalChecks ?? 0,
          failCount: stats?.failCount ?? 0,
        })
      } catch (e) {
        perfLog('precache-verify AUTO end', {
          durationMs: Math.round(performance.now() - t0),
          totalChecks: 0,
          failCount: 0,
          error: e instanceof Error ? e.message : String(e),
        })
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
      <>
        {children}
        <PwaDebugPrecacheButton appendDiagnostics={appendDiagnostics} />
      </>
    </ConnectivityContext.Provider>
  )
}

export function useConnectivity() {
  const context = useContext(ConnectivityContext)
  if (!context) throw new Error('useConnectivity must be used within ConnectivityProvider')
  return context
}

