'use client'

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type DbSyncQueueRow } from '@/lib/db'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { resetFailedSyncQueueRows } from '@/lib/data/syncQueue'

export type SyncVisualStatus = 'OFFLINE' | 'SYNCING' | 'ERROR' | 'PENDING' | 'SYNCED'

type ConnectivityStatus = 'online' | 'recovering' | 'offline'

export type SyncStatusContextValue = {
  /** Matches sync worker: only `online` is treated as connected for queue UI. */
  isOnline: boolean
  connectivityStatus: ConnectivityStatus
  queueRows: DbSyncQueueRow[]
  pendingCount: number
  isProcessing: boolean
  hasFailed: boolean
  syncVisualStatus: SyncVisualStatus
  retryFailedSync: () => Promise<void>
}

const SyncStatusContext = createContext<SyncStatusContextValue | null>(null)

export function SyncStatusProvider({ children }: { children: ReactNode }) {
  const { status } = useConnectivity()
  const isOnline = status === 'online'

  const rawRows = useLiveQuery(async () => db.sync_queue.orderBy('updated_at').toArray(), [], [])
  const queueRows = useMemo(() => rawRows ?? [], [rawRows])

  const { pendingCount, isProcessing, hasFailed, syncVisualStatus } = useMemo(() => {
    const pendingCountInner = queueRows.length
    const isProcessingInner = queueRows.some((r) => r.status === 'processing')
    const hasFailedInner = queueRows.some((r) => r.status === 'failed')

    let syncVisualStatusInner: SyncVisualStatus
    if (!isOnline) {
      syncVisualStatusInner = 'OFFLINE'
    } else if (isProcessingInner) {
      syncVisualStatusInner = 'SYNCING'
    } else if (hasFailedInner) {
      syncVisualStatusInner = 'ERROR'
    } else if (pendingCountInner > 0) {
      syncVisualStatusInner = 'PENDING'
    } else {
      syncVisualStatusInner = 'SYNCED'
    }

    return {
      pendingCount: pendingCountInner,
      isProcessing: isProcessingInner,
      hasFailed: hasFailedInner,
      syncVisualStatus: syncVisualStatusInner,
    }
  }, [queueRows, isOnline])

  const retryFailedSync = useCallback(async () => {
    await resetFailedSyncQueueRows()
  }, [])

  const value = useMemo(
    (): SyncStatusContextValue => ({
      isOnline,
      connectivityStatus: status,
      queueRows,
      pendingCount,
      isProcessing,
      hasFailed,
      syncVisualStatus,
      retryFailedSync,
    }),
    [isOnline, status, queueRows, pendingCount, isProcessing, hasFailed, syncVisualStatus, retryFailedSync],
  )

  return <SyncStatusContext.Provider value={value}>{children}</SyncStatusContext.Provider>
}

export function useSyncStatus(): SyncStatusContextValue {
  const ctx = useContext(SyncStatusContext)
  if (!ctx) {
    throw new Error('useSyncStatus must be used within SyncStatusProvider')
  }
  return ctx
}
