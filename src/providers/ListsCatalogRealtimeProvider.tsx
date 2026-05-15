'use client'

import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import { perfLog } from '@/lib/startupPerfLog'
import {
  catalogMutationVersionRef,
  catalogRealtimeScheduleCaptureVersionRef,
  catalogSkipRealtimeUntilRef,
  getListsCatalogFetchHandler,
  registerListsCatalogRealtimeSchedule,
} from '@/lib/data/listsCatalogRealtimeBridge'
import {
  extractListIdsFromCatalogRealtimePayload,
  prefetchListDetailsFromServer,
} from '@/lib/data/listDetailRemotePrefetch'

type CatalogRealtimePayload = Parameters<typeof extractListIdsFromCatalogRealtimePayload>[0]

const supabase = createClient()

/**
 * Keeps the home-list catalog Supabase realtime channel subscribed for the whole
 * signed-in session so navigation away from `/` does not tear down postgres listeners.
 */
export function ListsCatalogRealtimeProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, bootstrapUserId } = useAuth()
  const userId = user?.id ?? (authLoading ? bootstrapUserId : null)

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const realtimeDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const pendingRealtimeRef = useRef(false)
  const realtimeDirtyListIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!userId) {
      registerListsCatalogRealtimeSchedule(null)
      return
    }

    const scheduleRealtimeFetch = (delayMs: number, consumePending = false) => {
      if (catalogRealtimeScheduleCaptureVersionRef.current === null) {
        catalogRealtimeScheduleCaptureVersionRef.current = catalogMutationVersionRef.current
      }

      if (realtimeDebounceRef.current) {
        clearTimeout(realtimeDebounceRef.current)
      }

      realtimeDebounceRef.current = setTimeout(() => {
        realtimeDebounceRef.current = null

        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
          if (consumePending) pendingRealtimeRef.current = true
          catalogRealtimeScheduleCaptureVersionRef.current = null
          return
        }

        const remainingSkipMs = catalogSkipRealtimeUntilRef.current - Date.now()
        if (remainingSkipMs > 0) {
          if (consumePending || pendingRealtimeRef.current) {
            scheduleRealtimeFetch(remainingSkipMs, true)
          }
          return
        }

        if (consumePending) pendingRealtimeRef.current = false
        const cap = catalogRealtimeScheduleCaptureVersionRef.current
        const dirtyIds = [...realtimeDirtyListIdsRef.current]
        realtimeDirtyListIdsRef.current.clear()
        const uid = userId
        void (async () => {
          const fetchFn = getListsCatalogFetchHandler()
          const pCatalog =
            cap == null
              ? Promise.resolve(fetchFn?.() ?? undefined)
              : Promise.resolve(fetchFn?.({ staleCheckVersion: cap }) ?? undefined)
          const pDetail =
            dirtyIds.length > 0 && uid ? prefetchListDetailsFromServer(uid, dirtyIds) : Promise.resolve()
          await Promise.all([pCatalog, pDetail])
        })()
      }, Math.max(delayMs, 0))
    }

    registerListsCatalogRealtimeSchedule(scheduleRealtimeFetch)

    const handleRealtimeChange = (payload?: CatalogRealtimePayload) => {
      if (payload) {
        for (const id of extractListIdsFromCatalogRealtimePayload(payload)) {
          realtimeDirtyListIdsRef.current.add(id)
        }
      }

      const remainingSkipMs = catalogSkipRealtimeUntilRef.current - Date.now()
      if (remainingSkipMs > 0) {
        pendingRealtimeRef.current = true
        scheduleRealtimeFetch(remainingSkipMs)
        return
      }

      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        pendingRealtimeRef.current = true
        return
      }

      scheduleRealtimeFetch(250)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || !pendingRealtimeRef.current) return
      scheduleRealtimeFetch(0, true)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    const subscribeT0 = performance.now()
    perfLog('realtime subscribe start')
    let subscribeEndLogged = false
    const logRealtimeSubscribeEnd = (extra: Record<string, unknown> = {}) => {
      if (subscribeEndLogged) return
      subscribeEndLogged = true
      perfLog('realtime subscribe end', {
        durationMs: Math.round(performance.now() - subscribeT0),
        ...extra,
      })
    }

    const channel = supabase
      .channel(`lists-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lists' }, (payload) => {
        handleRealtimeChange(payload as CatalogRealtimePayload)
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'list_users', filter: `user_id=eq.${userId}` },
        (payload) => {
          handleRealtimeChange(payload as CatalogRealtimePayload)
        },
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, (payload) => {
        handleRealtimeChange(payload as CatalogRealtimePayload)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, (payload) => {
        handleRealtimeChange(payload as CatalogRealtimePayload)
      })
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          logRealtimeSubscribeEnd({})
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          logRealtimeSubscribeEnd({ error: err?.message ?? status })
        }
      })

    channelRef.current = channel
    const dirtyIdsRefForCleanup = realtimeDirtyListIdsRef

    return () => {
      registerListsCatalogRealtimeSchedule(null)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (realtimeDebounceRef.current) {
        clearTimeout(realtimeDebounceRef.current)
        realtimeDebounceRef.current = null
      }
      pendingRealtimeRef.current = false
      dirtyIdsRefForCleanup.current.clear()
      catalogRealtimeScheduleCaptureVersionRef.current = null
      const ch = channelRef.current
      if (ch) {
        supabase.removeChannel(ch)
        channelRef.current = null
      }
    }
  }, [userId])

  return <>{children}</>
}
