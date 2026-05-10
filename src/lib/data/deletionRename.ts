/**
 * Shadow-delete phase (Dexie only): append `_del_<epoch>` so the original display name can be reused
 * locally while the row is tombstoned. The sync worker performs a plain hard DELETE on Postgres and
 * then removes the shadow row from Dexie (see `shadowDeleteDexieCleanup.ts`).
 */
export function withDeletionNameSuffix(rawName: string): string {
  const base = typeof rawName === 'string' ? rawName : ''
  return `${base}_del_${Date.now()}`
}
