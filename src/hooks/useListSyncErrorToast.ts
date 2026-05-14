'use client'

import { useEffect, useRef } from 'react'
import { useToast } from '@/components/ui/Toast'
import type { List } from '@/lib/supabase/types'

/**
 * Toast immediately when the active list row gains a non-empty `sync_error_message` (terminal outbound sync).
 * Only runs for `list.id === scopeListId` so session switches do not surface another list's error.
 */
export function useListSyncErrorToast(list: List | null, scopeListId: string) {
  const { error: showError } = useToast()
  const lastShownRef = useRef<string | null>(null)

  useEffect(() => {
    if (!list || list.id !== scopeListId) {
      lastShownRef.current = null
      return
    }
    const raw = list.sync_error_message
    const msg = typeof raw === 'string' ? raw.trim() : ''
    if (!msg) {
      lastShownRef.current = null
      return
    }
    if (lastShownRef.current === msg) return
    lastShownRef.current = msg
    showError(msg, { serverError: new Error(msg) })
  }, [list, list?.sync_error_message, list?.id, scopeListId, showError])
}
