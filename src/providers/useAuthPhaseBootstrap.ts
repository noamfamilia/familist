'use client'

import { useEffect, useRef } from 'react'
import type { User } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyBootSessionVerifyFailed } from '@/lib/authBootToastBridge'
import { isBrowserOnline, resolveLocalBootActor } from '@/lib/authLocalBoot'
import {
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

function isInvalidRefreshTokenError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message?: unknown }).message ?? '')
        : String(err ?? '')
  const lower = msg.toLowerCase()
  return (
    lower.includes('invalid refresh token') ||
    lower.includes('refresh token not found') ||
    lower.includes('refresh_token_not_found') ||
    lower.includes('refresh token is invalid')
  )
}

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
    a.setAuthPhaseBoth('guest')
    r.authenticatedEstablishedRef.current = false
    await a.enterGuestMode({
      freshGuest: options.freshGuest === true,
      signedOut: options.signedOut === true,
      formerAuthUserId: options.signedOut ? formerAuthUserId : undefined,
    })

    if (!r.mountedRef.current) return
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
    if (!code) return
    appendConnectivityDebugLine(
      `[auth] boot-verify-failed code=${code} hadBlob=${hadAuthBlob} err=${sessionError instanceof Error ? sessionError.message : String(sessionError ?? 'null-session')}`,
    )
    notifyBootSessionVerifyFailed(code)
    refs.loadingRef.current = false
    actionsRef.current.setLoading(false)
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
    let bootVerifyPromise: Promise<void> | null = null

    const runBootSessionVerify = async (): Promise<void> => {
      if (!isBrowserOnline()) {
        appendConnectivityDebugLine('[auth] boot-verify skipped offline')
        refs.loadingRef.current = false
        actionsRef.current.setLoading(false)
        return
      }

      const hadAuthBlob = hasUsableAuthBlob()
      try {
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
          `[auth] getSession ${sessionError ? 'error' : sessionData?.session ? 'has-session' : 'signed-out'} durationMs=${Math.round(performance.now() - gs0)}`,
        )

        if (!effectMounted) return

        const sessionUser = sessionData?.session?.user ?? null
        if (sessionUser) {
          await transitionToAuthenticatedRef.current(sessionUser, 'getSession-boot-verify')
          return
        }

        if (sessionError && isInvalidRefreshTokenError(sessionError)) {
          handleBootVerifyFailureRef.current(sessionError, hadAuthBlob, false)
          return
        }

        if (sessionError) {
          handleBootVerifyFailureRef.current(sessionError, hadAuthBlob, false)
          return
        }

        if (refs.localAccountBootRef.current || hadAuthBlob) {
          handleBootVerifyFailureRef.current(null, hadAuthBlob, false)
          return
        }

        if (refs.authPhaseRef.current === 'resolving') {
          await transitionToGuestRef.current({ source: 'boot-verify-signed-out', guestPath: 'A' })
        }
      } catch (error) {
        if (!effectMounted) return
        if (refs.localAccountBootRef.current || hadAuthBlob) {
          handleBootVerifyFailureRef.current(error, hadAuthBlob, false)
          return
        }
        if (isInvalidRefreshTokenError(error)) {
          handleBootVerifyFailureRef.current(error, hadAuthBlob, false)
        }
      }
    }

    const scheduleBootVerify = () => {
      if (!bootVerifyPromise) {
        bootVerifyPromise = runBootSessionVerify().finally(() => {
          bootVerifyPromise = null
        })
      }
      return bootVerifyPromise
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
        } else {
          refs.loadingRef.current = false
          actionsRef.current.setLoading(false)
        }
      }
    }

    const confirmedSignedOutLocally = async (): Promise<boolean> => {
      if (!refs.initialSessionSettledNullRef.current) return false
      if (hasUsableAuthBlob()) return false
      if (refs.localAccountBootRef.current) return false
      try {
        await scheduleBootVerify()
        if (refs.userRef.current) return false
        const { data } = await supabase.auth.getSession()
        if (data?.session?.user) return false
      } catch {
        // conservative
      }
      return true
    }

    const handleInitialSessionNull = async (source: string) => {
      if (!effectMounted) return
      if (refs.localAccountBootRef.current) {
        refs.initialSessionSettledNullRef.current = true
        refs.loadingRef.current = false
        actionsRef.current.setLoading(false)
        void scheduleBootVerify()
        return
      }
      if (refs.authPhaseRef.current !== 'resolving') return
      if (await confirmedSignedOutLocally()) {
        await transitionToGuestRef.current({ source, guestPath: 'A' })
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
          void transitionToAuthenticatedRef.current(nextUser, 'INITIAL_SESSION')
          return
        }
        refs.initialSessionSettledNullRef.current = true
        if (refs.authenticatedEstablishedRef.current) {
          if (effectMounted) {
            refs.loadingRef.current = false
            actionsRef.current.setLoading(false)
          }
          return
        }
        void handleInitialSessionNull('INITIAL_SESSION')
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

    if (refs.localAccountBootRef.current || refs.authPhaseRef.current === 'authenticated') {
      void scheduleBootVerify()
    }

    const onOnline = () => {
      if (refs.localAccountBootRef.current && !refs.userRef.current) {
        void scheduleBootVerify()
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
