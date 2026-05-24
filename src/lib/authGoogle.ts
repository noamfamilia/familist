import { createClient } from '@/lib/supabase/client'
import {
  clearOpenProfileAfterOAuthSignUp,
  markOAuthIntent,
  markOpenProfileAfterOAuthSignUp,
  type GoogleAuthIntent,
} from '@/lib/authOAuthPostRedirect'

export type { GoogleAuthIntent } from '@/lib/authOAuthPostRedirect'

export function authOAuthRedirectUrl(): string {
  if (typeof window === 'undefined') return '/auth/callback'
  return `${window.location.origin}/auth/callback`
}

export async function signInWithGoogle(intent: GoogleAuthIntent) {
  markOAuthIntent(intent)
  if (intent === 'signUp') {
    markOpenProfileAfterOAuthSignUp()
  } else {
    clearOpenProfileAfterOAuthSignUp()
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
  clearOpenProfileAfterOAuthSignUp()
  const supabase = createClient()
  return supabase.auth.linkIdentity({
    provider: 'google',
    options: {
      redirectTo: authOAuthRedirectUrl(),
    },
  })
}
