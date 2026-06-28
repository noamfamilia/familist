import type { Profile } from '@/lib/supabase/types'
import type { DbSyncQueueRow } from '@/lib/db'
import { enqueueSyncQueueRecord, userQueueParent } from '@/lib/data/syncQueue'
import { isOutboundRowPending } from '@/lib/data/syncQueueListScope'

export type QueueableProfilePatch = Pick<Profile, 'label_filter' | 'theme' | 'text_direction' | 'nickname'>

const QUEUEABLE_KEYS = ['label_filter', 'theme', 'text_direction', 'nickname'] as const satisfies readonly (keyof QueueableProfilePatch)[]

export function pickQueueableProfilePatch(updates: Partial<Profile>): QueueableProfilePatch {
  const out: Partial<QueueableProfilePatch> = {}
  for (const key of QUEUEABLE_KEYS) {
    if (updates[key] !== undefined) {
      out[key] = updates[key] as QueueableProfilePatch[typeof key]
    }
  }
  return out as QueueableProfilePatch
}

export function isProfileOutboundRow(row: DbSyncQueueRow): boolean {
  return row.entity === 'profile' && row.kind === 'patch'
}

export function hasPendingProfileOutbound(
  queue: readonly DbSyncQueueRow[],
  excludeRowId?: string,
): boolean {
  return queue.some(
    (r) =>
      r.id !== excludeRowId &&
      isOutboundRowPending(r) &&
      isProfileOutboundRow(r),
  )
}

export async function enqueueProfilePatch(userId: string, updates: Partial<Profile>): Promise<void> {
  const payload = pickQueueableProfilePatch(updates)
  if (Object.keys(payload).length === 0) return

  await enqueueSyncQueueRecord({
    entity: 'profile',
    entity_id: userId,
    kind: 'patch',
    payload,
    ...userQueueParent(userId),
  })
}
