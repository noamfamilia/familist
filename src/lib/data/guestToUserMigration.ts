import { db, type DbSyncQueueRow } from '@/lib/db'
import { isGuestId } from '@/lib/guestSession'
import { perfLog } from '@/lib/startupPerfLog'

function replaceGuestInValue(value: unknown, guestId: string, userId: string): unknown {
  if (value === guestId) return userId
  if (Array.isArray(value)) return value.map((v) => replaceGuestInValue(v, guestId, userId))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = replaceGuestInValue(v, guestId, userId)
    }
    return out
  }
  return value
}

function migrateSyncQueueRow(row: DbSyncQueueRow, guestId: string, userId: string): DbSyncQueueRow {
  const next: DbSyncQueueRow = {
    ...row,
    payload: replaceGuestInValue(row.payload, guestId, userId) as Record<string, unknown>,
  }
  if (next.parent1_type === 'user' && next.parent1_id === guestId) {
    next.parent1_id = userId
  }
  if (next.parent2_type === 'user' && next.parent2_id === guestId) {
    next.parent2_id = userId
  }
  return next
}

function migrateGuestLocalStorageKeys(guestId: string, userId: string): void {
  if (typeof window === 'undefined') return
  const renames: Array<{ from: string; to: string }> = []
  const prefixes = [
    `cached_lists_${guestId}`,
    `recent_lists_${guestId}`,
    `label_filter_${guestId}`,
  ]
  for (const from of prefixes) {
    renames.push({ from, to: from.replace(guestId, userId) })
  }

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      if (key.startsWith(`cached_list_${guestId}_`)) {
        renames.push({ from: key, to: key.replace(`cached_list_${guestId}_`, `cached_list_${userId}_`) })
      }
      if (key.startsWith(`list_${guestId}_`) && key.endsWith('_prefs')) {
        renames.push({ from: key, to: key.replace(`list_${guestId}_`, `list_${userId}_`) })
      }
    }
    for (const { from, to } of renames) {
      const val = localStorage.getItem(from)
      if (val == null) continue
      if (localStorage.getItem(to) == null) {
        localStorage.setItem(to, val)
      }
      localStorage.removeItem(from)
    }
  } catch {
    // ignore
  }
}

/** Lists owned by the guest (catalog items to offer for migration on sign-up). */
export async function countGuestOwnedLists(guestId: string): Promise<number> {
  if (!isGuestId(guestId)) return 0
  return db.lists.where('owner_id').equals(guestId).count()
}

export async function countGuestScopedRows(guestId: string): Promise<number> {
  const [lists, listUsers, members, queue] = await Promise.all([
    db.lists.where('owner_id').equals(guestId).count(),
    db.list_users.where('user_id').equals(guestId).count(),
    db.members.filter((m) => m.created_by === guestId).count(),
    db.sync_queue.filter((r) => JSON.stringify(r).includes(guestId)).count(),
  ])
  return lists + listUsers + members + queue
}

/**
 * Rewrites Dexie rows, sync_queue payloads, and localStorage keys from a local guest id to a Supabase user id.
 */
export async function migrateGuestToUser(guestId: string, userId: string): Promise<void> {
  if (!isGuestId(guestId) || guestId === userId) return

  const t0 = performance.now()
  perfLog('guest/migrate start', { guestId, userId })

  await db.transaction(
    'rw',
    [
      db.lists,
      db.list_users,
      db.items,
      db.members,
      db.item_member_state,
      db.profiles,
      db.feedback,
      db.sync_queue,
      db.offline_route_markers,
    ],
    async () => {
      const ownedLists = await db.lists.where('owner_id').equals(guestId).toArray()
      for (const list of ownedLists) {
        await db.lists.update(list.id, { owner_id: userId })
      }

      const memberships = await db.list_users.where('user_id').equals(guestId).toArray()
      for (const row of memberships) {
        const conflict = await db.list_users.where('[list_id+user_id]').equals([row.list_id, userId]).first()
        if (conflict && conflict.id !== row.id) {
          const guestTs = Date.parse(row.updated_at ?? '') || 0
          const existingTs = Date.parse(conflict.updated_at ?? '') || 0
          if (guestTs > existingTs) {
            await db.list_users.delete(conflict.id)
            await db.list_users.update(row.id, { user_id: userId })
          } else {
            await db.list_users.delete(row.id)
          }
        } else {
          await db.list_users.update(row.id, { user_id: userId })
        }
      }

      const members = await db.members.filter((m) => m.created_by === guestId).toArray()
      for (const m of members) {
        await db.members.update(m.id, { created_by: userId })
      }

      const guestProfile = await db.profiles.get(guestId)
      if (guestProfile) {
        const existingProfile = await db.profiles.get(userId)
        if (!existingProfile) {
          await db.profiles.put({ ...guestProfile, id: userId })
        }
        await db.profiles.delete(guestId)
      }

      const feedbackRows = await db.feedback.where('user_id').equals(guestId).toArray()
      for (const fb of feedbackRows) {
        await db.feedback.update(fb.id, { user_id: userId })
      }

      const markers = await db.offline_route_markers.where('user_id').equals(guestId).toArray()
      for (const marker of markers) {
        await db.offline_route_markers.update(marker.id, { user_id: userId })
      }

      const queueRows = await db.sync_queue.toArray()
      for (const row of queueRows) {
        const serialized = JSON.stringify(row)
        if (!serialized.includes(guestId)) continue
        await db.sync_queue.put(migrateSyncQueueRow(row, guestId, userId))
      }
    },
  )

  migrateGuestLocalStorageKeys(guestId, userId)

  perfLog('guest/migrate end', {
    guestId,
    userId,
    durationMs: Math.round(performance.now() - t0),
  })
}
