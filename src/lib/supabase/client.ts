import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types'

export type AppSupabaseClient = SupabaseClient<Database>

function createBrowserClientForApp(url: string, key: string): AppSupabaseClient {
  return createBrowserClient<Database>(url, key) as unknown as AppSupabaseClient
}

let client: AppSupabaseClient | null = null

export function createClient(): AppSupabaseClient {
  if (!client) {
    client = createBrowserClientForApp(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return client
}

// Force create a new client (useful when the existing one is stale)
export function forceNewClient() {
  client = null
  return createClient()
}
