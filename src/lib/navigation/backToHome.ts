type AppRouterLike = {
  back: () => void
  replace: (href: string) => void
}

/** Prefer history.back() so mobile/OS back stack stays correct; avoid pushing a second `/` entry. */
export function navigateBackToHome(router: AppRouterLike) {
  if (typeof window !== 'undefined' && window.history.length > 1) {
    router.back()
    return
  }
  router.replace('/')
}
