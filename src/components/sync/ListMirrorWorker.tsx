'use client'

import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef } from 'react'
import { useAuth } from '@/providers/AuthProvider'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { db } from '@/lib/db'
import { drainListMirrorQueueOnce, LIST_MIRROR_QUEUE_META_ID } from '@/lib/data/listMirror'
import { runOneTimeReconcileAfterDexieSchemaBelow10Upgrade } from '@/lib/data/versionCheck'

/**
 * Drains the Dexie-backed list mirror queue when online: one `get_list_data` at a time,
 * respecting per-list locks shared with `useList` `fetchList`.
 */
export function ListMirrorWorker() {
  const { user, loading, bootstrapUserId } = useAuth()
  const { status, markOnlineRecovered } = useConnectivity()
  const userId = user?.id ?? (loading ? bootstrapUserId : null)

  const queueLen = useLiveQuery(
    async () => {
      const row = await db.meta.get(LIST_MIRROR_QUEUE_META_ID)
      const ids = (row?.value as { ids?: string[] } | undefined)?.ids ?? []
      return ids.length
    },
    [],
    0,
  )

  const drainingRef = useRef(false)
  const schema10ReconcileRef = useRef(false)

  useEffect(() => {
    if (status !== 'online' || !userId || schema10ReconcileRef.current) return
    schema10ReconcileRef.current = true
    void runOneTimeReconcileAfterDexieSchemaBelow10Upgrade(userId).finally(() => {
      schema10ReconcileRef.current = false
    })
  }, [status, userId])

  useEffect(() => {
    if (status !== 'online' || !userId) return
    if (!queueLen || queueLen <= 0) return

    let cancelled = false
    const tick = async () => {
      if (drainingRef.current) return
      drainingRef.current = true
      try {
        for (let i = 0; i < 8 && !cancelled; i++) {
          const result = await drainListMirrorQueueOnce(userId)
          if (result.succeeded) {
            markOnlineRecovered('list-mirror-success')
          }
          if (result.processed === 0) break
        }
      } finally {
        drainingRef.current = false
      }
    }

    void tick()
    const id = window.setInterval(() => {
      void tick()
    }, 1_200)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [markOnlineRecovered, queueLen, status, userId])

  return null
}
