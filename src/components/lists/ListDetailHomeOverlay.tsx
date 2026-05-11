'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { useHasMounted } from '@/hooks/useHasMounted'
import { Modal } from '@/components/ui/Modal'

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
 * List detail on `/` when opened from the home shell (no App Router transition).
 * Uses the same `Modal` sizing as label manager: full-screen on small viewports, centered
 * `max-w-lg` card on `sm+`. Portaled to `document.body` so layout cannot clip it.
 *
 * URL bar is synced with `history.pushState` to `/list/[id]` while open and back to the prior
 * path (usually `/`) on close, so the address looks like a list route without a Next transition.
 * Browser / hardware Back is handled on the home route (`popstate` → `setActiveListId(null)`).
 */
export function ListDetailHomeOverlay({ listId, onClose }: ListDetailHomeOverlayProps) {
  const mounted = useHasMounted()

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

  if (!mounted) return null

  return createPortal(
    <Modal
      isOpen
      onClose={onClose}
      manageHistory={false}
      fullScreenMobile
      hideClose
      size="lg"
      contentClassName="!max-w-lg max-sm:!max-w-none !p-0 sm:!p-0"
    >
      <ListDetailView key={listId} listId={listId} surface="home_modal" onRequestClose={onClose} />
    </Modal>,
    document.body,
  )
}
