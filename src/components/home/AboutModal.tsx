'use client'

import { Modal } from '@/components/ui/Modal'
import { PendingQueueStatusSection } from '@/components/home/PendingQueueStatusSection'

const sectionRuleClass = 'border-gray-200 dark:border-neutral-600'

const ABOUT_MESSAGE = `I hope you enjoy the app.
Share with me ideas for improvements.
Yours,
Noam Familia`

interface AboutModalProps {
  isOpen: boolean
  onClose: () => void
}

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="My Familist"
      size="lg"
      contentClassName="!max-w-lg max-sm:!max-w-none"
      fullScreenMobile
    >
      <div className="flex flex-col gap-6 text-left">
        <p className="whitespace-pre-line text-sm font-normal text-gray-800 dark:text-gray-200">
          {ABOUT_MESSAGE}
        </p>

        <hr className={sectionRuleClass} aria-hidden />

        <PendingQueueStatusSection />
      </div>
    </Modal>
  )
}
