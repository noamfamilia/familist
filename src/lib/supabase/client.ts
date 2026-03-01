import { createBrowserClient } from '@supabase/ssr'
import type { Database } from './types'

let client: ReturnType<typeof createBrowserClient<Database>> | null = null

// Generate a unique tab ID that persists for this tab's lifetime
const getTabId = () => {
  if (typeof window === 'undefined') return 'server'
  
  let tabId = window.sessionStorage.getItem('familist-tab-id')
  if (!tabId) {
    tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`
    window.sessionStorage.setItem('familist-tab-id', tabId)
  }
  return tabId
}

// Custom storage that uses sessionStorage with a tab-specific key
const createTabStorage = () => {
  if (typeof window === 'undefined') return undefined
  
  const tabId = getTabId()
  const storageKey = `familist-auth-${tabId}`
  
  return {
    getItem: (key: string) => {
      return window.sessionStorage.getItem(`${storageKey}-${key}`)
    },
    setItem: (key: string, value: string) => {
      window.sessionStorage.setItem(`${storageKey}-${key}`, value)
    },
    removeItem: (key: string) => {
      window.sessionStorage.removeItem(`${storageKey}-${key}`)
    },
  }
}

export function createClient() {
  if (!client) {
    client = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          storage: createTabStorage(),
          storageKey: 'sb-auth',
          flowType: 'pkce',
        },
      }
    )
  }
  return client
}

// Force create a new client (useful when the existing one is stale)
export function forceNewClient() {
  client = null
  return createClient()
}
