'use client'

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { useTheme } from 'next-themes'
import { createClient, forceNewClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '@/lib/supabase/types'
import { clearActiveCacheUserId, getActiveCacheUserId, setActiveCacheUserId } from '@/lib/cache'
import { db } from '@/lib/db'
import { notifyProfileFetchTimedOut } from '@/lib/profileFetchConnectivityBridge'
import { log, perfLog } from '@/lib/startupPerfLog'
import { logServerRoundTrip } from '@/lib/serverActionLog'
import { scheduleAfterFirstPaint } from '@/lib/startupPerf'
import { isStartupDiagnosticsEnabled } from '@/lib/startupDiagnostics'
import { runLocalDexieGc } from '@/lib/data/localDexieGc'
import { reportServerDexieParityDiagnostics, upsertProfileFromServer } from '@/lib/data/serverDexieParity'
import { enqueueProfilePatch, pickQueueableProfilePatch } from '@/lib/data/profileOutboundQueue'
import { readProfileFromDexie } from '@/lib/profileDexieHydrate'
import {
  bumpReadDiscardGeneration,
  canFetchFromServerNow,
  captureReadFlightGeneration,
  registerServerReadsAllowed,
  shouldDiscardReadFlightResult,
} from '@/lib/data/serverReadPolicy'
import { migrateGuestToUser } from '@/lib/data/guestToUserMigration'
import {
  clearStoredGuestId,
  ensureGuestId,
  getStoredGuestId,
  isGuestId,
  rotateGuestId,
} from '@/lib/guestSession'
import { resolveActiveUserId } from '@/lib/resolveActiveUserId'
import { registerSessionModeGetter, type SessionMode } from '@/lib/sessionPolicy'
import { resolveAuthDisplayName } from '@/lib/authDisplayName'
import { MigrationOverlay } from '@/components/auth/MigrationOverlay'

export type ProfileFetchPhase = 'idle' | 'loading' | 'done' | 'error' | 'timeout'

interface AuthContextType {
  user: User | null
  profile: Profile | null
  loading: boolean
  /** Active actor id: authenticated user or local guest. */
  bootstrapUserId: string | null
  guestId: string | null
  sessionMode: SessionMode
  isGuest: boolean
  isMigrating: boolean
  /** Shown once after sign-out when returning to guest mode. */
  signedOutToGuest: boolean
  clearSignedOutToGuest: () => void
  displayName: string
  activeActorId: string | null
  profileFetchPhase: ProfileFetchPhase
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, nickname: string) => Promise<{ error: Error | null; needsEmailConfirmation: boolean }>
  signOut: () => Promise<{ error: Error | null }>
  updateProfile: (updates: Partial<Profile>) => Promise<{ error: Error | null }>
  resetPassword: (email: string) => Promise<{ error: Error | null }>
  updatePassword: (newPassword: string) => Promise<{ error: Error | null }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const PROFILE_FETCH_STARTUP_TIMEOUT_MS = 2_000
const PROFILE_FETCH_TIMEOUT_MESSAGE = 'profile fetch timeout'
const AUTH_RECOVERY_ONCE_KEY = 'familist_auth_recovery_done_once'

function errorMessageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message?: unknown }).message
    return typeof m === 'string' ? m : String(m ?? '')
  }
  return String(err ?? '')
}

function isInvalidRefreshTokenError(err: unknown): boolean {
  const msg = errorMessageOf(err).toLowerCase()
  return (
    msg.includes('invalid refresh token') ||
    msg.includes('refresh token not found') ||
    msg.includes('refresh_token_not_found') ||
    msg.includes('refresh token is invalid')
  )
}

async function clearAuthAndAppStorage(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      if (
        k.startsWith('sb-') ||
        k.startsWith('cached_') ||
        k.startsWith('recent_lists_') ||
        k.startsWith('list_') ||
        k.startsWith('label_filter_') ||
        k.startsWith('tutorial_') ||
        k === 'active_cache_user' ||
        k === 'familist_guest_id' ||
        k === 'familist_connectivity_status' ||
        k === 'pending_invite_token' ||
        k === 'pwa-install-dismissed'
      ) {
        toRemove.push(k)
      }
    }
    for (const k of toRemove) localStorage.removeItem(k)
  } catch {
    // ignore
  }

  try {
    await db.delete()
  } catch {
    // ignore
  }

  try {
    if ('caches' in window) {
      const names = await caches.keys()
      await Promise.all(names.map((name) => caches.delete(name)))
    }
  } catch {
    // ignore
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)

    promise
      .then((value) => {
        clearTimeout(timeoutId)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timeoutId)
        reject(error)
      })
  })
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [guestId, setGuestId] = useState<string | null>(null)
  const [bootstrapUserId, setBootstrapUserId] = useState<string | null>(null)
  const [isMigrating, setIsMigrating] = useState(false)
  const [signedOutToGuest, setSignedOutToGuest] = useState(false)
  const [profileFetchPhase, setProfileFetchPhase] = useState<ProfileFetchPhase>('idle')
  const supabase = createClient()
  const { setTheme } = useTheme()

  const mountedRef = useRef(true)
  const userRef = useRef<User | null>(null)
  const guestIdRef = useRef<string | null>(null)
  const bootstrapUserIdRef = useRef<string | null>(null)
  const profileFetchGenRef = useRef(0)
  const sessionMode: SessionMode = user ? 'authenticated' : 'guest'
  const isGuest = sessionMode === 'guest'
  const activeActorId = resolveActiveUserId(user?.id, guestId, bootstrapUserId)
  const displayName = isGuest ? 'Guest' : resolveAuthDisplayName(user, profile)
  useEffect(() => {
    reportServerDexieParityDiagnostics()
    scheduleAfterFirstPaint(() => {
      void runLocalDexieGc()
    })
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    userRef.current = user
  }, [user])

  useEffect(() => {
    bootstrapUserIdRef.current = bootstrapUserId
  }, [bootstrapUserId])

  useEffect(() => {
    guestIdRef.current = guestId
  }, [guestId])

  useEffect(() => {
    registerSessionModeGetter(() => (userRef.current ? 'authenticated' : 'guest'))
    registerServerReadsAllowed(() => userRef.current != null)
    return () => {
      registerSessionModeGetter(null)
      registerServerReadsAllowed(null)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const gid = ensureGuestId()
    setGuestId(gid)
    const cachedAuth = getActiveCacheUserId()
    if (cachedAuth && !isGuestId(cachedAuth)) {
      setBootstrapUserId(cachedAuth)
    } else if (!userRef.current) {
      setBootstrapUserId(gid)
    }
  }, [])

  const enterGuestMode = useCallback((options?: { freshGuest?: boolean; signedOut?: boolean }) => {
    const gid = options?.freshGuest ? rotateGuestId() : ensureGuestId()
    setGuestId(gid)
    setBootstrapUserId(gid)
    setUser(null)
    setProfile(null)
    profileFetchGenRef.current++
    setProfileFetchPhase('idle')
    clearActiveCacheUserId()
    if (options?.signedOut) setSignedOutToGuest(true)
  }, [])

  const runGuestMigrationIfNeeded = useCallback(async (nextUser: User): Promise<void> => {
    const fromGuest = getStoredGuestId()
    if (!fromGuest || !isGuestId(fromGuest) || fromGuest === nextUser.id) return
    setIsMigrating(true)
    try {
      await migrateGuestToUser(fromGuest, nextUser.id)
      clearStoredGuestId()
      bumpReadDiscardGeneration('guest-migration')
    } finally {
      if (mountedRef.current) setIsMigrating(false)
    }
  }, [])

  const hydrateProfileFromDexie = useCallback(async (userId: string) => {
    try {
      const hydrated = await readProfileFromDexie(userId)
      if (!hydrated || !mountedRef.current) return
      const activeId = userRef.current?.id ?? bootstrapUserIdRef.current ?? getActiveCacheUserId()
      if (activeId !== userId) return
      setProfile(hydrated)
      perfLog('auth/hydrateProfileFromDexie', { userId })
    } catch {
      // best-effort local hydrate
    }
  }, [])

  const fetchProfile = useCallback(async (userId: string) => {
    const t0 = performance.now()
    perfLog('auth/fetchProfile start', { userId })
    if (!canFetchFromServerNow()) {
      const cachedProfile = await readProfileFromDexie(userId)
      if (cachedProfile && mountedRef.current && userRef.current?.id === userId) {
        setProfile(cachedProfile)
      }
      perfLog('auth/fetchProfile end', {
        userId,
        durationMs: Math.round(performance.now() - t0),
        note: 'dexie-only',
      })
      return
    }
    const readFlightGen = captureReadFlightGeneration()
    try {
      const q0 = performance.now()
      const freshClient = forceNewClient()
      const { data, error } = await freshClient
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()
      if (shouldDiscardReadFlightResult(readFlightGen)) {
        const cachedProfile = await readProfileFromDexie(userId)
        if (cachedProfile && mountedRef.current && userRef.current?.id === userId) {
          setProfile(cachedProfile)
        }
        perfLog('auth/fetchProfile end', {
          userId,
          durationMs: Math.round(performance.now() - t0),
          note: 'discarded-not-online',
        })
        return
      }
      logServerRoundTrip({
        description: error
          ? 'Fetched user profile (failed)'
          : data
            ? 'Fetched user profile'
            : 'Fetched user profile (no row)',
        ok: !error,
        durationMs: Math.round(performance.now() - q0),
        respondsTo: 'After sign-in / session',
        failure: error ?? undefined,
      })

      if (!mountedRef.current || userRef.current?.id !== userId) return
      if (error) {
        const cachedProfile = await readProfileFromDexie(userId)
        if (!cachedProfile) return
        setProfile(cachedProfile)
        return
      }
      if (!data) return
      const row = data as Profile & { theme?: string }
      void upsertProfileFromServer(row)
      setProfile({
        ...row,
        theme: row.theme === 'dark' ? 'dark' : 'light',
      })
    } catch (err) {
      console.error('fetchProfile error:', err)
    } finally {
      perfLog('auth/fetchProfile end', {
        userId,
        durationMs: Math.round(performance.now() - t0),
      })
    }
  }, [])

  const hardRecoverInvalidRefreshToken = useCallback(
    async (source: string) => {
      if (typeof window !== 'undefined' && sessionStorage.getItem(AUTH_RECOVERY_ONCE_KEY) === '1') {
        perfLog('auth/recovery skipped already-ran', { source })
        return
      }
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(AUTH_RECOVERY_ONCE_KEY, '1')
      }

      perfLog('auth/recovery start', { source })
      try {
        try {
          await supabase.auth.signOut({ scope: 'local' })
        } catch {
          // best effort
        }
        await clearAuthAndAppStorage()
        try {
          if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations()
            await Promise.all(regs.map((reg) => reg.unregister()))
          }
        } catch {
          // best effort
        }
      } finally {
        profileFetchGenRef.current++
        clearStoredGuestId()
        rotateGuestId()
        setUser(null)
        setProfile(null)
        setProfileFetchPhase('idle')
        enterGuestMode({ freshGuest: true })
        setLoading(false)
        perfLog('auth/recovery end', { source })
        if (typeof window !== 'undefined') {
          window.location.reload()
        }
      }
    },
    [enterGuestMode, supabase.auth],
  )

  const scheduleStartupProfileFetch = useCallback(
    (userId: string) => {
      const gen = ++profileFetchGenRef.current
      perfLog('auth/fetchProfile schedule after first paint', { userId, gen })
      scheduleAfterFirstPaint(() => {
        perfLog('auth/fetchProfile run start', { userId, gen })
        setProfileFetchPhase('loading')
        void (async () => {
          const wrapT0 = performance.now()
          try {
            perfLog('auth/fetchProfile withTimeout await start', { userId, gen })
            await withTimeout(
              fetchProfile(userId),
              PROFILE_FETCH_STARTUP_TIMEOUT_MS,
              PROFILE_FETCH_TIMEOUT_MESSAGE,
            )
            perfLog('auth/fetchProfile withTimeout await end', {
              userId,
              gen,
              durationMs: Math.round(performance.now() - wrapT0),
            })
            if (profileFetchGenRef.current === gen) {
              setProfileFetchPhase('done')
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            perfLog('auth/fetchProfile withTimeout error', {
              userId,
              gen,
              durationMs: Math.round(performance.now() - wrapT0),
              message: msg,
            })
            if (msg === PROFILE_FETCH_TIMEOUT_MESSAGE && profileFetchGenRef.current === gen) {
              const cachedProfile = await readProfileFromDexie(userId)
              if (cachedProfile) {
                setProfile(cachedProfile)
              }
              log.warn('AUTH', 'fetchProfile timeout; proceeding with cached profile', {
                userId,
                gen,
                timeoutMs: PROFILE_FETCH_STARTUP_TIMEOUT_MS,
                hadCachedProfile: !!cachedProfile,
              })
              notifyProfileFetchTimedOut()
              setProfileFetchPhase('timeout')
            } else if (profileFetchGenRef.current === gen) {
              setProfileFetchPhase('error')
            }
          }
        })()
      })
    },
    [fetchProfile],
  )

  const activateAuthenticatedUser = useCallback(
    async (nextUser: User, source: string) => {
      await runGuestMigrationIfNeeded(nextUser)
      if (!mountedRef.current) return
      perfLog('auth activateAuthenticatedUser', { source, userId: nextUser.id })
      setUser(nextUser)
      setActiveCacheUserId(nextUser.id)
      setBootstrapUserId(nextUser.id)
      setSignedOutToGuest(false)
      void hydrateProfileFromDexie(nextUser.id)
      scheduleStartupProfileFetch(nextUser.id)
    },
    [hydrateProfileFromDexie, runGuestMigrationIfNeeded, scheduleStartupProfileFetch],
  )

  useEffect(() => {
    let mounted = true
    let subscription: { unsubscribe: () => void } | null = null
    const hydratedFromGetSessionRef = { current: false }
    const lastAppliedUserIdRef = { current: null as string | null }

    const applySessionUserCore = async (
      nextUser: User | null,
      source: string,
      options?: { signedOut?: boolean },
    ) => {
      if (!mounted) return
      perfLog('auth applySessionUser', { source, hasUser: !!nextUser, userId: nextUser?.id ?? null })
      lastAppliedUserIdRef.current = nextUser?.id ?? null
      if (nextUser) {
        await activateAuthenticatedUser(nextUser, source)
        return
      }
      enterGuestMode({
        freshGuest: options?.signedOut === true,
        signedOut: options?.signedOut === true,
      })
    }

    void (async () => {
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0
      perfLog('auth/session start')
      try {
        perfLog('auth/getSession start')
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
        perfLog('auth/getSession end', {
          durationMs: Math.round(performance.now() - gs0),
          hasSession: !!sessionData?.session,
          error: sessionError?.message,
        })

        if (!mounted) return

        if (sessionError && isInvalidRefreshTokenError(sessionError)) {
          perfLog('auth/getSession invalid-refresh-token', { message: sessionError.message })
          await hardRecoverInvalidRefreshToken('getSession')
          return
        }

        if (isStartupDiagnosticsEnabled()) {
          perfLog('auth/getUser start')
          const gu0 = performance.now()
          try {
            const { data: userData, error: userError } = await supabase.auth.getUser()
            perfLog('auth/getUser end', {
              durationMs: Math.round(performance.now() - gu0),
              hasUser: !!userData?.user,
              error: userError?.message,
            })
          } catch (guErr) {
            perfLog('auth/getUser end', {
              durationMs: Math.round(performance.now() - gu0),
              error: guErr instanceof Error ? guErr.message : String(guErr),
            })
          }
          if (!mounted) return
        }

        const nextUser = sessionData?.session?.user ?? null
        perfLog('auth/getSession applySessionUser start', {
          hasUser: !!nextUser,
          userId: nextUser?.id ?? null,
        })
        await applySessionUserCore(nextUser, 'getSession')
        perfLog('auth/getSession applySessionUser end', {
          hasUser: !!nextUser,
          userId: nextUser?.id ?? null,
        })
      } catch (error) {
        console.error('Failed to get session:', error)
        perfLog('auth/session try error', {
          message: error instanceof Error ? error.message : String(error),
        })
        if (isInvalidRefreshTokenError(error)) {
          await hardRecoverInvalidRefreshToken('getSession-catch')
          return
        }
      } finally {
        hydratedFromGetSessionRef.current = true
        if (mounted) {
          perfLog('auth setLoading(false) before', { source: 'getSession_bootstrap' })
          setLoading(false)
          perfLog('auth setLoading(false) after', {
            source: 'getSession_bootstrap',
            durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0),
          })
          perfLog('auth/session end', {
            durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0),
          })
        }
      }

      if (!mounted) return

      perfLog('auth onAuthStateChange subscribe start')
      const {
        data: { subscription: sub },
      } = supabase.auth.onAuthStateChange((event, session) => {
        const nextUser = session?.user ?? null
        const nextId = nextUser?.id ?? null

        if (event === 'INITIAL_SESSION' && hydratedFromGetSessionRef.current) {
          if (nextId === lastAppliedUserIdRef.current) {
            perfLog('auth onAuthStateChange ignored', {
              event,
              reason: 'initial_session_same_as_getSession',
              userId: nextId,
            })
            return
          }
          perfLog('auth onAuthStateChange', {
            event,
            hasSession: !!session,
            note: 'initial_session_differs_reapplying',
          })
          void applySessionUserCore(nextUser, 'onAuthStateChange')
          return
        }

        if (
          (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') &&
          nextId !== null &&
          lastAppliedUserIdRef.current === nextId
        ) {
          perfLog('auth onAuthStateChange ignored', {
            event,
            reason: 'same_user_idempotent',
            userId: nextId,
          })
          return
        }

        if (event === 'SIGNED_OUT') {
          perfLog('auth onAuthStateChange', { event, hasSession: false })
          void applySessionUserCore(null, 'onAuthStateChange', { signedOut: true })
          if (mounted) setLoading(false)
          return
        }

        perfLog('auth onAuthStateChange', { event, hasSession: !!session })
        void applySessionUserCore(nextUser, 'onAuthStateChange')
        if (mounted) {
          perfLog('auth onAuthStateChange setLoading(false) before')
          setLoading(false)
          perfLog('auth onAuthStateChange setLoading(false) after')
        }
      })
      subscription = sub
      perfLog('auth onAuthStateChange subscribe end')
    })()

    return () => {
      mounted = false
      subscription?.unsubscribe()
    }
  }, [
    activateAuthenticatedUser,
    enterGuestMode,
    hardRecoverInvalidRefreshToken,
    supabase.auth,
  ])

  useEffect(() => {
    const t = profile?.theme
    if (t === 'light' || t === 'dark') {
      setTheme(t)
    }
  }, [profile?.theme, setTheme])

  const signIn = async (email: string, password: string) => {
    try {
      // Use fresh client to avoid stale connection issues
      const freshClient = forceNewClient()

      const result = await withTimeout(
        freshClient.auth.signInWithPassword({ email, password }),
        10000,
        'Sign in timed out. Please refresh the page.',
      )

      if (!result.error && result.data?.user) {
        await activateAuthenticatedUser(result.data.user, 'signIn')
      }

      return { error: result.error }
    } catch (error) {
      return { error: error as Error }
    }
  }

  const signUp = async (email: string, password: string, nickname: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { nickname },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    // If sign up successful and user is returned (no email confirmation required)
    if (!error && data?.user && data.session) {
      await activateAuthenticatedUser(data.user, 'signUp')
    }

    // Email confirmation is needed if signup succeeded but no session was returned
    const needsEmailConfirmation = !error && data?.user && !data.session

    return { error: error as Error | null, needsEmailConfirmation: !!needsEmailConfirmation }
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()

    if (error) {
      console.error('Sign out error:', error)
      return { error: error as Error }
    }

    enterGuestMode({ freshGuest: true, signedOut: true })
    return { error: null }
  }

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) {
      return { error: new Error('Not authenticated') }
    }

    const patch = pickQueueableProfilePatch(updates)
    if (Object.keys(patch).length === 0) {
      return { error: null }
    }

    const prev = profile
    const merged = prev ? ({ ...prev, ...patch } as Profile) : null
    if (!merged) {
      return { error: new Error('Profile not loaded') }
    }

    setProfile(merged)
    await upsertProfileFromServer(merged)

    try {
      await enqueueProfilePatch(user.id, patch)
      return { error: null }
    } catch (error) {
      setProfile(prev)
      if (prev) {
        void upsertProfileFromServer(prev)
      }
      return { error: error instanceof Error ? error : new Error(String(error)) }
    }
  }

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback`,
    })
    return { error: error as Error | null }
  }

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    return { error: error as Error | null }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        bootstrapUserId,
        guestId,
        sessionMode,
        isGuest,
        isMigrating,
        signedOutToGuest,
        clearSignedOutToGuest: () => setSignedOutToGuest(false),
        displayName,
        activeActorId,
        profileFetchPhase,
        signIn,
        signUp,
        signOut,
        updateProfile,
        resetPassword,
        updatePassword,
      }}
    >
      {isMigrating ? <MigrationOverlay /> : null}
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
