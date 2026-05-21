/** After Google OAuth sign-up, home opens the profile modal once (not sign-in). */

export const OPEN_PROFILE_AFTER_OAUTH_SIGNUP_KEY = 'familist_open_profile_after_oauth_signup'

export function markOpenProfileAfterOAuthSignUp(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(OPEN_PROFILE_AFTER_OAUTH_SIGNUP_KEY, '1')
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
