'use client'

import { useEffect, useRef } from 'react'
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
import { appendConnectivityDebugLine } from '@/lib/connectivityDebugLog'
import { logServerRoundTrip } from '@/lib/serverActionLog'
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
  loadingRef: React.MutableRefObject<boolean>
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

function emitAuthBootTraceFromRefs(
  refs: AuthPhaseBootstrapRefs,
  params: {
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
  },
): void {
  logAuthBootTrace({
    event: params.event,
    reason: params.reason,
    guestPath: params.guestPath ?? null,
    authPhaseBefore: params.authPhaseBefore,
    authPhaseAfter: params.authPhaseAfter,
    loadingBefore: params.loadingBefore,
    loadingAfter: params.loadingAfter,
    authenticatedEstablished: refs.authenticatedEstablishedRef.current,
    initialSessionReceived: refs.initialSessionReceivedRef.current,
    initialSessionTimedOut: refs.initialSessionTimedOutRef.current,
    initialSessionSettledNull: refs.initialSessionSettledNullRef.current,
    sessionUserId: params.sessionUserId ?? refs.userRef.current?.id ?? null,
    getSessionErrorCode: params.getSessionErrorCode,
    hasUsableAuthBlob: hasUsableAuthBlob(),
    lastAuthUserId: getLastAuthUserId(),
    activeCacheUserBefore: getActiveCacheUserId(),
    activeCacheUserAfter: getActiveCacheUserId(),
    bootstrapUserIdBefore: refs.bootstrapUserIdRef.current,
    bootstrapUserIdAfter: refs.bootstrapUserIdRef.current,
    sessionMode:
      refs.authPhaseRef.current === 'resolving'
        ? 'resolving'
        : refs.authPhaseRef.current === 'guest'
          ? 'guest'
          : 'authenticated',
    didEnterGuestMode: params.didEnterGuestMode ?? false,
    didEnterAuthenticatedMode: params.didEnterAuthenticatedMode ?? false,
    didClearActiveCacheUser: false,
    hardRecoveryInProgress: refs.hardRecoveryInProgressRef.current,
    explicitSignOutInProgress: refs.explicitSignOutInProgressRef.current,
  })
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

  transitionToAuthenticatedRef.current = async (nextUser: User, source: string) => {
    const r = refs
    const a = actionsRef.current
    if (!r.mountedRef.current) return

    const loadingBefore = r.loadingRef.current
    const phaseBefore = r.authPhaseRef.current
    const nextId = nextUser.id

    if (
      r.authenticatedEstablishedRef.current &&
      r.lastAppliedUserIdRef.current === nextId &&
      phaseBefore === 'authenticated'
    ) {
      emitAuthBootTraceFromRefs(r, {
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

    a.setAuthPhaseBoth('authenticated')
    r.authenticatedEstablishedRef.current = true
    r.lastAppliedUserIdRef.current = nextId
    r.userRef.current = nextUser
    a.setUser(nextUser)
    r.bootstrapUserIdRef.current = nextId
    a.setBootstrapUserId(nextId)
    a.setActiveCacheUserId(nextId)
    setLastAuthUserId(nextId)

    if (a.consumePendingSignUpMigration()) {
      await a.completeSignUpWithOptionalGuestMigration(nextUser, source)
    } else {
      await a.activateAuthenticatedUserCore(nextUser, source)
    }

    if (!r.mountedRef.current) return
    r.loadingRef.current = false
    a.setLoading(false)
    emitAuthBootTraceFromRefs(r, {
      event: source,
      reason: 'transitionToAuthenticated',
      authPhaseBefore: phaseBefore,
      authPhaseAfter: 'authenticated',
      loadingBefore,
      loadingAfter: false,
      sessionUserId: nextId,
      didEnterAuthenticatedMode: true,
    })
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

    const loadingBefore = r.loadingRef.current
    const phaseBefore = r.authPhaseRef.current

    if (phaseBefore === 'resolving' && options.guestPath !== 'A' && options.guestPath !== 'D') {
      if (options.guestPath !== 'B' && options.guestPath !== 'C') return
    }

    if (phaseBefore === 'authenticated' && options.guestPath !== 'B' && options.guestPath !== 'C') {
      return
    }

    const formerAuthUserId =
      options.formerAuthUserId ?? r.userRef.current?.id ?? r.lastAppliedUserIdRef.current

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
    emitAuthBootTraceFromRefs(r, {
      event: options.source,
      reason: 'transitionToGuest',
      guestPath: options.guestPath,
      authPhaseBefore: phaseBefore,
      authPhaseAfter: 'guest',
      loadingBefore,
      loadingAfter: false,
      didEnterGuestMode: true,
    })
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
    let safetyTimeoutId: ReturnType<typeof setTimeout> | null = null

    const alreadyTerminal =
      refs.authenticatedEstablishedRef.current &&
      (refs.authPhaseRef.current === 'authenticated' || refs.authPhaseRef.current === 'guest')

    if (!alreadyTerminal) {
      actionsRef.current.setAuthPhaseBoth('resolving')
      refs.loadingRef.current = true
      actionsRef.current.setLoading(true)
      refs.authenticatedEstablishedRef.current = false
    }

    const confirmedSignedOutLocally = async (): Promise<boolean> => {
      if (!refs.initialSessionSettledNullRef.current) return false
      if (hasUsableAuthBlob()) return false
      try {
        const { data } = await supabase.auth.getSession()
        if (data?.session?.user) return false
      } catch {
        // conservative
      }
      return true
    }

    const handleInitialSessionNull = async (source: string) => {
      if (!effectMounted) return
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

    safetyTimeoutId = setTimeout(() => {
      if (!effectMounted) return
      refs.initialSessionTimedOutRef.current = true
      if (refs.authPhaseRef.current !== 'resolving') return
      if (refs.authenticatedEstablishedRef.current) return
      if (hasUsableAuthBlob()) return
      void transitionToGuestRef.current({
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
        appendConnectivityDebugLine(
          `[auth] getSession ${sessionError ? 'error' : sessionData?.session ? 'has-session' : 'signed-out'} durationMs=${Math.round(performance.now() - gs0)}`,
        )

        if (!effectMounted) return

        if (sessionError && isInvalidRefreshTokenError(sessionError)) {
          await actionsRef.current.hardRecoverInvalidRefreshToken('getSession')
          return
        }

        if (isStartupDiagnosticsEnabled()) {
          try {
            await supabase.auth.getUser()
          } catch {
            // diagnostics only
          }
          if (!effectMounted) return
        }

        const nextUser = sessionData?.session?.user ?? null
        if (nextUser) {
          await transitionToAuthenticatedRef.current(nextUser, 'getSession-fast-path')
        } else if (sessionError) {
          emitAuthBootTraceFromRefs(refs, {
            event: 'getSession',
            reason: 'error-stay-resolving',
            authPhaseBefore: refs.authPhaseRef.current,
            authPhaseAfter: refs.authPhaseRef.current,
            loadingBefore: refs.loadingRef.current,
            loadingAfter: refs.loadingRef.current,
            getSessionErrorCode: sessionError.message,
          })
        }
      } catch (error) {
        if (isInvalidRefreshTokenError(error)) {
          await actionsRef.current.hardRecoverInvalidRefreshToken('getSession-catch')
        }
      }
    })()

    return () => {
      effectMounted = false
      if (safetyTimeoutId) clearTimeout(safetyTimeoutId)
      subscription?.unsubscribe()
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
