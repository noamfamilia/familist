'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useHasMounted } from '@/hooks/useHasMounted'
import { popBodyScrollLock, pushBodyScrollLock } from '@/lib/bodyScrollLock'
import { syncHomeListHistoryPath } from '@/lib/navigation/backToHome'
import { ListDetailView } from './ListDetailView'

export type ListDetailHomeOverlayProps = {
  listId: string
  onClose: () => void
}

/**
 * Full-viewport overlay on `/` when a list is open from the home shell (no App Router transition).
 * Portaled to `document.body`. Mobile: one vertical scrollport on the panel; horizontal pan lives
 * in the list table zone inside `ListDetailView`. `sm+`: dimmed backdrop; list shell centered on
 * the x-axis and aligned to the top; backdrop scrolls vertically when content is tall.
 *
 * URL bar is synced to `/list/[id]` via one `pushState` per open session; switching lists uses
 * `replaceState`. UI close pops that entry (`closeHomeListOverlay`); system Back uses `popstate`.
 *
 * `ListDetailView` is statically imported (not `next/dynamic`). The dynamic + React.lazy +
 * Suspense first-resolved cycle added ~300 ms to the first visible list-open; static import
 * removes that wrapper cost at the expense of a larger home shell bundle.
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
      className="fixed inset-0 z-40 flex min-h-0 flex-col overflow-hidden sm:overflow-y-auto sm:overflow-x-hidden bg-white dark:bg-neutral-800 sm:items-center sm:justify-start sm:bg-black/50 sm:dark:bg-black/70 sm:p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex h-[100dvh] w-full flex-col overflow-y-auto overflow-x-hidden bg-white dark:bg-neutral-800 sm:h-auto sm:min-h-0 sm:max-h-none sm:w-fit sm:max-w-[calc(100vw-2rem)] sm:flex-none sm:overflow-visible sm:rounded-xl sm:shadow-lg dark:sm:shadow-black/40"
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
