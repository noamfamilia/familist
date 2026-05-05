'use client'

import { APP_VERSION, parseSemver } from '@/lib/appVersion'
import { db } from '@/lib/db'

const LAST_FORCED_RELOAD_MAJOR_META_KEY = 'lastForcedReloadMajor'

export async function checkMajorVersionMismatchOnBoot(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    const currentMajor = parseSemver(APP_VERSION).major
    const listRows = await db.lists.toArray()

    let storedMajor = 0
    for (const row of listRows) {
      const major = parseSemver(row.app_version ?? '0.0.0').major
      if (major > storedMajor) storedMajor = major
    }

    const metaRow = await db.meta.get(LAST_FORCED_RELOAD_MAJOR_META_KEY)
    const lastForcedReloadMajor =
      typeof metaRow?.value === 'number' && Number.isFinite(metaRow.value) ? metaRow.value : 0

    if (currentMajor <= storedMajor || lastForcedReloadMajor >= currentMajor) return

    await db.meta.put({
      key: LAST_FORCED_RELOAD_MAJOR_META_KEY,
      value: currentMajor,
      updatedAt: Date.now(),
    })

    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((reg) => reg.unregister()))
    }

    window.location.reload()
  } catch {
    // Never block startup on version-check issues.
  }
}
