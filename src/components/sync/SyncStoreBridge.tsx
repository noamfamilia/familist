'use client'

import { useSyncStore } from '@/hooks/useSyncStore'
import { useEffect } from 'react'
import { runLegacyStorageMigration } from '@/lib/data/migrate'
import { checkMajorVersionMismatchOnBoot } from '@/lib/data/versionCheck'

export function SyncStoreBridge() {
  useSyncStore()

  useEffect(() => {
    void checkMajorVersionMismatchOnBoot()
    void runLegacyStorageMigration()
  }, [])

  return null
}
