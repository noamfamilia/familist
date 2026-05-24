/** sessionStorage: guest-list migration already ran for guestId → userId this tab. */

function promptKey(guestId: string, userId: string): string {
  return `familist_guest_migration_prompt_${guestId}_${userId}`
}

export function shouldOfferGuestMigrationPrompt(guestId: string, userId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return sessionStorage.getItem(promptKey(guestId, userId)) !== '1'
  } catch {
    return true
  }
}

export function markGuestMigrationPromptOffered(guestId: string, userId: string): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(promptKey(guestId, userId), '1')
  } catch {
    // ignore
  }
}
