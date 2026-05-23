'use client'

import { APP_VERSION, parseSemver } from '@/lib/appVersion'
import { db } from '@/lib/db'
import { isTombstoned } from '@/lib/data/base_sync_fields'
import { runListMirrorJob } from '@/lib/data/listMirror'

/**
 * After `db.delete()`, Dexie `meta` is gone, so we persist “already wiped for this app major” in
 * localStorage to avoid a reload loop on every boot.
 */
export const FAMILIST_DEXIE_LAST_CLEARED_APP_MAJOR_LS_KEY = 'familist_dexie_last_cleared_app_major'

function readLastClearedDexieAppMajor(): number {
  if (typeof window === 'undefined') return Number.MAX_SAFE_INTEGER
  try {
    const raw = localStorage.getItem(FAMILIST_DEXIE_LAST_CLEARED_APP_MAJOR_LS_KEY)
    const n = Number.parseInt(raw ?? '0', 10)
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

/** Call after a full Dexie wipe (emergency reset or major-version reset) so we do not wipe again on every reload. */
export function markDexieClearedForCurrentAppMajorInLocalStorage(): void {
  if (typeof window === 'undefined') return
  try {
    const major = parseSemver(APP_VERSION).major
    localStorage.setItem(FAMILIST_DEXIE_LAST_CLEARED_APP_MAJOR_LS_KEY, String(major))
  } catch {
    // ignore quota / private mode
  }
}

/** Set in `db.ts` Dexie schema v10 upgrade when migrating from a version below 10. */
export const PENDING_SCHEMA_10_MIRROR_RECONCILE_META_ID = 'pending_schema_10_full_mirror_reconcile'

/**
 * After a Dexie upgrade to schema v10, pulls `get_list_data` for every non-tombstoned list once
 * (bypassing the normal mirror version gate) so `version` / `server_created_at` and other server
 * fields reconcile onto legacy local rows via `upsertListDataPayloadFromMirror` without wiping
 * local-only edits that the mirror path preserves.
 */
export async function runOneTimeReconcileAfterDexieSchemaBelow10Upgrade(userId: string): Promise<void> {
  if (typeof window === 'undefined' || !userId) return
  try {
    await db.open()
    if (db.verno < 10) return

    const pending = await db.meta.get(PENDING_SCHEMA_10_MIRROR_RECONCILE_META_ID)
    if (pending?.value !== true) return

    const lists = await db.lists.toArray()
    for (const row of lists) {
      if (isTombstoned(row.deleted_at ?? null)) continue
      await runListMirrorJob(userId, row.id, { bypassVersionGate: true })
    }
    await db.meta.delete(PENDING_SCHEMA_10_MIRROR_RECONCILE_META_ID)
  } catch (e) {
  }
}

/**
 * When the app’s semver **major** (MSB) increases vs the last boot where Dexie was cleared for that
 * major (e.g. 1.x → 2.0.0, 2.x → 3.0.0), wipe IndexedDB the same way as Diagnostic “Emergency reset”, unregister
 * service workers, and hard-reload. `NEXT_PUBLIC_APP_VERSION` comes from `package.json` via `next.config.mjs`.
 */
export async function checkMajorVersionMismatchOnBoot(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    const currentMajor = parseSemver(APP_VERSION).major
    if (readLastClearedDexieAppMajor() >= currentMajor) return

    await db.delete()
    markDexieClearedForCurrentAppMajorInLocalStorage()

    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((reg) => reg.unregister()))
    }

    window.location.reload()
  } catch {
    // Never block startup on version-check issues.
  }
}
