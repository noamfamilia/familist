import type { DbSyncableFields } from '@/lib/supabase/types'

/**
 * Shared sync metadata for Postgres and Dexie mirrors (ISO 8601 timestamps).
 * Canonical definition: `DbSyncableFields` in `src/lib/supabase/types.ts`.
 */
export type SyncableFields = DbSyncableFields

export interface SyncableRow extends SyncableFields {
  id: string
}

export function isoNow(): string {
  return new Date().toISOString()
}

/** New local rows before the server assigns `server_created_at` / bumps `version`. */
export function syncFieldsForLocalInsert(overrides?: Partial<SyncableFields>): SyncableFields {
  const t = isoNow()
  return {
    client_created_at: overrides?.client_created_at ?? t,
    server_created_at: overrides?.server_created_at ?? null,
    deleted_at: overrides?.deleted_at ?? null,
    version: overrides?.version ?? 0,
    last_synced_at: overrides?.last_synced_at ?? null,
  }
}

/** After a successful server fetch or apply, mark local mirror as reconciled. */
export function withLastSyncedNow<T extends SyncableFields>(row: T): T {
  return { ...row, last_synced_at: isoNow() }
}

/** Convert legacy Dexie tombstone (`deleted_at` as epoch ms) to ISO; pass through ISO strings. */
export function legacyDeletedAtToIso(deleted_at: unknown): string | null {
  if (deleted_at == null) return null
  if (typeof deleted_at === 'string') {
    if (deleted_at.length === 0) return null
    return deleted_at
  }
  if (typeof deleted_at === 'number' && deleted_at > 0) return new Date(deleted_at).toISOString()
  return null
}

export function isTombstoned(deleted_at: string | null | undefined): boolean {
  return deleted_at != null && deleted_at.length > 0
}

/** Normalize a Dexie row after schema upgrade (legacy `created_at`, numeric `deleted_at`). */
export function normalizeDexieEntityRow(
  row: Record<string, unknown>,
  opts?: { legacyCreatedKey?: 'created_at'; serverFallback?: string },
): Record<string, unknown> {
  const copy = { ...row }
  const lk = opts?.legacyCreatedKey
  const legacyCreated = lk ? copy[lk] : undefined
  if (lk && lk in copy) delete copy[lk]
  const server =
    typeof copy.server_created_at === 'string'
      ? copy.server_created_at
      : typeof legacyCreated === 'string'
        ? legacyCreated
        : typeof opts?.serverFallback === 'string'
          ? opts.serverFallback
          : isoNow()
  copy.server_created_at = server
  copy.client_created_at =
    typeof copy.client_created_at === 'string' ? copy.client_created_at : server
  copy.deleted_at = legacyDeletedAtToIso(copy.deleted_at)
  copy.version =
    typeof copy.version === 'number' && Number.isFinite(copy.version) ? copy.version : 1
  copy.last_synced_at = typeof copy.last_synced_at === 'string' ? copy.last_synced_at : null
  return copy
}
