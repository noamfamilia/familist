import { db } from '@/lib/db'

const LOCK_KEY_PREFIX = 'list_mirror_lock:'
const LOCK_TTL_MS = 120_000

function lockMetaId(listId: string) {
  return `${LOCK_KEY_PREFIX}${listId}`
}

type LockPayload = { owner: string; until: number }

/**
 * Per-list_id mutex in Dexie `meta` so only one writer (foreground fetchList or background mirror)
 * touches items/members/IMS for that list at a time (cross-tab safe).
 */
export async function tryAcquireListMirrorLock(listId: string, owner: string): Promise<boolean> {
  const now = Date.now()
  const id = lockMetaId(listId)
  return db.transaction('rw', db.meta, async () => {
    const row = await db.meta.get(id)
    const cur = row?.value as LockPayload | undefined
    if (cur && typeof cur.until === 'number' && cur.until > now && cur.owner !== owner) {
      return false
    }
    await db.meta.put({ id, value: { owner, until: now + LOCK_TTL_MS } satisfies LockPayload, updated_at: now })
    return true
  })
}

export async function releaseListMirrorLock(listId: string, owner: string): Promise<void> {
  const id = lockMetaId(listId)
  await db.transaction('rw', db.meta, async () => {
    const row = await db.meta.get(id)
    const cur = row?.value as LockPayload | undefined
    if (cur?.owner === owner) {
      await db.meta.delete(id)
    }
  })
}

export async function waitForListMirrorLock(
  listId: string,
  owner: string,
  opts?: { maxWaitMs?: number; pollMs?: number },
): Promise<boolean> {
  const maxWait = opts?.maxWaitMs ?? 4_000
  const poll = opts?.pollMs ?? 80
  const deadline = Date.now() + maxWait
  while (Date.now() < deadline) {
    if (await tryAcquireListMirrorLock(listId, owner)) return true
    await new Promise((r) => setTimeout(r, poll))
  }
  return false
}
