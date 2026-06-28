import { db, type DbProfileRow } from '@/lib/db'
import { syncFieldsForLocalInsert } from '@/lib/data/base_sync_fields'
import { upsertProfileFromServer } from '@/lib/data/serverDexieParity'
import type { QueueableProfilePatch } from '@/lib/data/profileOutboundQueue'
import type { Profile } from '@/lib/supabase/types'

export function profileFromDexieRow(row: DbProfileRow): Profile {
  return {
    ...row,
    theme: row.theme === 'dark' ? 'dark' : 'light',
    text_direction: row.text_direction === 'rtl' ? 'rtl' : 'ltr',
  }
}

export async function readProfileFromDexie(userId: string): Promise<Profile | null> {
  const cached = await db.profiles.get(userId)
  if (!cached) return null
  return profileFromDexieRow(cached)
}

function defaultLocalProfile(userId: string): Profile {
  return {
    id: userId,
    email: null,
    nickname: null,
    label_filter: 'Any',
    theme: 'light',
    text_direction: 'ltr',
    ...syncFieldsForLocalInsert(),
  }
}

/** Persist profile preferences locally (guest / offline actor). */
export async function upsertLocalProfilePatch(
  userId: string,
  patch: QueueableProfilePatch,
): Promise<Profile> {
  const existing = await readProfileFromDexie(userId)
  const merged = { ...(existing ?? defaultLocalProfile(userId)), ...patch } as Profile
  await upsertProfileFromServer(merged)
  return merged
}
