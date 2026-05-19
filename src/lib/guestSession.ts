const GUEST_ID_STORAGE_KEY = 'familist_guest_id'
const GUEST_ID_PREFIX = 'guest_'

export function isGuestId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(GUEST_ID_PREFIX)
}

export function createGuestId(): string {
  return `${GUEST_ID_PREFIX}${crypto.randomUUID()}`
}

export function getStoredGuestId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(GUEST_ID_STORAGE_KEY)
    if (raw && isGuestId(raw)) return raw
    return null
  } catch {
    return null
  }
}

export function setStoredGuestId(id: string): void {
  if (typeof window === 'undefined') return
  if (!isGuestId(id)) return
  try {
    localStorage.setItem(GUEST_ID_STORAGE_KEY, id)
  } catch {
    // ignore
  }
}

export function clearStoredGuestId(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(GUEST_ID_STORAGE_KEY)
  } catch {
    // ignore
  }
}

/** Reuse stored guest id or create and persist a new one. */
export function ensureGuestId(): string {
  const existing = getStoredGuestId()
  if (existing) return existing
  const id = createGuestId()
  setStoredGuestId(id)
  return id
}

/** Always allocate a fresh guest id (e.g. after sign-out from a real account). */
export function rotateGuestId(): string {
  const id = createGuestId()
  setStoredGuestId(id)
  return id
}
