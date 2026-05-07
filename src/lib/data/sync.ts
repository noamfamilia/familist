import { createClient } from '@/lib/supabase/client'
import {
  upsertListDataPayloadFromServer,
  upsertListsSummaryFromServer,
} from '@/lib/data/serverDexieParity'
import { setLastMirroredListDetailVersion } from '@/lib/data/listMirror'

const supabase = createClient()

export async function syncLists(userId: string) {
  const { data, error } = await supabase.rpc('get_user_lists')
  if (error) throw error
  await upsertListsSummaryFromServer(userId, data ?? [])
}

export async function syncListDetail(userId: string, listId: string) {
  const { data, error } = await supabase.rpc('get_list_data', { p_list_id: listId })
  if (error) throw error
  const list = data?.list ?? null
  const items = data?.items ?? []
  const members = data?.members ?? []

  await upsertListDataPayloadFromServer(userId, listId, { list, items, members })
  if (list) {
    await setLastMirroredListDetailVersion(listId, list.version ?? 1)
  }
}
