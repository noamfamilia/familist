'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { createClient, forceNewClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '@/lib/supabase/types'
import { clearActiveCacheUserId, setActiveCacheUserId } from '@/lib/cache'

interface AuthContextType {
  user: User | null
  profile: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, username: string, nickname: string) => Promise<{ error: Error | null; needsEmailConfirmation: boolean }>
  signOut: () => Promise<{ error: Error | null }>
  updateProfile: (updates: Partial<Profile>) => Promise<{ error: Error | null }>
  resetPassword: (email: string) => Promise<{ error: Error | null }>
  updatePassword: (newPassword: string) => Promise<{ error: Error | null }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

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
  const supabase = createClient()

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const freshClient = forceNewClient()
      const { data, error } = await freshClient
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()

      if (error) return
      setProfile(data)
    } catch (err) {
      console.error('fetchProfile error:', err)
    }
  }, [])

  useEffect(() => {
    let mounted = true

    const syncSessionState = async (nextUser: User | null) => {
      if (!mounted) return

      setUser(nextUser)

      if (nextUser) {
        setActiveCacheUserId(nextUser.id)
        await fetchProfile(nextUser.id)
      } else {
        setProfile(null)
        clearActiveCacheUserId()
      }
    }
    
    const getInitialSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!mounted) return
        await syncSessionState(session?.user ?? null)
      } catch (error) {
        console.error('Failed to get session:', error)
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    getInitialSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void syncSessionState(session?.user ?? null)
      if (mounted) {
        setLoading(false)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [fetchProfile, supabase.auth])


  const signIn = async (email: string, password: string) => {
    try {
      // Use fresh client to avoid stale connection issues
      const freshClient = forceNewClient()

      const result = await withTimeout(
        freshClient.auth.signInWithPassword({ email, password }),
        10000,
        'Sign in timed out. Please refresh the page.'
      )
      
      if (!result.error && result.data?.user) {
        // Update local state directly (no cross-tab sync)
        setUser(result.data.user)
        setActiveCacheUserId(result.data.user.id)
        await fetchProfile(result.data.user.id)
      }
      
      return { error: result.error }
    } catch (error) {
      return { error: error as Error }
    }
  }

  const signUp = async (email: string, password: string, username: string, nickname: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, nickname },
        emailRedirectTo: `${window.location.origin}/auth/callback`
      }
    })

    // If sign up successful and user is returned (no email confirmation required)
    if (!error && data?.user && data.session) {
      setUser(data.user)
      setActiveCacheUserId(data.user.id)
      await fetchProfile(data.user.id)
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
    clearActiveCacheUserId()
    return { error: null }
  }

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) {
      return { error: new Error('Not authenticated') }
    }

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)

    if (!error) {
      setProfile(prev => prev ? { ...prev, ...updates } : null)
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
    <AuthContext.Provider value={{ user, profile, loading, signIn, signUp, signOut, updateProfile, resetPassword, updatePassword }}>
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
