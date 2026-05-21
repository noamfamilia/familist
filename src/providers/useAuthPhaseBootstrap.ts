'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { User } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getActiveCacheUserId } from '@/lib/cache'
import {
  getLastAuthUserId,
  hasUsableAuthBlob,
  registerAuthPhaseGetter,
  setLastAuthUserId,
  type AuthPhase,
  type GuestEntryPath,
} from '@/lib/authBootStorage'
import { logAuthBootTrace } from '@/lib/authBootTrace'
import { isStartupDiagnosticsEnabled } from '@/lib/startupDiagnostics'
import { logServerRoundTrip } from '@/lib/serverActionLog'
import { perfLog } from '@/lib/startupPerfLog'
import { registerSessionModeGetter } from '@/lib/sessionPolicy'

const INITIAL_SESSION_TIMEOUT_MS = 1_200

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
  initialSessionTimedOutRef: React.MutableRefObject<boolean>
  explicitSignOutInProgressRef: React.MutableRefObject<boolean>
  hardRecoveryInProgressRef: React.MutableRefObject<boolean>
  authPhaseRef: React.MutableRefObject<AuthPhase>
}

export type AuthPhaseBootstrapActions = {
  setAuthPhaseBoth: (phase: AuthPhase) => void
  setUser: (user: User | null) => void
  setBootstrapUserId: (id: string) => void
  setLoading: (loading: boolean) => void
  setActiveCacheUserId: (id: string) => void
  activateAuthenticatedUserCore: (user: User, source: string) => Promise<void>
  completeSignUpWithOptionalGuestMigration: (user: User, source: string) => Promise<void>
  consumePendingSignUpMigration: () => boolean
  enterGuestMode: (options?: {
    freshGuest?: boolean
    signedOut?: boolean
    formerAuthUserId?: string | null
  }) => Promise<void>
  hardRecoverInvalidRefreshToken: (source: string) => Promise<void>
}

export function useAuthPhaseBootstrap(
  supabase: SupabaseClient,
  loading: boolean,
  refs: AuthPhaseBootstrapRefs,
  actions: AuthPhaseBootstrapActions,
) {
  const {
    mountedRef,
    userRef,
    bootstrapUserIdRef,
    lastAppliedUserIdRef,
    authenticatedEstablishedRef,
    initialSessionReceivedRef,
    initialSessionSettledNullRef,
    initialSessionTimedOutRef,
    explicitSignOutInProgressRef,
    hardRecoveryInProgressRef,
    authPhaseRef,
  } = refs

  const {
    setAuthPhaseBoth,
    setUser,
    setBootstrapUserId,
    setLoading,
    setActiveCacheUserId,
    activateAuthenticatedUserCore,
    completeSignUpWithOptionalGuestMigration,
    consumePendingSignUpMigration,
    enterGuestMode,
    hardRecoverInvalidRefreshToken,
  } = actions

  const emitAuthBootTrace = useCallback(
    (params: {
      event: string
      reason: string
      guestPath?: GuestEntryPath
      authPhaseBefore: AuthPhase
      authPhaseAfter: AuthPhase
      loadingBefore: boolean
      loadingAfter: boolean
      sessionUserId?: string | null
      getSessionErrorCode?: string | null
      didEnterGuestMode?: boolean
      didEnterAuthenticatedMode?: boolean
    }) => {
      logAuthBootTrace({
        event: params.event,
        reason: params.reason,
        guestPath: params.guestPath ?? null,
        authPhaseBefore: params.authPhaseBefore,
        authPhaseAfter: params.authPhaseAfter,
        loadingBefore: params.loadingBefore,
        loadingAfter: params.loadingAfter,
        authenticatedEstablished: authenticatedEstablishedRef.current,
        initialSessionReceived: initialSessionReceivedRef.current,
        initialSessionTimedOut: initialSessionTimedOutRef.current,
        initialSessionSettledNull: initialSessionSettledNullRef.current,
        sessionUserId: params.sessionUserId ?? userRef.current?.id ?? null,
        getSessionErrorCode: params.getSessionErrorCode,
        hasUsableAuthBlob: hasUsableAuthBlob(),
        lastAuthUserId: getLastAuthUserId(),
        activeCacheUserBefore: getActiveCacheUserId(),
        activeCacheUserAfter: getActiveCacheUserId(),
        bootstrapUserIdBefore: bootstrapUserIdRef.current,
        bootstrapUserIdAfter: bootstrapUserIdRef.current,
        sessionMode:
          authPhaseRef.current === 'resolving'
            ? 'resolving'
            : authPhaseRef.current === 'guest'
              ? 'guest'
              : 'authenticated',
        didEnterGuestMode: params.didEnterGuestMode ?? false,
        didEnterAuthenticatedMode: params.didEnterAuthenticatedMode ?? false,
        didClearActiveCacheUser: false,
        hardRecoveryInProgress: hardRecoveryInProgressRef.current,
        explicitSignOutInProgress: explicitSignOutInProgressRef.current,
      })
    },
    [
      authenticatedEstablishedRef,
      authPhaseRef,
      bootstrapUserIdRef,
      explicitSignOutInProgressRef,
      hardRecoveryInProgressRef,
      initialSessionReceivedRef,
      initialSessionSettledNullRef,
      initialSessionTimedOutRef,
      userRef,
    ],
  )

  const transitionToAuthenticated = useCallback(
    async (nextUser: User, source: string) => {
      if (!mountedRef.current) return
      const loadingBefore = loading
      const phaseBefore = authPhaseRef.current
      const nextId = nextUser.id

      if (
        authenticatedEstablishedRef.current &&
        lastAppliedUserIdRef.current === nextId &&
        phaseBefore === 'authenticated'
      ) {
        emitAuthBootTrace({
          event: source,
          reason: 'idempotent-authenticated',
          authPhaseBefore: phaseBefore,
          authPhaseAfter: phaseBefore,
          loadingBefore,
          loadingAfter: loadingBefore,
          sessionUserId: nextId,
        })
        return
      }

      setAuthPhaseBoth('authenticated')
      authenticatedEstablishedRef.current = true
      lastAppliedUserIdRef.current = nextId
      userRef.current = nextUser
      setUser(nextUser)
      bootstrapUserIdRef.current = nextId
      setBootstrapUserId(nextId)
      setActiveCacheUserId(nextId)
      setLastAuthUserId(nextId)

      if (consumePendingSignUpMigration()) {
        await completeSignUpWithOptionalGuestMigration(nextUser, source)
      } else {
        await activateAuthenticatedUserCore(nextUser, source)
      }

      if (!mountedRef.current) return
      setLoading(false)
      emitAuthBootTrace({
        event: source,
        reason: 'transitionToAuthenticated',
        authPhaseBefore: phaseBefore,
        authPhaseAfter: 'authenticated',
        loadingBefore,
        loadingAfter: false,
        sessionUserId: nextId,
        didEnterAuthenticatedMode: true,
      })
    },
    [
      activateAuthenticatedUserCore,
      authPhaseRef,
      authenticatedEstablishedRef,
      bootstrapUserIdRef,
      completeSignUpWithOptionalGuestMigration,
      consumePendingSignUpMigration,
      emitAuthBootTrace,
      lastAppliedUserIdRef,
      loading,
      mountedRef,
      setActiveCacheUserId,
      setAuthPhaseBoth,
      setBootstrapUserId,
      setLoading,
      setUser,
      userRef,
    ],
  )

  const transitionToGuest = useCallback(
    async (options: {
      source: string
      guestPath: GuestEntryPath
      signedOut?: boolean
      freshGuest?: boolean
      formerAuthUserId?: string | null
    }) => {
      if (!mountedRef.current) return
      if (hardRecoveryInProgressRef.current && options.guestPath !== 'C') return

      const loadingBefore = loading
      const phaseBefore = authPhaseRef.current

      if (phaseBefore === 'resolving' && options.guestPath !== 'A' && options.guestPath !== 'D') {
        if (options.guestPath !== 'B' && options.guestPath !== 'C') {
          return
        }
      }

      if (phaseBefore === 'authenticated' && options.guestPath !== 'B' && options.guestPath !== 'C') {
        return
      }

      const formerAuthUserId = options.formerAuthUserId ?? userRef.current?.id ?? lastAppliedUserIdRef.current

      setAuthPhaseBoth('guest')
      authenticatedEstablishedRef.current = false
      await enterGuestMode({
        freshGuest: options.freshGuest === true,
        signedOut: options.signedOut === true,
        formerAuthUserId: options.signedOut ? formerAuthUserId : undefined,
      })

      if (!mountedRef.current) return
      setLoading(false)
      if (options.guestPath === 'B') {
        explicitSignOutInProgressRef.current = false
      }
      emitAuthBootTrace({
        event: options.source,
        reason: 'transitionToGuest',
        guestPath: options.guestPath,
        authPhaseBefore: phaseBefore,
        authPhaseAfter: 'guest',
        loadingBefore,
        loadingAfter: false,
        didEnterGuestMode: true,
      })
    },
    [
      authPhaseRef,
      authenticatedEstablishedRef,
      emitAuthBootTrace,
      enterGuestMode,
      explicitSignOutInProgressRef,
      hardRecoveryInProgressRef,
      lastAppliedUserIdRef,
      loading,
      mountedRef,
      setAuthPhaseBoth,
      setLoading,
      userRef,
    ],
  )

  const confirmedSignedOutLocally = useCallback(async (): Promise<boolean> => {
    if (!initialSessionSettledNullRef.current) return false
    if (hasUsableAuthBlob()) return false
    try {
      const { data } = await supabase.auth.getSession()
      if (data?.session?.user) return false
    } catch {
      // conservative
    }
    return true
  }, [initialSessionSettledNullRef, supabase.auth])

  useEffect(() => {
    registerSessionModeGetter(() => {
      const phase = authPhaseRef.current
      if (phase === 'resolving') return 'resolving'
      if (phase === 'guest') return 'guest'
      return 'authenticated'
    })
    registerAuthPhaseGetter(() => authPhaseRef.current)
    return () => {
      registerSessionModeGetter(null)
      registerAuthPhaseGetter(null)
    }
  }, [authPhaseRef])

  useEffect(() => {
    let mounted = true
    let subscription: { unsubscribe: () => void } | null = null
    let safetyTimeoutId: ReturnType<typeof setTimeout> | null = null

    setAuthPhaseBoth('resolving')
    setLoading(true)
    authenticatedEstablishedRef.current = false

    const handleInitialSessionNull = async (source: string) => {
      if (!mounted) return
      if (authPhaseRef.current !== 'resolving') return
      if (await confirmedSignedOutLocally()) {
        await transitionToGuest({ source, guestPath: 'A' })
      }
    }

    const {
      data: { subscription: sub },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      const nextUser = session?.user ?? null
      const nextId = nextUser?.id ?? null

      if (event === 'INITIAL_SESSION') {
        initialSessionReceivedRef.current = true
        if (nextUser) {
          if (authenticatedEstablishedRef.current && lastAppliedUserIdRef.current === nextId) {
            if (mounted) setLoading(false)
            return
          }
          if (hardRecoveryInProgressRef.current || explicitSignOutInProgressRef.current) return
          void transitionToAuthenticated(nextUser, 'INITIAL_SESSION')
          return
        }
        initialSessionSettledNullRef.current = true
        if (authenticatedEstablishedRef.current) {
          if (mounted) setLoading(false)
          return
        }
        void handleInitialSessionNull('INITIAL_SESSION')
        return
      }

      if (event === 'SIGNED_OUT') {
        if (hardRecoveryInProgressRef.current) return
        if (!explicitSignOutInProgressRef.current) return
        const formerAuthUserId = userRef.current?.id ?? lastAppliedUserIdRef.current
        void transitionToGuest({
          source: 'SIGNED_OUT',
          guestPath: 'B',
          signedOut: true,
          formerAuthUserId,
        })
        return
      }

      if (
        (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') &&
        nextId !== null &&
        lastAppliedUserIdRef.current === nextId &&
        authenticatedEstablishedRef.current
      ) {
        return
      }

      if (!nextUser) {
        return
      }

      if (hardRecoveryInProgressRef.current || explicitSignOutInProgressRef.current) return

      void transitionToAuthenticated(nextUser, event)
    })
    subscription = sub

    safetyTimeoutId = setTimeout(() => {
      if (!mounted) return
      initialSessionTimedOutRef.current = true
      if (authPhaseRef.current !== 'resolving') return
      if (authenticatedEstablishedRef.current) return
      if (hasUsableAuthBlob()) return
      void transitionToGuest({
        source: 'initial-session-timeout-no-blob',
        guestPath: 'D',
      })
    }, INITIAL_SESSION_TIMEOUT_MS)

    void (async () => {
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

        if (!mounted) return

        if (sessionError && isInvalidRefreshTokenError(sessionError)) {
          await hardRecoverInvalidRefreshToken('getSession')
          return
        }

        if (isStartupDiagnosticsEnabled()) {
          try {
            await supabase.auth.getUser()
          } catch {
            // diagnostics only
          }
          if (!mounted) return
        }

        const nextUser = sessionData?.session?.user ?? null
        if (nextUser) {
          await transitionToAuthenticated(nextUser, 'getSession-fast-path')
        } else if (sessionError) {
          emitAuthBootTrace({
            event: 'getSession',
            reason: 'error-stay-resolving',
            authPhaseBefore: authPhaseRef.current,
            authPhaseAfter: authPhaseRef.current,
            loadingBefore: true,
            loadingAfter: true,
            getSessionErrorCode: sessionError.message,
          })
        }
      } catch (error) {
        if (isInvalidRefreshTokenError(error)) {
          await hardRecoverInvalidRefreshToken('getSession-catch')
        }
      }
    })()

    return () => {
      mounted = false
      if (safetyTimeoutId) clearTimeout(safetyTimeoutId)
      subscription?.unsubscribe()
    }
  }, [
    authPhaseRef,
    authenticatedEstablishedRef,
    confirmedSignedOutLocally,
    emitAuthBootTrace,
    explicitSignOutInProgressRef,
    hardRecoverInvalidRefreshToken,
    hardRecoveryInProgressRef,
    initialSessionReceivedRef,
    initialSessionSettledNullRef,
    initialSessionTimedOutRef,
    lastAppliedUserIdRef,
    setAuthPhaseBoth,
    setLoading,
    supabase.auth,
    transitionToAuthenticated,
    transitionToGuest,
    userRef,
  ])

  return { transitionToAuthenticated, transitionToGuest, explicitSignOutInProgressRef }
}
