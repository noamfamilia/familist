import { createClient } from '@/lib/supabase/client'
import {
  markOAuthIntent,
  markOpenProfileAfterOAuthSignUp,
  type GoogleAuthIntent,
} from '@/lib/authOAuthPostRedirect'
import {
  clearPendingSignUpMigration,
  markPendingSignUpMigration,
} from '@/lib/authSignUpMigration'

export type { GoogleAuthIntent } from '@/lib/authOAuthPostRedirect'

export function authOAuthRedirectUrl(): string {
  if (typeof window === 'undefined') return '/auth/callback'
  return `${window.location.origin}/auth/callback`
}

export async function signInWithGoogle(intent: GoogleAuthIntent) {
  markOAuthIntent(intent)
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
  markOAuthIntent('signIn')
  clearPendingSignUpMigration()
  const supabase = createClient()
  return supabase.auth.linkIdentity({
    provider: 'google',
    options: {
      redirectTo: authOAuthRedirectUrl(),
    },
  })
}
