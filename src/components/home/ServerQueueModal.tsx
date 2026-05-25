'use client'

import { Modal } from '@/components/ui/Modal'
import { PendingQueueStatusSection } from '@/components/home/PendingQueueStatusSection'

export function ServerQueueModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Server queue"
      size="lg"
      contentClassName="!max-w-lg max-sm:!max-w-none"
      fullScreenMobile
    >
      <PendingQueueStatusSection />
    </Modal>
  )
}
