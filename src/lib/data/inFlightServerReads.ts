import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

type GetUserListsResult = Awaited<ReturnType<typeof supabase.rpc<'get_user_lists'>>>
type GetListDataResult = Awaited<ReturnType<typeof supabase.rpc<'get_list_data'>>>

const inflight = new Map<string, Promise<unknown>>()

/** If the same server read is already in flight, join that promise instead of starting another RPC. */
function coalesceInFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>

  const flight = run().finally(() => {
    if (inflight.get(key) === flight) {
      inflight.delete(key)
    }
  })
  inflight.set(key, flight)
  return flight
}

const GET_USER_LISTS_KEY = 'get_user_lists'

export function rpcGetUserLists(): Promise<GetUserListsResult> {
  return coalesceInFlight(GET_USER_LISTS_KEY, async () => supabase.rpc('get_user_lists'))
}

export function rpcGetListData(listId: string): Promise<GetListDataResult> {
  return coalesceInFlight(`get_list_data:${listId}`, async () =>
    supabase.rpc('get_list_data', { p_list_id: listId }),
  )
}
