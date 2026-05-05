import { db } from '@/lib/db'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

const supabase = createClient()

type UserListsRpcRow = Database['public']['Functions']['get_user_lists']['Returns'][number]

export async function syncLists(userId: string) {
  const { data, error } = await supabase.rpc('get_user_lists')
  if (error) throw error
  const rows = (data ?? []) as UserListsRpcRow[]

  await db.transaction('rw', db.lists, async () => {
    for (const row of rows) {
      const queueKey = [row.id, row.id] as const
      const queued = await db.sync_queue.get(queueKey)
      if (queued?.kind === 'delete') continue
      await db.lists.put({
        ...row,
        userId,
        cachedAt: Date.now(),
        deleted_at: null,
      })
    }
  })
}

export async function syncListDetail(userId: string, listId: string) {
  const { data, error } = await supabase.rpc('get_list_data', { p_list_id: listId })
  if (error) throw error
  const list = data?.list ?? null
  const items = data?.items ?? []
  const members = data?.members ?? []

  await db.transaction('rw', db.listDetails, db.items, db.members, db.item_member_state, async () => {
    await db.listDetails.put({
      userId,
      listId,
      list: list ? { ...list, role: 'viewer', userArchived: false } : null,
      cachedAt: Date.now(),
      schemaVersion: 1,
      deleted_at: null,
    })

    for (const item of items) {
      const queued = await db.sync_queue.get([listId, item.id])
      if (queued?.kind === 'delete') continue
      await db.items.put({
        ...item,
        userId,
        listId,
        deleted_at: null,
      })
      for (const state of Object.values(item.memberStates ?? {})) {
        await db.item_member_state.put({
          ...state,
          listId,
          deleted_at: null,
        })
      }
    }

    for (const member of members) {
      const queued = await db.sync_queue.get([listId, `mbr:${member.id}`])
      if (queued?.kind === 'delete') continue
      await db.members.put({
        ...member,
        userId,
        listId,
        deleted_at: null,
      })
    }
  })
}
