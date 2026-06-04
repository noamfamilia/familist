'use client'

import { useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useDragSnapDebugLog } from '@/hooks/useDragSnapDebugLog'
import {
  clearDragSnapDebugLog,
  DRAG_SNAP_DEBUG_TITLE,
  formatDragSnapDebugModalCopy,
} from '@/lib/dragSnapDebugLog'
import { copyTextToClipboard } from '@/lib/clipboard'

const actionBtnClass =
  'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 touch-manipulation hover:bg-gray-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-gray-200 dark:hover:bg-neutral-700'

const rowMetaClass = 'text-gray-500 dark:text-gray-500'
const logPreClass =
  'max-h-[min(60vh,28rem)] overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-800 dark:text-gray-200'

export function DragSnapDebugModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  const { lastSnap, lines } = useDragSnapDebugLog()
  const [copyHint, setCopyHint] = useState<string | null>(null)

  const fullCopyText = useMemo(
    () => formatDragSnapDebugModalCopy(lastSnap, lines),
    [lastSnap, lines],
  )

  const flashCopyHint = (label: string) => {
    setCopyHint(label)
    window.setTimeout(() => setCopyHint(null), 1500)
  }

  const copyAll = async () => {
    await copyTextToClipboard(fullCopyText)
    flashCopyHint('Copied')
  }

  const clearAll = () => {
    clearDragSnapDebugLog()
    flashCopyHint('Cleared')
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={DRAG_SNAP_DEBUG_TITLE}
      size="lg"
      contentClassName="!max-w-lg max-sm:!max-w-none"
      fullScreenMobile
    >
      <div className="flex flex-col gap-4">
        <p className={`text-xs ${rowMetaClass}`}>
          Enable with <code className="text-gray-700 dark:text-gray-300">?debugDrag=1</code> or{' '}
          <code className="text-gray-700 dark:text-gray-300">localStorage.DEBUG_DRAG=&quot;1&quot;</code>
        </p>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => void copyAll()} className={actionBtnClass}>
            Copy
          </button>
          <button type="button" onClick={() => void clearAll()} className={actionBtnClass}>
            Clear
          </button>
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Last snap</h3>
          {lastSnap ? (
            <>
              <p className={`text-xs ${rowMetaClass}`}>
                reason: {lastSnap.reason} · item: {lastSnap.itemId} · surface: {lastSnap.surface}
              </p>
              <pre className={logPreClass} aria-label="Last drag snap snapshot">
                {JSON.stringify(lastSnap, null, 2)}
              </pre>
            </>
          ) : (
            <p className="text-sm text-gray-800 dark:text-gray-200">
              Drag an item until it snaps back — this modal opens automatically on capture.
            </p>
          )}
        </section>

        {lines.length > 1 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Event log</h3>
            <pre className={logPreClass} aria-label="Drag snap event log">
              {lines.join('\n\n---\n\n')}
            </pre>
          </section>
        ) : null}
      </div>

      {copyHint ? (
        <p className="text-center text-xs text-teal" role="status">
          {copyHint}
        </p>
      ) : null}
    </Modal>
  )
}
