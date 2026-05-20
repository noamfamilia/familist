'use client'

import { useCallback, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { formatSignOutCatalogDebugLog, useSignOutCatalogDebugStore } from '@/lib/debug/signOutCatalogDebug'

export function SignOutCatalogDebugModal() {
  const entries = useSignOutCatalogDebugStore((s) => s.entries)
  const modalOpen = useSignOutCatalogDebugStore((s) => s.modalOpen)
  const setModalOpen = useSignOutCatalogDebugStore((s) => s.setModalOpen)
  const clear = useSignOutCatalogDebugStore((s) => s.clear)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)

  const text = useMemo(() => formatSignOutCatalogDebugLog(entries), [entries])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus('Copied')
      setTimeout(() => setCopyStatus(null), 2000)
    } catch {
      setCopyStatus('Copy failed')
    }
  }, [text])

  return (
    <Modal
      isOpen={modalOpen}
      onClose={() => setModalOpen(false)}
      title="Sign-out catalog debug log"
      size="lg"
      fullScreenMobile
      headerActions={
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={handleCopy}>
            {copyStatus ?? 'Copy'}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => clear()}>
            Clear
          </Button>
        </div>
      }
    >
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        Sign out once, then open this log from the profile menu (below User feedback). Use Copy to share the
        sequence — look for duplicate <code className="text-teal">bootstrap</code> / discarded{' '}
        <code className="text-teal">warmListsCatalog</code> entries.
      </p>
      <pre className="text-[11px] leading-snug font-mono whitespace-pre-wrap break-all max-h-[min(70vh,520px)] overflow-y-auto p-3 rounded-lg bg-neutral-100 dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700">
        {text || '(no entries yet — sign out to capture a session)'}
      </pre>
    </Modal>
  )
}
