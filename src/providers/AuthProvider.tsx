'use client'

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { useTheme } from 'next-themes'
import { createClient, forceNewClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '@/lib/supabase/types'
import { clearActiveCacheUserId, getActiveCacheUserId, setActiveCacheUserId } from '@/lib/cache'
import { notifyProfileFetchSucceeded, notifyProfileFetchTimedOut } from '@/lib/profileFetchConnectivityBridge'
import { perfLog } from '@/lib/startupPerfLog'
import { scheduleAfterFirstPaint } from '@/lib/startupPerf'
import { isStartupDiagnosticsEnabled } from '@/lib/startupDiagnostics'

export type ProfileFetchPhase = 'idle' | 'loading' | 'done' | 'error' | 'timeout'

interface AuthContextType {
  user: User | null
  profile: Profile | null
  loading: boolean
  /** Last active_cache_user id while session is still resolving; drives list hydration before user is set. */
  bootstrapUserId: string | null
  profileFetchPhase: ProfileFetchPhase
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, nickname: string) => Promise<{ error: Error | null; needsEmailConfirmation: boolean }>
  signOut: () => Promise<{ error: Error | null }>
  updateProfile: (updates: Partial<Profile>) => Promise<{ error: Error | null }>
  resetPassword: (email: string) => Promise<{ error: Error | null }>
  updatePassword: (newPassword: string) => Promise<{ error: Error | null }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const PROFILE_FETCH_STARTUP_TIMEOUT_MS = 10_000
const PROFILE_FETCH_TIMEOUT_MESSAGE = 'profile fetch timeout'

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
  const [bootstrapUserId, setBootstrapUserId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : getActiveCacheUserId(),
  )
  const [profileFetchPhase, setProfileFetchPhase] = useState<ProfileFetchPhase>('idle')
  const supabase = createClient()
  const { setTheme } = useTheme()

  const mountedRef = useRef(true)
  const userRef = useRef<User | null>(null)
  const profileFetchGenRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    userRef.current = user
  }, [user])

  const fetchProfile = useCallback(async (userId: string) => {
    const t0 = performance.now()
    perfLog('auth/fetchProfile start', { userId })
    try {
      perfLog('auth/fetchProfile profiles query start', { userId })
      const q0 = performance.now()
      const freshClient = forceNewClient()
      const { data, error } = await freshClient
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()
      perfLog('auth/fetchProfile profiles query end', {
        userId,
        durationMs: Math.round(performance.now() - q0),
        hasRow: !!data,
        rpcError: error?.message,
      })

      if (!mountedRef.current || userRef.current?.id !== userId) return
      if (error) return
      if (!data) return
      const row = data as Profile & { theme?: string }
      setProfile({
        ...row,
        theme: row.theme === 'dark' ? 'dark' : 'light',
      })
      notifyProfileFetchSucceeded()
    } catch (err) {
      console.error('fetchProfile error:', err)
    } finally {
      perfLog('auth/fetchProfile end', {
        userId,
        durationMs: Math.round(performance.now() - t0),
      })
    }
  }, [])

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

  useEffect(() => {
    let mounted = true
    let subscription: { unsubscribe: () => void } | null = null
    const hydratedFromGetSessionRef = { current: false }
    const lastAppliedUserIdRef = { current: null as string | null }

    const applySessionUserCore = (nextUser: User | null, source: string) => {
      if (!mounted) return
      perfLog('auth applySessionUser', { source, hasUser: !!nextUser, userId: nextUser?.id ?? null })
      perfLog('auth setUser before', { source, nextUserId: nextUser?.id ?? null })
      setUser(nextUser)
      perfLog('auth setUser after dispatch', { source, nextUserId: nextUser?.id ?? null })
      lastAppliedUserIdRef.current = nextUser?.id ?? null
      if (nextUser) {
        setActiveCacheUserId(nextUser.id)
        setBootstrapUserId(nextUser.id)
        scheduleStartupProfileFetch(nextUser.id)
      } else {
        profileFetchGenRef.current++
        setProfile(null)
        setBootstrapUserId(null)
        clearActiveCacheUserId()
        setProfileFetchPhase('idle')
      }
    }

    void (async () => {
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0
      perfLog('auth/session start')
      try {
        perfLog('auth/getSession start')
        const gs0 = performance.now()
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
        perfLog('auth/getSession end', {
          durationMs: Math.round(performance.now() - gs0),
          hasSession: !!sessionData?.session,
          error: sessionError?.message,
        })

        if (!mounted) return

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
        applySessionUserCore(nextUser, 'getSession')
        perfLog('auth/getSession applySessionUser end', {
          hasUser: !!nextUser,
          userId: nextUser?.id ?? null,
        })
      } catch (error) {
        console.error('Failed to get session:', error)
        perfLog('auth/session try error', {
          message: error instanceof Error ? error.message : String(error),
        })
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
          applySessionUserCore(nextUser, 'onAuthStateChange')
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

        perfLog('auth onAuthStateChange', { event, hasSession: !!session })
        applySessionUserCore(nextUser, 'onAuthStateChange')
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
  }, [scheduleStartupProfileFetch, supabase.auth])

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
        // Update local state directly (no cross-tab sync)
        setUser(result.data.user)
        setActiveCacheUserId(result.data.user.id)
        setBootstrapUserId(result.data.user.id)
        scheduleStartupProfileFetch(result.data.user.id)
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
      setUser(data.user)
      setActiveCacheUserId(data.user.id)
      setBootstrapUserId(data.user.id)
      scheduleStartupProfileFetch(data.user.id)
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

    setUser(null)
    setProfile(null)
    setBootstrapUserId(null)
    clearActiveCacheUserId()
    setProfileFetchPhase('idle')
    return { error: null }
  }

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) {
      return { error: new Error('Not authenticated') }
    }

    const prev = profile
    setProfile((p) => (p ? { ...p, ...updates } : null))

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)

    if (error) {
      setProfile(prev)
    }

    return { error: error as Error | null }
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
        profileFetchPhase,
        signIn,
        signUp,
        signOut,
        updateProfile,
        resetPassword,
        updatePassword,
      }}
    >
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
