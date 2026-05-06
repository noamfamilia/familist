import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'
import {
  upsertListDataPayloadFromServer,
  upsertListsSummaryFromServer,
} from '@/lib/data/serverDexieParity'

const supabase = createClient()

type UserListsRpcRow = Database['public']['Functions']['get_user_lists']['Returns'][number]

export async function syncLists(userId: string) {
  const { data, error } = await supabase.rpc('get_user_lists')
  if (error) throw error
  const rows = (data ?? []) as UserListsRpcRow[]
  await upsertListsSummaryFromServer(userId, rows)
}

export async function syncListDetail(userId: string, listId: string) {
  const { data, error } = await supabase.rpc('get_list_data', { p_list_id: listId })
  if (error) throw error
  const list = data?.list ?? null
  const items = data?.items ?? []
  const members = data?.members ?? []

  await upsertListDataPayloadFromServer(userId, listId, { list, items, members })
}
