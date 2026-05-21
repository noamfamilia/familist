import { createClient } from '@/lib/supabase/client'
import { markOpenProfileAfterOAuthSignUp } from '@/lib/authOAuthPostRedirect'
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
    markOpenProfileAfterOAuthSignUp()
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

/** Link Google to the current signed-in user (requires manual linking in Supabase project settings). */
export async function linkGoogleIdentity() {
  const supabase = createClient()
  return supabase.auth.linkIdentity({
    provider: 'google',
    options: {
      redirectTo: authOAuthRedirectUrl(),
    },
  })
}
