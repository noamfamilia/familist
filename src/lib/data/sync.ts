import { createClient } from '@/lib/supabase/client'
import {
  upsertListDataPayloadFromServer,
  upsertListsSummaryFromServer,
} from '@/lib/data/serverDexieParity'
import { setLastMirroredListDetailVersion } from '@/lib/data/listMirror'
import {
  captureListReconcileGeneration,
  shouldDiscardListReconcileResult,
} from '@/lib/data/listReconcilePolicy'
import {
  canFetchFromServerNow,
  captureReadFlightGeneration,
  shouldDiscardReadFlightResult,
} from '@/lib/data/serverReadPolicy'
import { formatQuotedListName, logServerRoundTrip } from '@/lib/serverActionLog'

const supabase = createClient()

export async function syncLists(userId: string, respondsTo: string) {
  if (!canFetchFromServerNow()) return
  const readFlightGen = captureReadFlightGeneration()
  const t0 = performance.now()
  try {
    const { data, error } = await supabase.rpc('get_user_lists')
    if (error) throw error
    if (shouldDiscardReadFlightResult(readFlightGen)) return
    await upsertListsSummaryFromServer(userId, data ?? [])
    const n = Array.isArray(data) ? data.length : 0
    logServerRoundTrip({
      description: `Fetched list catalog (${n} lists)`,
      ok: true,
      durationMs: performance.now() - t0,
      respondsTo,
    })
  } catch (e) {
    logServerRoundTrip({
      description: 'Fetched list catalog',
      ok: false,
      durationMs: performance.now() - t0,
      respondsTo,
      failure: e,
    })
    throw e
  }
}

export async function syncListDetail(userId: string, listId: string, respondsTo: string) {
  if (!canFetchFromServerNow()) return
  const readFlightGen = captureReadFlightGeneration()
  const listReconcileGen = captureListReconcileGeneration(listId)
  const t0 = performance.now()
  try {
    const { data, error } = await supabase.rpc('get_list_data', { p_list_id: listId })
    if (error) throw error
    if (shouldDiscardReadFlightResult(readFlightGen)) return
    if (shouldDiscardListReconcileResult(listId, listReconcileGen)) {
      const title = formatQuotedListName(data?.list?.name, listId)
      logServerRoundTrip({
        description: `Fetched list ${title} (${data?.items?.length ?? 0} items, ${data?.members?.length ?? 0} members)`,
        ok: true,
        durationMs: performance.now() - t0,
        respondsTo: `${respondsTo} (discarded: newer list reconcile)`,
      })
      return
    }
    const list = data?.list ?? null
    const items = data?.items ?? []
    const members = data?.members ?? []

    await upsertListDataPayloadFromServer(userId, listId, { list, items, members })
    if (list) {
      await setLastMirroredListDetailVersion(listId, list.version ?? 1, list.last_content_update ?? null)
    }
    const title = formatQuotedListName(list?.name, listId)
    logServerRoundTrip({
      description: `Fetched list ${title} (${items.length} items, ${members.length} members)`,
      ok: true,
      durationMs: performance.now() - t0,
      respondsTo,
    })
  } catch (e) {
    logServerRoundTrip({
      description: `Fetched list ${formatQuotedListName(null, listId)}`,
      ok: false,
      durationMs: performance.now() - t0,
      respondsTo,
      failure: e,
    })
    throw e
  }
}
