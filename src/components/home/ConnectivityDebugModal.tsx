'use client'

import { useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { useConnectivityDebugLog } from '@/hooks/useConnectivityDebugLog'
import {
  clearConnectivityDebugLog,
  CONNECTIVITY_DEBUG_LOG_TITLE,
  formatConnectivityDebugModalCopy,
} from '@/lib/connectivityDebugLog'
import { copyTextToClipboard } from '@/lib/clipboard'

const actionBtnClass =
  'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 touch-manipulation hover:bg-gray-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-gray-200 dark:hover:bg-neutral-700'

const rowMetaClass = 'text-gray-500 dark:text-gray-500'
const logPreClass =
  'max-h-[min(60vh,28rem)] overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-800 dark:text-gray-200'

export function ConnectivityDebugModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  const { status: connectivityStatus } = useConnectivity()
  const { lines } = useConnectivityDebugLog()
  const [copyHint, setCopyHint] = useState<string | null>(null)

  const fullCopyText = useMemo(
    () => formatConnectivityDebugModalCopy(connectivityStatus, lines),
    [connectivityStatus, lines],
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
    clearConnectivityDebugLog()
    flashCopyHint('Cleared')
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Connectivity debug"
      size="lg"
      contentClassName="!max-w-lg max-sm:!max-w-none"
      fullScreenMobile
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => void copyAll()} className={actionBtnClass}>
            Copy
          </button>
          <button type="button" onClick={() => void clearAll()} className={actionBtnClass}>
            Clear
          </button>
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {CONNECTIVITY_DEBUG_LOG_TITLE}
          </h3>
          <p className={`text-xs ${rowMetaClass}`}>connectivity: {connectivityStatus}</p>
          {lines.length === 0 ? (
            <p className="text-sm text-gray-800 dark:text-gray-200">
              No connectivity events yet this session.
            </p>
          ) : (
            <pre className={logPreClass} aria-label="Connectivity log">
              {lines.join('\n')}
            </pre>
          )}
        </section>
      </div>

      {copyHint ? (
        <p className="text-center text-xs text-teal" role="status">
          {copyHint}
        </p>
      ) : null}
    </Modal>
  )
}
