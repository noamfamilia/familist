'use client'

import { Modal } from '@/components/ui/Modal'

export interface GuestShareSignInModalProps {
  isOpen: boolean
  onClose: () => void
}

/** Shown when a guest tries to share, join via invite link, or open share settings. */
export function GuestShareSignInModal({ isOpen, onClose }: GuestShareSignInModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Sign in required"
      size="sm"
      hideClose
      manageHistory={false}
    >
      <p className="text-center text-gray-700 dark:text-gray-300 leading-relaxed mb-6">
        You need to sign-in to share and join lists
      </p>
      <button
        type="button"
        onClick={onClose}
        className="w-full px-4 py-2.5 text-base font-medium text-white bg-red-500 rounded-lg hover:bg-red-600"
      >
        Dismiss
      </button>
    </Modal>
  )
}
