import { createClient } from '@/lib/supabase/client'
import {
  clearPendingSignUpMigration,
  markPendingSignUpMigration,
} from '@/lib/authSignUpMigration'

export type GoogleAuthIntent = 'signIn' | 'signUp'

export function authOAuthRedirectUrl(): string {
  if (typeof window === 'undefined') return '/auth/callback'
  return `${window.location.origin}/auth/callback`
}

export async function signInWithGoogle(intent: GoogleAuthIntent) {
  if (intent === 'signUp') {
    markPendingSignUpMigration()
  } else {
    clearPendingSignUpMigration()
  }

  const supabase = createClient()
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: authOAuthRedirectUrl(),
    },
  })
}
