'use client'

import { useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { Modal } from '@/components/ui/Modal'
import { PendingQueueStatusSection } from '@/components/home/PendingQueueStatusSection'
import { db } from '@/lib/db'
import { resolveCatalogMutationUserId } from '@/lib/catalogMutationUserId'
import { enqueueSyncQueueRecord, userQueueParent } from '@/lib/data/syncQueue'
import { isoNow, syncFieldsForLocalInsert } from '@/lib/data/base_sync_fields'
import { normalizeServerSyncableFields } from '@/lib/data/serverDexieParity'
import type { Profile } from '@/lib/supabase/types'
import { shareMyFamilistApp } from '@/lib/shareFamilistApp'

interface AboutModalProps {
  isOpen: boolean
  onClose: () => void
  user: User | null
  profile: Profile | null
  guestId: string | null
  bootstrapUserId: string | null
  isGuest: boolean
  success: (message: string) => void
  showError: (message: string) => void
}

export function AboutModal({
  isOpen,
  onClose,
  user,
  profile,
  guestId,
  bootstrapUserId,
  isGuest,
  success,
  showError,
}: AboutModalProps) {
  const [feedbackText, setFeedbackText] = useState('')
  const [submittingFeedback, setSubmittingFeedback] = useState(false)

  const handleClose = () => {
    setFeedbackText('')
    onClose()
  }

  const handleSubmitFeedback = async () => {
    const feedbackUserId = resolveCatalogMutationUserId(user?.id, guestId, bootstrapUserId)
    if (!feedbackText.trim() || !feedbackUserId) return
    setSubmittingFeedback(true)
    try {
      const id = crypto.randomUUID()
      const t = isoNow()
      const sync = syncFieldsForLocalInsert({ client_created_at: t })
      const feedbackEmail = user?.email ?? profile?.email ?? ''
      const base = {
        id,
        user_id: feedbackUserId,
        email: feedbackEmail,
        message: feedbackText.trim(),
        ...sync,
      }
      const normalized = normalizeServerSyncableFields(base as Record<string, unknown>)
      await db.transaction('rw', db.feedback, db.lists, db.sync_queue, db.list_users, async () => {
        await db.feedback.put({ ...base, ...normalized } as never)
        await enqueueSyncQueueRecord({
          entity: 'feedback',
          entity_id: id,
          kind: 'create',
          payload: {
            id,
            user_id: feedbackUserId,
            email: feedbackEmail,
            message: base.message,
            client_created_at: sync.client_created_at,
          },
          ...userQueueParent(feedbackUserId),
          status: 'queued',
        })
      })
      success('Thank you for your feedback!')
      setFeedbackText('')
    } catch {
      showError('Failed to submit feedback')
    } finally {
      setSubmittingFeedback(false)
    }
  }

  const showFeedback = !isGuest && user

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="My Familist"
      size="lg"
      contentClassName="!max-w-lg max-sm:!max-w-none"
      fullScreenMobile
    >
      <div className="flex flex-col gap-5 text-left">
        <button
          type="button"
          onClick={() => void shareMyFamilistApp({ success, error: showError })}
          className="self-start text-left text-sm font-normal text-blue-600 hover:underline focus:underline focus:outline-none dark:text-blue-400"
          aria-label="Share the app"
        >
          Click to share the app
        </button>

        {showFeedback ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-normal text-gray-800 dark:text-gray-200">Leave feedback</p>
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="Share your suggestions or feedback..."
              className="w-full min-h-[120px] resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-teal focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-gray-200"
              maxLength={2000}
            />
            <div className="flex justify-end">
              <button
                type="button"
                disabled={!feedbackText.trim() || submittingFeedback}
                onClick={() => void handleSubmitFeedback()}
                className="rounded-lg bg-teal px-4 py-1.5 text-sm font-medium text-white hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submittingFeedback ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </div>
        ) : null}

        <p className="whitespace-pre-line text-sm font-normal text-gray-800 dark:text-gray-200">
          {`Enjoy the app,\nNoam Familia`}
        </p>

        <PendingQueueStatusSection />
      </div>
    </Modal>
  )
}
