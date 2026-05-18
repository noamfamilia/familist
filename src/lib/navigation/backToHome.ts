type AppRouterLike = {
  back: () => void
  replace: (href: string) => void
}

type HomeListHistoryState = { familistHomeList?: string }

const HOME_LIST_PATH_RE = /^\/list\/[^/]+/

/** Sync URL to `/list/[id]` without growing the stack when switching lists from home. */
export function syncHomeListHistoryPath(listId: string) {
  if (typeof window === 'undefined') return
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
 * Drop the home-modal list history entry. Returns true when history was adjusted;
 * caller should skip clearing UI state — `popstate` on home will do that.
 */
export function popHomeListHistoryEntry(): boolean {
  if (typeof window === 'undefined') return false
  const state = window.history.state as HomeListHistoryState | null
  const onHomeListPath = HOME_LIST_PATH_RE.test(window.location.pathname)
  if (!state?.familistHomeList && !onHomeListPath) return false
  if (window.history.length > 1) {
    window.history.back()
    return true
  }
  window.history.replaceState({}, '', '/')
  return true
}

/** Prefer history.back() so mobile/OS back stack stays correct; avoid pushing a second `/` entry. */
export function navigateBackToHome(router: AppRouterLike) {
  if (typeof window !== 'undefined' && window.history.length > 1) {
    router.back()
    return
  }
  router.replace('/')
}
