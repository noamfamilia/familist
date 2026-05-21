/** sessionStorage flag: run guest-list migration prompt on next authenticated activation (email or OAuth sign-up). */

export const PENDING_SIGNUP_MIGRATION_KEY = 'familist_pending_signup_migration'

export function consumePendingSignUpMigration(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (sessionStorage.getItem(PENDING_SIGNUP_MIGRATION_KEY) !== '1') return false
    sessionStorage.removeItem(PENDING_SIGNUP_MIGRATION_KEY)
    return true
  } catch {
    return false
  }
}

export function markPendingSignUpMigration(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(PENDING_SIGNUP_MIGRATION_KEY, '1')
  } catch {
    // ignore
  }
}

export function clearPendingSignUpMigration(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(PENDING_SIGNUP_MIGRATION_KEY)
  } catch {
    // ignore
  }
}
