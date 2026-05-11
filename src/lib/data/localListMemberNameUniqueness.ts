import { db } from '@/lib/db'
import { isTombstoned } from '@/lib/data/base_sync_fields'
import { isLocalItemTextUniquenessFailure } from '@/lib/data/localItemTextUniqueness'

/** Same normalization as item text / server `lower(btrim(...))` (cap 2000). */
function normalizeNameForUniqueness(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 2000)
}

function shortenForMessage(s: string, max = 72): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

export async function validateListNameForOwner(
  ownerId: string,
  name: string,
  excludeListId?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const trimmed = name.trim()
  if (!trimmed) return { ok: true }
  const target = normalizeNameForUniqueness(trimmed)
  if (!target) return { ok: true }
  let rows: { id: string; name?: string | null; deleted_at?: string | null }[]
  try {
    rows = await db.lists.where('owner_id').equals(ownerId).toArray()
  } catch {
    return { ok: false, message: 'Could not verify lists locally. Try again.' }
  }
  for (const row of rows) {
    if (isTombstoned(row.deleted_at)) continue
    if (excludeListId && row.id === excludeListId) continue
    if (normalizeNameForUniqueness(String(row.name ?? '')) === target) {
      return {
        ok: false,
        message: `A list named “${shortenForMessage(trimmed)}” already exists for your account.`,
      }
    }
  }
  return { ok: true }
}

export async function validateMemberNameForList(
  listId: string,
  name: string,
  excludeMemberId?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const trimmed = name.trim()
  if (!trimmed) return { ok: true }
  const target = normalizeNameForUniqueness(trimmed)
  if (!target) return { ok: true }
  let rows: { id: string; name?: string | null; deleted_at?: string | null; is_target?: boolean }[]
  try {
    rows = await db.members.where('list_id').equals(listId).toArray()
  } catch {
    return { ok: false, message: 'Could not verify members locally. Try again.' }
  }
  for (const row of rows) {
    if (row.is_target) continue
    if (isTombstoned(row.deleted_at)) continue
    if (excludeMemberId && row.id === excludeMemberId) continue
    if (normalizeNameForUniqueness(String(row.name ?? '')) === target) {
      return {
        ok: false,
        message: `A member named “${shortenForMessage(trimmed)}” already exists in this list.`,
      }
    }
  }
  return { ok: true }
}

/** Local Dexie uniqueness failures (items, lists, members, import/bulk item copy). */
export function isLocalDexieNameUniquenessFailure(message: string | undefined): boolean {
  if (!message) return false
  if (isLocalItemTextUniquenessFailure(message)) return true
  return message.startsWith('A list named') || message.startsWith('A member named')
}
