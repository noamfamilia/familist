import type { User } from '@supabase/supabase-js'
import { clearPendingSignUpMigration } from '@/lib/authSignUpMigration'
import { userHasGoogleIdentity } from '@/lib/googleProfileNickname'

export type GoogleAuthIntent = 'signIn' | 'signUp'

/** After Google OAuth sign-up, home opens the profile modal once (not sign-in). */
export const OPEN_PROFILE_AFTER_OAUTH_SIGNUP_KEY = 'familist_open_profile_after_oauth_signup'

const OAUTH_INTENT_KEY = 'familist_oauth_intent'
const EXISTING_ACCOUNT_NOTICE_KEY = 'familist_oauth_existing_account_notice'

/** Accounts older than this are treated as sign-in when user chose sign-up. */
const EXISTING_ACCOUNT_AGE_MS = 120_000

export function markOpenProfileAfterOAuthSignUp(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(OPEN_PROFILE_AFTER_OAUTH_SIGNUP_KEY, '1')
  } catch {
    // ignore
  }
}

export function clearOpenProfileAfterOAuthSignUp(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(OPEN_PROFILE_AFTER_OAUTH_SIGNUP_KEY)
  } catch {
    // ignore
  }
}

export function consumeOpenProfileAfterOAuthSignUp(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (sessionStorage.getItem(OPEN_PROFILE_AFTER_OAUTH_SIGNUP_KEY) !== '1') return false
    sessionStorage.removeItem(OPEN_PROFILE_AFTER_OAUTH_SIGNUP_KEY)
    return true
  } catch {
    return false
  }
}

export function markOAuthIntent(intent: GoogleAuthIntent): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(OAUTH_INTENT_KEY, intent)
  } catch {
    // ignore
  }
}

export function consumeOAuthIntent(): GoogleAuthIntent | null {
  if (typeof window === 'undefined') return null
  try {
    const v = sessionStorage.getItem(OAUTH_INTENT_KEY)
    sessionStorage.removeItem(OAUTH_INTENT_KEY)
    if (v === 'signIn' || v === 'signUp') return v
    return null
  } catch {
    return null
  }
}

export function markOAuthExistingAccountSignInNotice(message: string): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(EXISTING_ACCOUNT_NOTICE_KEY, message)
  } catch {
    // ignore
  }
}

export function consumeOAuthExistingAccountSignInNotice(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const v = sessionStorage.getItem(EXISTING_ACCOUNT_NOTICE_KEY)
    sessionStorage.removeItem(EXISTING_ACCOUNT_NOTICE_KEY)
    return v?.trim() ? v : null
  } catch {
    return null
  }
}

export function isExistingAuthUser(user: User): boolean {
  const created = Date.parse(user.created_at)
  if (!Number.isFinite(created)) return false
  return Date.now() - created > EXISTING_ACCOUNT_AGE_MS
}

export function isOAuthUserAlreadyExistsError(
  error: string | null,
  errorDescription: string | null,
): boolean {
  const blob = `${error ?? ''} ${errorDescription ?? ''}`.toLowerCase()
  if (!blob.trim()) return false
  return (
    blob.includes('already registered') ||
    blob.includes('user already registered') ||
    blob.includes('email already') ||
    blob.includes('already exists') ||
    blob.includes('account already')
  )
}

function existingAccountSignInMessage(user: User): string {
  const identities = user.identities ?? []
  const hasEmail = identities.some((i) => i.provider === 'email')
  const hasGoogle = userHasGoogleIdentity(user)
  if (hasEmail && hasGoogle) {
    return 'This email already has an account. Signing you in and linking your Google account.'
  }
  return 'This email already has an account. Signing you in.'
}

/**
 * User chose sign-up but OAuth returned an existing account — treat as sign-in:
 * no profile modal, no guest migration prompt, show an info toast on home.
 */
export function applyOAuthSignUpDowngradeForExistingAccount(user: User): boolean {
  if (!isExistingAuthUser(user)) return false

  clearOpenProfileAfterOAuthSignUp()
  clearPendingSignUpMigration()
  markOAuthExistingAccountSignInNotice(existingAccountSignInMessage(user))
  return true
}
