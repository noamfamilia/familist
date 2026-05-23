import { createClient } from '@/lib/supabase/client'
import {
  clearOpenProfileAfterOAuthSignUp,
  markOpenProfileAfterOAuthSignUp,
} from '@/lib/authOAuthPostRedirect'
import { clearPendingSignUpMigration, markPendingSignUpMigration } from '@/lib/authSignUpMigration'

/** Google gets SHA-256 hex; Supabase gets the raw nonce. */
export async function generateGoogleOneTapNonce(): Promise<[raw: string, hashed: string]> {
  const raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
  const encoded = new TextEncoder().encode(raw)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  const hashed = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return [raw, hashed]
}

export type GoogleOneTapSignInOptions = {
  /** Guest flow: enable guest list migration like “Sign up with Google”. */
  treatAsSignUp?: boolean
}

export async function signInWithGoogleOneTapCredential(
  credential: string,
  nonce: string,
  options?: GoogleOneTapSignInOptions,
) {
  if (options?.treatAsSignUp) {
    markPendingSignUpMigration()
    markOpenProfileAfterOAuthSignUp()
  } else {
    clearPendingSignUpMigration()
    clearOpenProfileAfterOAuthSignUp()
  }

  const supabase = createClient()
  return supabase.auth.signInWithIdToken({
    provider: 'google',
    token: credential,
    nonce,
  })
}
