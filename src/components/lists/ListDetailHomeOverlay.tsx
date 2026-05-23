'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { useHasMounted } from '@/hooks/useHasMounted'
import { popBodyScrollLock, pushBodyScrollLock } from '@/lib/bodyScrollLock'
import { syncHomeListHistoryPath } from '@/lib/navigation/backToHome'

const ListDetailView = dynamic(
  () => import('./ListDetailView').then((m) => ({ default: m.ListDetailView })),
  { ssr: false },
)

export type ListDetailHomeOverlayProps = {
  listId: string
  onClose: () => void
}

/**
 * Full-viewport overlay on `/` when a list is open from the home shell (no App Router transition).
 * Portaled to `document.body`. Mobile: edge-to-edge. `sm+`: dimmed backdrop; list shell centered
 * on the x-axis and aligned to the top (`items-center` + `justify-start`); panel matches the
 * pre–home-modal list route shell — `w-fit` / `sm:min-h-0` so height grows with content and the
 * overlay backdrop scrolls (same idea as the full page before `2b7e918`). On small viewports,
 * horizontal overflow is allowed so wide member rows can be panned; `sm+` keeps horizontal clip on the backdrop.
 *
 * URL bar is synced to `/list/[id]` via one `pushState` per open session; switching lists uses
 * `replaceState`. UI close pops that entry (`closeHomeListOverlay`); system Back uses `popstate`.
 */
export function ListDetailHomeOverlay({ listId, onClose }: ListDetailHomeOverlayProps) {
  const mounted = useHasMounted()

  useEffect(() => {
    pushBodyScrollLock()
    return () => popBodyScrollLock()
  }, [])

  useEffect(() => {
    syncHomeListHistoryPath(listId)
  }, [listId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex min-h-0 flex-col overflow-y-auto overflow-x-auto sm:overflow-x-hidden bg-white dark:bg-neutral-800 sm:items-center sm:justify-start sm:bg-black/50 sm:dark:bg-black/70 sm:p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex w-full flex-col bg-white dark:bg-neutral-800 max-sm:min-h-[100dvh] max-sm:max-h-[100dvh] max-sm:flex-1 max-sm:overflow-y-auto max-sm:overflow-x-auto sm:min-h-0 sm:w-fit sm:max-w-[calc(100vw-2rem)] sm:flex-none sm:overflow-visible sm:rounded-xl sm:shadow-lg dark:sm:shadow-black/40"
        role="dialog"
        aria-modal="true"
        aria-label="List"
      >
        <ListDetailView key={listId} listId={listId} surface="home_modal" onRequestClose={onClose} />
      </div>
    </div>,
    document.body,
  )
}
