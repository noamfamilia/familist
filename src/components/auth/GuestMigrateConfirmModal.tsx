'use client'

import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

interface GuestMigrateConfirmModalProps {
  isOpen: boolean
  listCount: number
  onMigrate: () => void
  onSkip: () => void
}

export function GuestMigrateConfirmModal({
  isOpen,
  listCount,
  onMigrate,
  onSkip,
}: GuestMigrateConfirmModalProps) {
  const n = Math.max(1, listCount)
  const listLabel = n === 1 ? '1 list' : `${n} lists`

  return (
    <Modal
      isOpen={isOpen}
      onClose={onSkip}
      title="Migrate guest lists to your account?"
      size="sm"
      hideClose
      manageHistory={false}
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          You have {listLabel} on this device from guest mode. Copy them into your signed-in account?
          They stay on this device only — nothing is synced back into guest mode.
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Choose No to keep guest lists separate. You can still browse as a guest after signing out.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
          <Button className="w-full sm:w-auto" onClick={onMigrate}>
            Yes, migrate lists
          </Button>
          <Button variant="secondary" className="w-full sm:w-auto" onClick={onSkip}>
            No, start fresh
          </Button>
        </div>
      </div>
    </Modal>
  )
}
