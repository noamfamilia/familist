import { createClient } from '@/lib/supabase/client'
import {
  clearOpenProfileAfterOAuthSignUp,
  markOpenProfileAfterOAuthSignUp,
} from '@/lib/authOAuthPostRedirect'

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
  /** Guest flow: open profile settings after first sign-in (new accounts only). */
  openProfileAfterSignUp?: boolean
}

export const GOOGLE_EMAIL_MISMATCH_MESSAGE =
  'This Google account uses a different email and cannot be linked to your current account.'

function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase() ?? ''
  return trimmed ? trimmed : null
}

/** Read email claim from a Google ID token (JWT payload only; Supabase validates on link/sign-in). */
export function parseGoogleIdTokenEmail(credential: string): string | null {
  try {
    const payload = credential.split('.')[1]
    if (!payload) return null
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      email?: unknown
    }
    return typeof json.email === 'string' ? normalizeEmail(json.email) : null
  } catch {
    return null
  }
}

export function googleEmailMatchesAccount(
  accountEmail: string | null | undefined,
  googleCredential: string,
): boolean {
  const googleEmail = parseGoogleIdTokenEmail(googleCredential)
  if (!googleEmail) return false
  const account = normalizeEmail(accountEmail)
  return !!account && account === googleEmail
}

export async function signInWithGoogleOneTapCredential(
  credential: string,
  nonce: string,
  options?: GoogleOneTapSignInOptions,
) {
  if (options?.openProfileAfterSignUp) {
    markOpenProfileAfterOAuthSignUp()
  } else {
    clearOpenProfileAfterOAuthSignUp()
  }

  const supabase = createClient()
  return supabase.auth.signInWithIdToken({
    provider: 'google',
    token: credential,
    nonce,
  })
}

/** Link Google to the current signed-in user via One Tap ID token (manual linking must be enabled). */
export async function linkGoogleOneTapCredential(credential: string, nonce: string) {
  const supabase = createClient()
  return supabase.auth.linkIdentity({
    provider: 'google',
    token: credential,
    nonce,
  })
}
