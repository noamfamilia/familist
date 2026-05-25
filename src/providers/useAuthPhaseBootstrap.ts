'use client'

import { useEffect, useRef } from 'react'
import type { User } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyBootSessionVerifyFailed } from '@/lib/authBootToastBridge'
import { isBrowserOnline, resolveLocalBootActor } from '@/lib/authLocalBoot'
import {
  clearLastAuthUserId,
  hasUsableAuthBlob,
  registerAuthPhaseGetter,
  setLastAuthUserId,
  type AuthPhase,
  type GuestEntryPath,
} from '@/lib/authBootStorage'
import { appendConnectivityDebugLine } from '@/lib/connectivityDebugLog'
import { bootSessionVerifyCodeFromGetSession } from '@/lib/sessionExpiredToast'
import { logServerRoundTrip } from '@/lib/serverActionLog'
import { registerSessionModeGetter } from '@/lib/sessionPolicy'

const INITIAL_SESSION_WAIT_MS = 15_000

export type AuthPhaseBootstrapRefs = {
  mountedRef: React.MutableRefObject<boolean>
  userRef: React.MutableRefObject<User | null>
  bootstrapUserIdRef: React.MutableRefObject<string | null>
  lastAppliedUserIdRef: React.MutableRefObject<string | null>
  authenticatedEstablishedRef: React.MutableRefObject<boolean>
  initialSessionReceivedRef: React.MutableRefObject<boolean>
  initialSessionSettledNullRef: React.MutableRefObject<boolean>
  explicitSignOutInProgressRef: React.MutableRefObject<boolean>
  hardRecoveryInProgressRef: React.MutableRefObject<boolean>
  authPhaseRef: React.MutableRefObject<AuthPhase>
  loadingRef: React.MutableRefObject<boolean>
  localAccountBootRef: React.MutableRefObject<boolean>
}

export type AuthPhaseBootstrapActions = {
  setAuthPhaseBoth: (phase: AuthPhase) => void
  setUser: (user: User | null) => void
  setBootstrapUserId: (id: string) => void
  setLoading: (loading: boolean) => void
  setActiveCacheUserId: (id: string) => void
  activateAuthenticatedUserCore: (user: User, source: string) => Promise<void>
  enterGuestMode: (options?: {
    freshGuest?: boolean
    signedOut?: boolean
    formerAuthUserId?: string | null
  }) => Promise<void>
  applyOptimisticLocalAccount: (userId: string) => void
  hardRecoverInvalidRefreshToken: (source: string) => Promise<void>
}

export function useAuthPhaseBootstrap(
  supabase: SupabaseClient,
  refs: AuthPhaseBootstrapRefs,
  actions: AuthPhaseBootstrapActions,
) {
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  const transitionToAuthenticatedRef = useRef(
    async (_nextUser: User, _source: string) => {},
  )
  const transitionToGuestRef = useRef(
    async (_options: {
      source: string
      guestPath: GuestEntryPath
      signedOut?: boolean
      freshGuest?: boolean
      formerAuthUserId?: string | null
    }) => {},
  )

  const handleBootVerifyFailureRef = useRef(
    (_sessionError: unknown, _hadAuthBlob: boolean, _hasSessionUser: boolean) => {},
  )
  const dropOptimisticAccountToGuestRef = useRef(async (_source: string) => {})

  transitionToAuthenticatedRef.current = async (nextUser: User, source: string) => {
    const r = refs
    const a = actionsRef.current
    if (!r.mountedRef.current) return

    const phaseBefore = r.authPhaseRef.current
    const nextId = nextUser.id

    if (
      r.authenticatedEstablishedRef.current &&
      r.lastAppliedUserIdRef.current === nextId &&
      phaseBefore === 'authenticated'
    ) {
      if (r.userRef.current?.id !== nextId) {
        r.userRef.current = nextUser
        a.setUser(nextUser)
      }
      r.localAccountBootRef.current = false
      return
    }

    a.setAuthPhaseBoth('authenticated')
    r.authenticatedEstablishedRef.current = true
    r.localAccountBootRef.current = false
    r.lastAppliedUserIdRef.current = nextId
    r.userRef.current = nextUser
    a.setUser(nextUser)
    r.bootstrapUserIdRef.current = nextId
    a.setBootstrapUserId(nextId)
    a.setActiveCacheUserId(nextId)
    setLastAuthUserId(nextId)

    await a.activateAuthenticatedUserCore(nextUser, source)

    if (!r.mountedRef.current) return
    r.loadingRef.current = false
    a.setLoading(false)
  }

  transitionToGuestRef.current = async (options: {
    source: string
    guestPath: GuestEntryPath
    signedOut?: boolean
    freshGuest?: boolean
    formerAuthUserId?: string | null
  }) => {
    const r = refs
    const a = actionsRef.current
    if (!r.mountedRef.current) return
    if (r.hardRecoveryInProgressRef.current && options.guestPath !== 'C') return

    const phaseBefore = r.authPhaseRef.current

    if (phaseBefore === 'resolving' && options.guestPath !== 'A') {
      if (options.guestPath !== 'B' && options.guestPath !== 'C') return
    }

    if (
      phaseBefore === 'authenticated' &&
      options.guestPath !== 'B' &&
      options.guestPath !== 'C'
    ) {
      return
    }

    const formerAuthUserId =
      options.formerAuthUserId ?? r.userRef.current?.id ?? r.lastAppliedUserIdRef.current

    r.localAccountBootRef.current = false
    r.authenticatedEstablishedRef.current = false
    await a.enterGuestMode({
      freshGuest: options.freshGuest === true,
      signedOut: options.signedOut === true,
      formerAuthUserId: options.signedOut ? formerAuthUserId : undefined,
    })

    if (!r.mountedRef.current) return
    a.setAuthPhaseBoth('guest')
    r.loadingRef.current = false
    a.setLoading(false)
    if (options.guestPath === 'B') {
      r.explicitSignOutInProgressRef.current = false
    }
  }

  handleBootVerifyFailureRef.current = (
    sessionError: unknown,
    hadAuthBlob: boolean,
    hasSessionUser: boolean,
  ) => {
    const code = bootSessionVerifyCodeFromGetSession(sessionError, hadAuthBlob, hasSessionUser)
    appendConnectivityDebugLine(
      `[auth] boot-verify-failed code=${code ?? 'none'} hadBlob=${hadAuthBlob} err=${sessionError instanceof Error ? sessionError.message : String(sessionError ?? 'null-session')}`,
    )
    if (code) {
      notifyBootSessionVerifyFailed(code)
    }
    refs.loadingRef.current = false
    actionsRef.current.setLoading(false)

    if (refs.authPhaseRef.current === 'authenticated' && !refs.userRef.current) {
      if (refs.localAccountBootRef.current || hadAuthBlob) {
        void dropOptimisticAccountToGuestRef.current(
          code ? `boot-verify-failed-${code}` : 'boot-verify-failed-no-session',
        )
      } else {
        void transitionToGuestRef.current({
          source: code ? `boot-verify-failed-${code}` : 'boot-verify-failed-no-session',
          guestPath: 'C',
        })
      }
    }
  }

  useEffect(() => {
    registerSessionModeGetter(() => {
      const phase = refs.authPhaseRef.current
      if (phase === 'resolving') return 'resolving'
      if (phase === 'guest') return 'guest'
      return 'authenticated'
    })
    registerAuthPhaseGetter(() => refs.authPhaseRef.current)
    return () => {
      registerSessionModeGetter(null)
      registerAuthPhaseGetter(null)
    }
  }, [refs.authPhaseRef])

  useEffect(() => {
    let effectMounted = true
    let subscription: { unsubscribe: () => void } | null = null
    let sessionPipelinePromise: Promise<void> | null = null
    let initialSessionUser: User | null = null
    let initialSessionWaiter: ((user: User | null) => void) | null = null

    const resolveInitialSessionWaiter = (user: User | null) => {
      initialSessionUser = user
      if (initialSessionWaiter) {
        initialSessionWaiter(user)
        initialSessionWaiter = null
      }
    }

    const waitForInitialSession = (): Promise<User | null> => {
      if (refs.initialSessionReceivedRef.current) {
        return Promise.resolve(initialSessionUser)
      }
      return new Promise<User | null>((resolve, reject) => {
        const timer = setTimeout(() => {
          initialSessionWaiter = null
          reject(new Error('INITIAL_SESSION timeout'))
        }, INITIAL_SESSION_WAIT_MS)
        initialSessionWaiter = (user) => {
          clearTimeout(timer)
          resolve(user)
        }
      })
    }

    const dropOptimisticAccountToGuest = async (source: string) => {
      appendConnectivityDebugLine(`[auth] drop-optimistic-account-to-guest source=${source}`)
      try {
        await supabase.auth.signOut({ scope: 'local' })
      } catch {
        // best effort — clear stale blob so the next load does not re-enter optimistic account boot
      }
      clearLastAuthUserId()
      await transitionToGuestRef.current({ source, guestPath: 'C' })
    }
    dropOptimisticAccountToGuestRef.current = dropOptimisticAccountToGuest

    const runGetSessionVerdict = async (
      source: string,
      onNoSession: () => void,
    ): Promise<boolean> => {
      const hadAuthBlob = hasUsableAuthBlob()
      const gs0 = performance.now()
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      logServerRoundTrip({
        description: sessionError
          ? 'Auth getSession failed'
          : sessionData?.session
            ? 'Restored auth session'
            : 'Auth session (signed out)',
        ok: !sessionError,
        durationMs: Math.round(performance.now() - gs0),
        respondsTo: 'App bootstrap',
        failure: sessionError ?? undefined,
      })
      appendConnectivityDebugLine(
        `[auth] getSession ${sessionError ? 'error' : sessionData?.session ? 'has-session' : 'signed-out'} source=${source} durationMs=${Math.round(performance.now() - gs0)}`,
      )

      if (!effectMounted) return false

      const sessionUser = sessionData?.session?.user ?? null
      if (sessionUser) {
        await transitionToAuthenticatedRef.current(sessionUser, source)
        return true
      }

      if (refs.localAccountBootRef.current || hadAuthBlob) {
        handleBootVerifyFailureRef.current(sessionError ?? null, hadAuthBlob, false)
      } else {
        onNoSession()
      }
      return false
    }

    const runSessionPipeline = async (mode: 'account-local' | 'signed-out-check'): Promise<void> => {
      if (!isBrowserOnline()) {
        appendConnectivityDebugLine(`[auth] session-pipeline skipped offline mode=${mode}`)
        refs.loadingRef.current = false
        actionsRef.current.setLoading(false)
        if (
          (mode === 'account-local' || refs.localAccountBootRef.current) &&
          refs.authPhaseRef.current === 'authenticated' &&
          !refs.userRef.current
        ) {
          void dropOptimisticAccountToGuest('session-pipeline-offline')
        }
        return
      }

      if (refs.authenticatedEstablishedRef.current && refs.userRef.current) {
        return
      }

      try {
        const initialUser = await waitForInitialSession()
        appendConnectivityDebugLine(
          `[auth] INITIAL_SESSION settled user=${initialUser?.id ?? 'null'} mode=${mode}`,
        )

        await runGetSessionVerdict('getSession-after-INITIAL_SESSION', () => {
          if (mode === 'signed-out-check' && refs.authPhaseRef.current === 'resolving') {
            void transitionToGuestRef.current({
              source: 'INITIAL_SESSION-getSession-signed-out',
              guestPath: 'A',
            })
          }
        })
      } catch (error) {
        if (!effectMounted) return
        appendConnectivityDebugLine(
          `[auth] INITIAL_SESSION timeout mode=${mode} err=${error instanceof Error ? error.message : String(error)}`,
        )
        if (mode === 'account-local' || refs.localAccountBootRef.current || hasUsableAuthBlob()) {
          notifyBootSessionVerifyFailed('453')
          refs.loadingRef.current = false
          actionsRef.current.setLoading(false)
          if (refs.authPhaseRef.current === 'authenticated' && !refs.userRef.current) {
            void dropOptimisticAccountToGuest('INITIAL_SESSION-timeout')
          }
          return
        }
        if (refs.authPhaseRef.current === 'resolving') {
          await transitionToGuestRef.current({
            source: 'INITIAL_SESSION-timeout',
            guestPath: 'A',
          })
        }
      }
    }

    const scheduleSessionPipeline = (mode: 'account-local' | 'signed-out-check') => {
      if (!sessionPipelinePromise) {
        sessionPipelinePromise = runSessionPipeline(mode).finally(() => {
          sessionPipelinePromise = null
        })
      }
      return sessionPipelinePromise
    }

    const alreadyTerminal =
      refs.authenticatedEstablishedRef.current &&
      (refs.authPhaseRef.current === 'authenticated' || refs.authPhaseRef.current === 'guest')

    if (!alreadyTerminal) {
      const localBoot = resolveLocalBootActor()
      appendConnectivityDebugLine(
        `[auth] local-boot mode=${localBoot.mode}${localBoot.mode === 'account' ? ` userId=${localBoot.userId}` : ''} hasBlob=${hasUsableAuthBlob()}`,
      )
      if (localBoot.mode === 'account') {
        actionsRef.current.applyOptimisticLocalAccount(localBoot.userId)
        refs.localAccountBootRef.current = true
        refs.loadingRef.current = false
        actionsRef.current.setLoading(false)
      } else {
        refs.localAccountBootRef.current = false
        if (refs.authPhaseRef.current === 'resolving') {
          void transitionToGuestRef.current({ source: 'local-boot', guestPath: 'C' })
        } else if (refs.authPhaseRef.current === 'guest') {
          void actionsRef.current.enterGuestMode({})
          refs.loadingRef.current = false
          actionsRef.current.setLoading(false)
        } else {
          refs.loadingRef.current = false
          actionsRef.current.setLoading(false)
        }
      }
    }

    const {
      data: { subscription: sub },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!effectMounted) return
      const nextUser = session?.user ?? null
      const nextId = nextUser?.id ?? null

      if (event === 'INITIAL_SESSION') {
        refs.initialSessionReceivedRef.current = true
        refs.initialSessionSettledNullRef.current = !nextUser
        resolveInitialSessionWaiter(nextUser)

        if (refs.localAccountBootRef.current) {
          void scheduleSessionPipeline('account-local')
          return
        }

        if (nextUser) {
          if (
            refs.authenticatedEstablishedRef.current &&
            refs.lastAppliedUserIdRef.current === nextId
          ) {
            if (effectMounted) {
              refs.loadingRef.current = false
              actionsRef.current.setLoading(false)
            }
            return
          }
          if (refs.hardRecoveryInProgressRef.current || refs.explicitSignOutInProgressRef.current) {
            return
          }
          void scheduleSessionPipeline('account-local')
          return
        }

        if (refs.authenticatedEstablishedRef.current) {
          if (effectMounted) {
            refs.loadingRef.current = false
            actionsRef.current.setLoading(false)
          }
          return
        }

        if (refs.authPhaseRef.current === 'resolving') {
          void scheduleSessionPipeline('signed-out-check')
        }
        return
      }

      if (event === 'SIGNED_OUT') {
        if (refs.hardRecoveryInProgressRef.current) return
        if (!refs.explicitSignOutInProgressRef.current) return
        const formerAuthUserId = refs.userRef.current?.id ?? refs.lastAppliedUserIdRef.current
        void transitionToGuestRef.current({
          source: 'SIGNED_OUT',
          guestPath: 'B',
          signedOut: true,
          formerAuthUserId,
        })
        return
      }

      if (
        event === 'USER_UPDATED' &&
        nextUser &&
        nextId !== null &&
        refs.lastAppliedUserIdRef.current === nextId &&
        refs.authenticatedEstablishedRef.current
      ) {
        refs.userRef.current = nextUser
        actionsRef.current.setUser(nextUser)
        if (effectMounted) {
          refs.loadingRef.current = false
          actionsRef.current.setLoading(false)
        }
        return
      }

      if (
        (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') &&
        nextId !== null &&
        refs.lastAppliedUserIdRef.current === nextId &&
        refs.authenticatedEstablishedRef.current
      ) {
        return
      }

      if (!nextUser) return

      if (refs.hardRecoveryInProgressRef.current || refs.explicitSignOutInProgressRef.current) {
        return
      }

      void transitionToAuthenticatedRef.current(nextUser, event)
    })
    subscription = sub

    if (refs.localAccountBootRef.current) {
      void scheduleSessionPipeline('account-local')
    }

    const onOnline = () => {
      if (refs.localAccountBootRef.current && !refs.userRef.current) {
        void scheduleSessionPipeline('account-local')
      }
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline)
    }

    return () => {
      effectMounted = false
      subscription?.unsubscribe()
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline)
      }
    }
    // Mount once: transitions read latest handlers via refs; do not re-bootstrap when loading changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase])

  return {
    transitionToAuthenticated: (user: User, source: string) =>
      transitionToAuthenticatedRef.current(user, source),
    transitionToGuest: (options: Parameters<typeof transitionToGuestRef.current>[0]) =>
      transitionToGuestRef.current(options),
    explicitSignOutInProgressRef: refs.explicitSignOutInProgressRef,
  }
}
