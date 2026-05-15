import { db, type DbProfileRow } from '@/lib/db'
import type { Profile } from '@/lib/supabase/types'

export function profileFromDexieRow(row: DbProfileRow): Profile {
  return {
    ...row,
    theme: row.theme === 'dark' ? 'dark' : 'light',
  }
}

export async function readProfileFromDexie(userId: string): Promise<Profile | null> {
  const cached = await db.profiles.get(userId)
  if (!cached) return null
  return profileFromDexieRow(cached)
}
