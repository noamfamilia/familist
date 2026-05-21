'use client'

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { useTheme } from 'next-themes'
import { createClient, forceNewClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '@/lib/supabase/types'
import { getActiveCacheUserId, getCachedLists, setActiveCacheUserId } from '@/lib/cache'
import { db } from '@/lib/db'
import { appendConnectivityDebugLine } from '@/lib/connectivityDebugLog'
import { beginActivationServerProgressWindow, hasActivationServerResponse } from '@/lib/activationServerProgress'
import { notifyProfileFetchTimedOut } from '@/lib/profileFetchConnectivityBridge'
import { log, perfLog } from '@/lib/startupPerfLog'
import { logServerRoundTrip } from '@/lib/serverActionLog'
import { scheduleAfterFirstPaint } from '@/lib/startupPerf'
import { runLocalDexieGc } from '@/lib/data/localDexieGc'
import { reportServerDexieParityDiagnostics, upsertProfileFromServer } from '@/lib/data/serverDexieParity'
import { enqueueProfilePatch, pickQueueableProfilePatch } from '@/lib/data/profileOutboundQueue'
import { readProfileFromDexie, upsertLocalProfilePatch } from '@/lib/profileDexieHydrate'
import {
  bumpReadDiscardGeneration,
  canFetchFromServerNow,
  captureReadFlightGeneration,
  registerServerReadsAllowed,
  shouldDiscardReadFlightResult,
} from '@/lib/data/serverReadPolicy'
import { countGuestOwnedLists, migrateGuestToUser } from '@/lib/data/guestToUserMigration'
import {
  clearStoredGuestId,
  ensureGuestId,
  getStoredGuestId,
  isGuestId,
  rotateGuestId,
} from '@/lib/guestSession'
import { getCachedAuthenticatedUserId, getInitialBootstrapUserId } from '@/lib/authBootstrap'
import { clearLastAuthUserId, setLastAuthUserId, type AuthPhase } from '@/lib/authBootStorage'
import { resolveActiveUserId } from '@/lib/resolveActiveUserId'
import { type SessionMode } from '@/lib/sessionPolicy'
import { useAuthPhaseBootstrap } from '@/providers/useAuthPhaseBootstrap'
import { reconcileGuestDexieAfterSignOut } from '@/lib/data/guestCatalogReconcile'
import { discardGuestOutboundQueueRows } from '@/lib/data/syncQueue'
import { resolveAuthDisplayName } from '@/lib/authDisplayName'
import {
  clearPendingSignUpMigration,
  consumePendingSignUpMigration,
  markPendingSignUpMigration,
} from '@/lib/authSignUpMigration'
import { signInWithGoogle as startGoogleOAuth, type GoogleAuthIntent } from '@/lib/authGoogle'
import { MigrationOverlay } from '@/components/auth/MigrationOverlay'
import { GuestMigrateConfirmModal } from '@/components/auth/GuestMigrateConfirmModal'
export type ProfileFetchPhase = 'idle' | 'loading' | 'done' | 'error' | 'timeout'
export type { AuthPhase } from '@/lib/authBootStorage'

interface AuthContextType {
  user: User | null
  profile: Profile | null
  loading: boolean
  authPhase: AuthPhase
  /** Active actor id: authenticated user or local guest. */
  bootstrapUserId: string | null
  guestId: string | null
  sessionMode: SessionMode
  isGuest: boolean
  /** True while auth bootstrap is resolving (not guest). */
  sessionRestoring: boolean
  isMigrating: boolean
  /** Shown once after sign-out when returning to guest mode. */
  signedOutToGuest: boolean
  clearSignedOutToGuest: () => void
  displayName: string
  activeActorId: string | null
  profileFetchPhase: ProfileFetchPhase
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, nickname: string) => Promise<{ error: Error | null; needsEmailConfirmation: boolean }>
  signInWithGoogle: (intent: GoogleAuthIntent) => Promise<{ error: Error | null }>
  signOut: () => Promise<{ error: Error | null }>
  updateProfile: (updates: Partial<Profile>) => Promise<{ error: Error | null }>
  /** Auth → server queue; guest → Dexie profile row only. */
  updateActorProfile: (updates: Partial<Profile>) => Promise<{ error: Error | null }>
  resetPassword: (email: string) => Promise<{ error: Error | null }>
  updatePassword: (newPassword: string) => Promise<{ error: Error | null }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const PROFILE_FETCH_STARTUP_TIMEOUT_MS = 2_000
const PROFILE_FETCH_TIMEOUT_MESSAGE = 'profile fetch timeout'
const AUTH_RECOVERY_ONCE_KEY = 'familist_auth_recovery_done_once'

type GuestMigrationPromptState = {
  guestId: string
  userId: string
  listCount: number
}

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
        k === 'last_auth_user_id' ||
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
  const [authPhase, setAuthPhase] = useState<AuthPhase>('resolving')
  const [guestId, setGuestId] = useState<string | null>(() =>
    typeof window !== 'undefined' ? ensureGuestId() : null,
  )
  const [bootstrapUserId, setBootstrapUserId] = useState<string | null>(() =>
    getInitialBootstrapUserId(),
  )
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
  const guestMigrationChoiceRef = useRef<((migrate: boolean) => void) | null>(null)
  const lastAppliedUserIdRef = useRef<string | null>(null)
  const signUpActivationHandledRef = useRef<string | null>(null)
  /** Skip duplicate enterGuestMode(same gid) when signOut + SIGNED_OUT both fire. */
  const lastEnterGuestModeGidRef = useRef<string | null>(null)
  const authPhaseRef = useRef<AuthPhase>('resolving')
  const authenticatedEstablishedRef = useRef(false)
  const initialSessionReceivedRef = useRef(false)
  const initialSessionSettledNullRef = useRef(false)
  const initialSessionTimedOutRef = useRef(false)
  const explicitSignOutInProgressRef = useRef(false)
  const hardRecoveryInProgressRef = useRef(false)
  const loadingRef = useRef(true)
  loadingRef.current = loading
  const [guestMigrationPrompt, setGuestMigrationPrompt] = useState<GuestMigrationPromptState | null>(null)

  const setAuthPhaseBoth = useCallback((phase: AuthPhase) => {
    authPhaseRef.current = phase
    setAuthPhase(phase)
  }, [])

  const sessionRestoring = authPhase === 'resolving'
  const sessionMode: SessionMode =
    authPhase === 'resolving' ? 'resolving' : authPhase === 'guest' ? 'guest' : 'authenticated'
  const isGuest = authPhase === 'guest'
  const activeActorId = resolveActiveUserId(user?.id, guestId, bootstrapUserId)
  const displayName =
    sessionRestoring ? '' : isGuest ? 'Guest' : resolveAuthDisplayName(user, profile)
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
    registerServerReadsAllowed(() => userRef.current != null)
    return () => registerServerReadsAllowed(null)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const gid = ensureGuestId()
    setGuestId(gid)
    guestIdRef.current = gid

    const phase = authPhaseRef.current
    if (phase === 'resolving') {
      const restoreId = getCachedAuthenticatedUserId(bootstrapUserIdRef.current)
      if (restoreId && !userRef.current) {
        bootstrapUserIdRef.current = restoreId
        setBootstrapUserId(restoreId)
      }
      return
    }
    if (phase === 'guest' && !userRef.current) {
      bootstrapUserIdRef.current = gid
      setBootstrapUserId(gid)
      return
    }
    if (phase === 'authenticated' && userRef.current) {
      bootstrapUserIdRef.current = userRef.current.id
      setBootstrapUserId(userRef.current.id)
    }
  }, [authPhase])

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

  const enterGuestMode = useCallback(
    async (options?: {
      freshGuest?: boolean
      signedOut?: boolean
      formerAuthUserId?: string | null
    }) => {
    const gid = options?.freshGuest ? rotateGuestId() : ensureGuestId()

    if (
      !options?.freshGuest &&
      userRef.current === null &&
      lastEnterGuestModeGidRef.current === gid
    ) {
      if (options?.signedOut) setSignedOutToGuest(true)
      return
    }

    if (options?.signedOut) {
      clearLastAuthUserId()
      if (options.formerAuthUserId) {
        await reconcileGuestDexieAfterSignOut(gid, options.formerAuthUserId)
      }
    }

    guestIdRef.current = gid
    bootstrapUserIdRef.current = gid
    setGuestId(gid)
    setBootstrapUserId(gid)
    userRef.current = null
    setUser(null)
    setProfile(null)
    lastAppliedUserIdRef.current = null
    signUpActivationHandledRef.current = null
    profileFetchGenRef.current++
    setProfileFetchPhase('idle')
    setActiveCacheUserId(gid)
    bumpReadDiscardGeneration('enter-guest-mode')
    if (options?.signedOut) setSignedOutToGuest(true)
    lastEnterGuestModeGidRef.current = gid
    void hydrateProfileFromDexie(gid)
  }, [hydrateProfileFromDexie])

  const runGuestMigration = useCallback(async (guestId: string, userId: string): Promise<void> => {
    setIsMigrating(true)
    try {
      await migrateGuestToUser(guestId, userId)
      clearStoredGuestId()
      bumpReadDiscardGeneration('guest-migration')
    } finally {
      if (mountedRef.current) setIsMigrating(false)
    }
  }, [])

  const promptGuestMigrationChoice = useCallback((guestId: string, userId: string, listCount: number) => {
    return new Promise<boolean>((resolve) => {
      guestMigrationChoiceRef.current = resolve
      setGuestMigrationPrompt({ guestId, userId, listCount })
    })
  }, [])

  const handleGuestMigrationMigrate = useCallback(() => {
    setGuestMigrationPrompt(null)
    guestMigrationChoiceRef.current?.(true)
    guestMigrationChoiceRef.current = null
  }, [])

  const handleGuestMigrationSkip = useCallback(() => {
    setGuestMigrationPrompt(null)
    guestMigrationChoiceRef.current?.(false)
    guestMigrationChoiceRef.current = null
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
      hardRecoveryInProgressRef.current = true
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
        hardRecoveryInProgressRef.current = false
        profileFetchGenRef.current++
        clearStoredGuestId()
        rotateGuestId()
        setUser(null)
        setProfile(null)
        setProfileFetchPhase('idle')
        setAuthPhaseBoth('guest')
        authenticatedEstablishedRef.current = false
        void enterGuestMode({ freshGuest: true })
        setLoading(false)
        perfLog('auth/recovery end', { source })
        if (typeof window !== 'undefined') {
          window.location.reload()
        }
      }
    },
    [enterGuestMode, setAuthPhaseBoth, supabase.auth],
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
              const hadOtherServerResponse = hasActivationServerResponse()
              log.warn('AUTH', 'fetchProfile timeout; proceeding with cached profile', {
                userId,
                gen,
                timeoutMs: PROFILE_FETCH_STARTUP_TIMEOUT_MS,
                hadCachedProfile: !!cachedProfile,
                hadOtherServerResponse,
              })
              if (!hadOtherServerResponse) {
                appendConnectivityDebugLine(
                  `[auth] profile-fetch-timeout -> enterOffline userId=${userId} gen=${gen} hadOtherServerResponse=false`,
                )
                notifyProfileFetchTimedOut()
              } else {
                appendConnectivityDebugLine(
                  `[auth] profile-fetch-timeout skipped enterOffline userId=${userId} gen=${gen} hadOtherServerResponse=true`,
                )
              }
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

  const activateAuthenticatedUserCore = useCallback(
    async (nextUser: User, source: string) => {
      if (!mountedRef.current) return
      lastAppliedUserIdRef.current = nextUser.id
      perfLog('auth activateAuthenticatedUser', { source, userId: nextUser.id })
      appendConnectivityDebugLine(
        `[auth] activateAuthenticated userId=${nextUser.id} source=${source}`,
      )
      beginActivationServerProgressWindow()
      const discardedGuestQueue = await discardGuestOutboundQueueRows()
      if (discardedGuestQueue > 0) {
        perfLog('auth/discarded-guest-outbound-queue', { count: discardedGuestQueue })
      }
      userRef.current = nextUser
      setUser(nextUser)
      setActiveCacheUserId(nextUser.id)
      setLastAuthUserId(nextUser.id)
      setBootstrapUserId(nextUser.id)
      setSignedOutToGuest(false)
      lastEnterGuestModeGidRef.current = null
      void hydrateProfileFromDexie(nextUser.id)
      scheduleStartupProfileFetch(nextUser.id)
      bumpReadDiscardGeneration('activate-authenticated-user')
    },
    [hydrateProfileFromDexie, scheduleStartupProfileFetch],
  )

  const completeSignUpWithOptionalGuestMigration = useCallback(
    async (nextUser: User, source: string) => {
      clearPendingSignUpMigration()
      if (signUpActivationHandledRef.current === nextUser.id) {
        await activateAuthenticatedUserCore(nextUser, source)
        return
      }
      signUpActivationHandledRef.current = nextUser.id

      const guestId = getStoredGuestId()
      if (guestId && isGuestId(guestId) && guestId !== nextUser.id) {
        const listCount = await countGuestOwnedLists(guestId)
        if (listCount > 0) {
          const shouldMigrate = await promptGuestMigrationChoice(guestId, nextUser.id, listCount)
          if (shouldMigrate) {
            await runGuestMigration(guestId, nextUser.id)
          }
        }
      }
      await activateAuthenticatedUserCore(nextUser, source)
    },
    [activateAuthenticatedUserCore, promptGuestMigrationChoice, runGuestMigration],
  )

  const { transitionToAuthenticated, transitionToGuest } = useAuthPhaseBootstrap(
    supabase,
    {
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
      loadingRef,
    },
    {
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
    },
  )

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
        clearPendingSignUpMigration()
        await transitionToAuthenticated(result.data.user, 'signIn')
      }

      return { error: result.error }
    } catch (error) {
      return { error: error as Error }
    }
  }

  const signInWithGoogle = async (intent: GoogleAuthIntent) => {
    try {
      const { error } = await startGoogleOAuth(intent)
      return { error: error as Error | null }
    } catch (error) {
      return { error: error instanceof Error ? error : new Error(String(error)) }
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

    if (!error && data?.user) {
      markPendingSignUpMigration()
    }

    if (!error && data?.user && data.session) {
      await completeSignUpWithOptionalGuestMigration(data.user, 'signUp')
    }

    const needsEmailConfirmation = !error && data?.user && !data.session

    return { error: error as Error | null, needsEmailConfirmation: !!needsEmailConfirmation }
  }

  const signOut = async () => {
    const formerAuthUserId = userRef.current?.id ?? lastAppliedUserIdRef.current
    explicitSignOutInProgressRef.current = true
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        explicitSignOutInProgressRef.current = false
        console.error('Sign out error:', error)
        return { error: error as Error }
      }
      if (authPhaseRef.current !== 'guest') {
        await transitionToGuest({
          source: 'signOut-fallback',
          guestPath: 'B',
          signedOut: true,
          formerAuthUserId,
        })
      }
      return { error: null }
    } catch (e) {
      explicitSignOutInProgressRef.current = false
      return { error: e instanceof Error ? e : new Error(String(e)) }
    }
  }

  const updateActorProfile = async (updates: Partial<Profile>) => {
    const actorId = userRef.current?.id ?? bootstrapUserIdRef.current
    if (!actorId) {
      return { error: new Error('Not authenticated') }
    }
    if (userRef.current) {
      return updateProfile(updates)
    }
    if (!isGuestId(actorId)) {
      return { error: new Error('Not authenticated') }
    }
    const patch = pickQueueableProfilePatch(updates)
    if (Object.keys(patch).length === 0) {
      return { error: null }
    }
    try {
      const merged = await upsertLocalProfilePatch(actorId, patch)
      if (mountedRef.current && bootstrapUserIdRef.current === actorId) {
        setProfile(merged)
      }
      return { error: null }
    } catch (error) {
      return { error: error instanceof Error ? error : new Error(String(error)) }
    }
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
        authPhase,
        bootstrapUserId,
        guestId,
        sessionMode,
        isGuest,
        sessionRestoring,
        isMigrating,
        signedOutToGuest,
        clearSignedOutToGuest: () => setSignedOutToGuest(false),
        displayName,
        activeActorId,
        profileFetchPhase,
        signIn,
        signUp,
        signInWithGoogle,
        signOut,
        updateProfile,
        updateActorProfile,
        resetPassword,
        updatePassword,
      }}
    >
      {guestMigrationPrompt ? (
        <GuestMigrateConfirmModal
          isOpen
          listCount={guestMigrationPrompt.listCount}
          onMigrate={handleGuestMigrationMigrate}
          onSkip={handleGuestMigrationSkip}
        />
      ) : null}
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
