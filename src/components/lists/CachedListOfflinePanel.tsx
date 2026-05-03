'use client'

import { useLayoutEffect, useMemo, useState } from 'react'
import { getCachedList, type CachedListData } from '@/lib/cache'
import { appendOfflineNavDiagnostic } from '@/lib/offlineNavDiagnostics'
import { Button } from '@/components/ui/Button'

type Props = {
  listId: string
  cacheUserId: string | undefined
  onClose: () => void
}

export function CachedListOfflinePanel({ listId, cacheUserId, onClose }: Props) {
  const [snapshot, setSnapshot] = useState<CachedListData | null | 'loading'>('loading')

  useLayoutEffect(() => {
    appendOfflineNavDiagnostic(
      `[offline-cached-panel] mount listId=${listId} cacheUserId=${cacheUserId ?? 'null'}`,
    )
  }, [listId, cacheUserId])

  useLayoutEffect(() => {
    const data = getCachedList(cacheUserId, listId)
    setSnapshot(data ?? null)
    appendOfflineNavDiagnostic(
      `[offline-cached-panel] read cache ok=${data ? 1 : 0} items=${data?.items?.length ?? 0}`,
    )
  }, [listId, cacheUserId])

  const { activeItems, archivedItems } = useMemo(() => {
    if (!snapshot || snapshot === 'loading') {
      return { activeItems: [] as CachedListData['items'], archivedItems: [] as CachedListData['items'] }
    }
    const items = [...snapshot.items].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    return {
      activeItems: items.filter(i => !i.archived),
      archivedItems: items.filter(i => i.archived),
    }
  }, [snapshot])

  if (snapshot === 'loading') {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white dark:bg-neutral-800">
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading cached list…</p>
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-white dark:bg-neutral-800 px-6">
        <p className="text-center text-gray-700 dark:text-gray-200">This list is not available offline.</p>
        <Button type="button" variant="secondary" onClick={onClose}>
          Back to lists
        </Button>
      </div>
    )
  }

  const { list, members } = snapshot

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white dark:bg-neutral-800 overflow-hidden">
      <header className="shrink-0 border-b border-gray-200 dark:border-neutral-700 px-3 py-3 sm:px-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-teal dark:text-teal-300 hover:underline shrink-0"
        >
          ← Lists
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">{list.name}</h1>
          <p className="text-xs text-amber-700 dark:text-amber-300/90 mt-0.5">
            Offline — read-only cached copy
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-4 pb-safe">
        {members.length > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            {members.length} member{members.length === 1 ? '' : 's'} (details hidden offline)
          </p>
        )}

        <ul className="space-y-2">
          {activeItems.map(item => (
            <li
              key={item.id}
              className="rounded-lg border border-gray-200 dark:border-neutral-600 px-3 py-2 text-gray-900 dark:text-gray-100 text-sm"
            >
              {item.text}
            </li>
          ))}
        </ul>

        {archivedItems.length > 0 && (
          <>
            <div className="flex items-center gap-2 my-4">
              <div className="flex-1 h-px bg-gray-200 dark:bg-neutral-600" />
              <span className="text-xs text-gray-500 dark:text-gray-400">Archived items</span>
              <div className="flex-1 h-px bg-gray-200 dark:bg-neutral-600" />
            </div>
            <ul className="space-y-2 opacity-70">
              {archivedItems.map(item => (
                <li
                  key={item.id}
                  className="rounded-lg border border-gray-200 dark:border-neutral-600 px-3 py-2 text-gray-700 dark:text-gray-300 text-sm line-through decoration-gray-400"
                >
                  {item.text}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
