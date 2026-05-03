import type { QueuedCreatePayload } from '@/lib/itemMutationOutbox'
import type { Database, Item, ItemMemberState } from '@/lib/supabase/types'

/** Same client shape as `createClient()` from `@/lib/supabase/client` (browser SSR client). */
export type FamilistSupabase = ReturnType<typeof import('@/lib/supabase/client').createClient>

type ItemsInsert = Database['public']['Tables']['items']['Insert']

export function newClientItemKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `cid-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

export function buildQueuedItemCreatePayload(input: {
  clientItemKey: string
  text: string
  category: number
  comment: string | null
  sort_order: number
  archived?: boolean
  archived_at?: string | null
  memberStates: Record<string, ItemMemberState>
}): QueuedCreatePayload {
  return {
    clientItemKey: input.clientItemKey,
    text: input.text,
    category: input.category,
    comment: input.comment,
    sort_order: input.sort_order,
    archived: input.archived ?? false,
    archived_at: input.archived_at ?? null,
    memberStates: { ...input.memberStates },
  }
}

export function buildItemsInsertRow(listId: string, payload: QueuedCreatePayload): ItemsInsert {
  return {
    list_id: listId,
    text: payload.text,
    sort_order: payload.sort_order,
    category: payload.category,
    ...(payload.comment != null && payload.comment !== '' ? { comment: payload.comment } : {}),
    archived: payload.archived,
    archived_at: payload.archived_at,
  }
}

/**
 * Single path for persisting a queued item create + nested item_member_state rows.
 * Used by online addItem and outbox drain.
 */
type SupabaseSingle<T> = { data: T | null; error: { message?: string; code?: string } | null }

type ItemsInsertChain = {
  insert: (v: ItemsInsert) => {
    select: () => { single: () => PromiseLike<SupabaseSingle<Item>> }
  }
}

type ImsInsertRow = {
  item_id: string
  member_id: string
  quantity: number
  done: boolean
  assigned: boolean
}

type ImsInsertChain = {
  insert: (v: ImsInsertRow) => PromiseLike<{ error: { message?: string; code?: string } | null }>
}

export async function executeQueuedItemCreateOnServer(
  supabase: FamilistSupabase,
  listId: string,
  payload: QueuedCreatePayload,
  trackSaveOperation: (p: PromiseLike<unknown>) => Promise<unknown>,
): Promise<{ data: Item }> {
  const row = buildItemsInsertRow(listId, payload)
  const itemsQ = supabase.from('items') as unknown as ItemsInsertChain
  const { data, error } = (await trackSaveOperation(itemsQ.insert(row).select().single())) as SupabaseSingle<Item>
  if (error) throw error
  if (!data) throw new Error('missing row')

  const memberStateEntries = Object.entries(payload.memberStates)
  const imsQ = supabase.from('item_member_state') as unknown as ImsInsertChain
  for (const [memberId, st] of memberStateEntries) {
    const imsRow: ImsInsertRow = {
      item_id: data.id,
      member_id: memberId,
      quantity: st.quantity,
      done: st.done,
      assigned: st.assigned,
    }
    const imsRes = (await trackSaveOperation(imsQ.insert(imsRow))) as { error: { message?: string; code?: string } | null }
    if (imsRes.error) throw imsRes.error
  }

  return { data }
}
