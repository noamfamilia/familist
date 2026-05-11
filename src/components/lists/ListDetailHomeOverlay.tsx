'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { useHasMounted } from '@/hooks/useHasMounted'
import { popBodyScrollLock, pushBodyScrollLock } from '@/lib/bodyScrollLock'

function pathSearchHash(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

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
 * Renders via `createPortal` to `document.body` so parent layout/transform cannot clip it.
 * Uses `z-40` so shared `Modal` instances (z-50) can stack above.
 *
 * URL bar is synced with `history.pushState` to `/list/[id]` while open and back to the prior
 * path (usually `/`) on close, so the address looks like a list route without a Next transition.
 * Browser / hardware Back is handled on the home route (`popstate` → `setActiveListId(null)`).
 */
export function ListDetailHomeOverlay({ listId, onClose }: ListDetailHomeOverlayProps) {
  const mounted = useHasMounted()

  useEffect(() => {
    pushBodyScrollLock()
    return () => popBodyScrollLock()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const base = pathSearchHash()
    const listPath = `/list/${listId}`
    window.history.pushState({ familistHomeList: listId }, '', listPath)

    return () => {
      const cur = pathSearchHash()
      if (cur !== base) {
        window.history.pushState({}, '', base)
      }
    }
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
      className="fixed inset-0 z-40 flex min-h-0 flex-col overflow-hidden bg-white dark:bg-neutral-800"
      role="dialog"
      aria-modal="true"
      aria-label="List"
    >
      <ListDetailView key={listId} listId={listId} surface="home_modal" onRequestClose={onClose} />
    </div>,
    document.body,
  )
}
