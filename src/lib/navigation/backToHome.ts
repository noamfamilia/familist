type AppRouterLike = {
  back: () => void
  replace: (href: string) => void
}

type HomeListHistoryState = { familistHomeList?: string }

const HOME_LIST_PATH_RE = /^\/list\/[^/]+/

const GUEST_INVITE_DISMISSED_KEY = 'familist_guest_invite_dismissed'

export function isOnHomeListPath(): boolean {
  if (typeof window === 'undefined') return false
  return HOME_LIST_PATH_RE.test(window.location.pathname)
}

/** Session flag: guest dismissed the invite sign-in modal; strip `invite` when normalizing home. */
export function isGuestInviteDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return sessionStorage.getItem(GUEST_INVITE_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export function markGuestInviteDismissed(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(GUEST_INVITE_DISMISSED_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function clearGuestInviteDismissed(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(GUEST_INVITE_DISMISSED_KEY)
  } catch {
    /* ignore */
  }
}

/** Home href on `/` without `list` or (optionally) `invite` query keys. */
export function getCleanHomeHref(options?: {
  stripInvite?: boolean
  searchParams?: URLSearchParams
}): string {
  const params =
    options?.searchParams ??
    new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
  const next = new URLSearchParams(params.toString())
  next.delete('list')
  if (options?.stripInvite) next.delete('invite')
  const q = next.toString()
  return q ? `/?${q}` : '/'
}

/** Replace the current history entry URL in place (does not change stack depth). */
export function replaceBrowserUrlInPlace(href: string): void {
  if (typeof window === 'undefined') return
  window.history.replaceState(window.history.state, '', href)
}

/** Normalize the current entry to a clean home URL; returns the href applied. */
export function normalizeHomeHistoryUrl(options?: { stripInvite?: boolean }): string {
  const stripInvite = options?.stripInvite ?? isGuestInviteDismissed()
  const href = getCleanHomeHref({ stripInvite })
  replaceBrowserUrlInPlace(href)
  return href
}

/** Sync Next.js router with the current browser URL after in-place history edits. */
export function finalizeHomeAfterListClose(
  router: AppRouterLike,
  options?: { stripInvite?: boolean },
): void {
  const href = normalizeHomeHistoryUrl(options)
  router.replace(href)
}

export type PopHomeListResult = 'back' | 'replaced' | false

/** Sync URL to `/list/[id]` without growing the stack when switching lists from home. */
export function syncHomeListHistoryPath(listId: string) {
  if (typeof window === 'undefined') return
  if (isGuestInviteDismissed()) {
    normalizeHomeHistoryUrl({ stripInvite: true })
  }
  const listPath = `/list/${listId}`
  const state: HomeListHistoryState = { familistHomeList: listId }
  const current = window.history.state as HomeListHistoryState | null
  if (current?.familistHomeList) {
    window.history.replaceState(state, '', listPath)
  } else {
    window.history.pushState(state, '', listPath)
  }
}

/**
 * Drop the home-modal list history entry.
 * `back` — popped one entry; `popstate` should clear UI and normalize home.
 * `replaced` — only one entry; URL replaced in place; caller must finalize UI.
 */
export function popHomeListHistoryEntry(): PopHomeListResult {
  if (typeof window === 'undefined') return false
  const state = window.history.state as HomeListHistoryState | null
  const onHomeListPath = isOnHomeListPath()
  if (!state?.familistHomeList && !onHomeListPath) return false
  if (window.history.length > 1) {
    window.history.back()
    return 'back'
  }
  normalizeHomeHistoryUrl({ stripInvite: isGuestInviteDismissed() })
  return 'replaced'
}

/** Close list overlay from home: pop list entry when possible, else replace in place. */
export function closeHomeListOverlay(
  router: AppRouterLike,
  setActiveListId: (listId: string | null) => void,
  options?: { stripInvite?: boolean },
): void {
  const stripInvite = options?.stripInvite ?? isGuestInviteDismissed()
  const result = popHomeListHistoryEntry()
  if (result === 'back') return
  setActiveListId(null)
  finalizeHomeAfterListClose(router, { stripInvite })
}

/** Prefer history.back() so mobile/OS back stack stays correct; avoid pushing a second `/` entry. */
export function navigateBackToHome(router: AppRouterLike) {
  if (typeof window !== 'undefined' && window.history.length > 1) {
    router.back()
    return
  }
  router.replace(getCleanHomeHref({ stripInvite: isGuestInviteDismissed() }))
}
