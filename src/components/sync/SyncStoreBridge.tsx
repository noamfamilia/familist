'use client'

import { useSyncStore } from '@/hooks/useSyncStore'
import { ListMirrorWorker } from '@/components/sync/ListMirrorWorker'
import { useEffect } from 'react'
import { runLegacyStorageMigration } from '@/lib/data/migrate'
import { runItemMemberStateStableIdMigration } from '@/lib/data/migrateItemMemberStateStableIds'
import { checkMajorVersionMismatchOnBoot } from '@/lib/data/versionCheck'

export function SyncStoreBridge() {
  useSyncStore()

  useEffect(() => {
    void checkMajorVersionMismatchOnBoot()
    void runLegacyStorageMigration()
    void runItemMemberStateStableIdMigration()
  }, [])

  return <ListMirrorWorker />
}
