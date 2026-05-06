'use client'

import { APP_VERSION, parseSemver } from '@/lib/appVersion'
import { db } from '@/lib/db'
import { createClient } from '@/lib/supabase/client'
import Dexie from 'dexie'

const LAST_FORCED_RELOAD_MAJOR_META_KEY = 'lastForcedReloadMajor'
const supabase = createClient()

async function removeRejectedLocalListCopy(userId: string, listId: string): Promise<void> {
  await db.transaction('rw', db.lists, db.items, db.members, db.item_member_state, db.sync_queue, async () => {
    await db.lists.delete([userId, listId])
    const [items, members, states, queueRows] = await Promise.all([
      db.items.where('[userId+listId]').equals([userId, listId]).toArray(),
      db.members.where('[userId+listId]').equals([userId, listId]).toArray(),
      db.item_member_state.where('[listId+item_id]').between([listId, Dexie.minKey], [listId, Dexie.maxKey]).toArray(),
      db.sync_queue.where('listId').equals(listId).toArray(),
    ])
    for (const row of items) await db.items.delete([userId, listId, row.id])
    for (const row of members) await db.members.delete([userId, listId, row.id])
    for (const row of states) await db.item_member_state.delete([listId, row.item_id, row.member_id])
    for (const row of queueRows) await db.sync_queue.delete([row.listId, row.itemKey])
  })
}

async function pruneRejectedLocalListsOnMajorUpgrade(): Promise<void> {
  const pendingCreates = await db.sync_queue
    .where('kind')
    .equals('create')
    .filter((row) => row.entity === 'list')
    .toArray()

  if (pendingCreates.length === 0) return

  const allListRows = await db.lists.toArray()
  const userByListId = new Map<string, string>()
  for (const row of allListRows) userByListId.set(row.id, row.userId)

  for (const row of pendingCreates) {
    const listId = String(row.payload.id ?? '')
    const listName = String(row.payload.name ?? '')
    const listLabel = String(row.payload.label ?? '')
    if (!listId || !listName) continue

    const { error } = await supabase.rpc('create_list', {
      p_id: listId,
      p_name: listName,
      p_label: listLabel,
    } as never)

    if (!error) {
      await db.sync_queue.delete([row.listId, row.itemKey])
      continue
    }

    const userId = userByListId.get(listId)
    if (!userId) {
      await db.sync_queue.delete([row.listId, row.itemKey])
      continue
    }
    await removeRejectedLocalListCopy(userId, listId)
  }
}

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

    await pruneRejectedLocalListsOnMajorUpgrade()

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
