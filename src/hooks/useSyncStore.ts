'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { createClient } from '@/lib/supabase/client'
import { isLikelyConnectivityError } from '@/lib/connectivityErrors'
import { appendMutationDiagnostic } from '@/lib/offlineNavDiagnostics'

const supabase = createClient()

type SyncStoreState = {
  pendingCount: number
  isDraining: boolean
  lastError: string | null
  hasSyncFailures: boolean
}

export function useSyncStore(): SyncStoreState {
  const queue = useLiveQuery(
    async () => db.sync_queue.orderBy('updatedAt').toArray(),
    [],
    [],
  )
  const queueRows = useMemo(() => queue ?? [], [queue])
  const { status, markOnlineRecovered } = useConnectivity()
  const drainingRef = useRef(false)
  const [isDraining, setIsDraining] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)

  useEffect(() => {
    if (status !== 'online') return
    if (queueRows.length === 0) return
    if (drainingRef.current) return

    let cancelled = false
    const run = async () => {
      drainingRef.current = true
      setIsDraining(true)
      try {
        for (const row of queueRows) {
          if (cancelled) break
          try {
            appendMutationDiagnostic(
              `[sync->server] send kind=${row.kind} entity=${row.entity} key=${row.itemKey}`,
            )
            if (row.kind === 'delete') {
              if (row.entity === 'item') {
                const id = String(row.payload.id ?? '')
                if (id) {
                  const { error } = await supabase.from('items').delete().eq('id', id)
                  if (error) throw error
                }
              } else if (row.entity === 'member') {
                const id = String(row.payload.id ?? '')
                if (id) {
                  const { error } = await supabase.rpc('delete_member', { p_member_id: id })
                  if (error) throw error
                }
              } else if (row.entity === 'item_member_state') {
                const itemId = String(row.payload.item_id ?? '')
                const memberId = String(row.payload.member_id ?? '')
                if (itemId && memberId) {
                  const { error } = await supabase
                    .from('item_member_state')
                    .delete()
                    .eq('item_id', itemId)
                    .eq('member_id', memberId)
                  if (error) throw error
                }
              } else if (row.entity === 'list') {
                const id = String(row.payload.id ?? '')
                if (id) {
                  const { error } = await supabase.from('lists').delete().eq('id', id)
                  if (error) throw error
                }
              }
              await db.transaction('rw', db.sync_queue, async () => {
                await db.sync_queue.delete([row.listId, row.itemKey])
              })
              appendMutationDiagnostic(
                `[sync<-server] ok kind=${row.kind} entity=${row.entity} key=${row.itemKey}`,
              )
              continue
            }

            if (row.kind === 'create' && row.entity === 'item') {
              const payload = row.payload as {
                id?: string
                list_id?: string
                text?: string
                category?: number
                comment?: string | null
                sort_order?: number | null
              }
              const { error } = await supabase.from('items').upsert({
                id: payload.id,
                list_id: payload.list_id,
                text: payload.text ?? '',
                category: payload.category ?? 1,
                comment: payload.comment ?? null,
                sort_order: payload.sort_order ?? null,
              })
              if (error) throw error
            } else if (row.kind === 'create' && row.entity === 'list') {
              const payload = row.payload as {
                id?: string
                name?: string
                label?: string
              }
              const { error } = await supabase.rpc('create_list', {
                p_id: payload.id,
                p_name: payload.name ?? '',
                p_label: payload.label ?? '',
              } as never)
              if (error) throw error
            } else if (row.kind === 'addMember' && row.entity === 'member') {
              const payload = row.payload as {
                id?: string
                list_id?: string
                name?: string
              }
              const { error } = await supabase.from('members').upsert({
                id: payload.id,
                list_id: payload.list_id,
                name: payload.name ?? '',
              })
              if (error) throw error
            } else if (row.kind === 'itemMemberState' && row.entity === 'item_member_state') {
              const payload = row.payload as {
                item_id?: string
                member_id?: string
                quantity?: number
                done?: boolean
                assigned?: boolean
              }
              const { error } = await supabase.from('item_member_state').upsert({
                item_id: payload.item_id,
                member_id: payload.member_id,
                quantity: payload.quantity ?? 1,
                done: payload.done ?? false,
                assigned: payload.assigned ?? false,
              })
              if (error) throw error
            } else if (row.kind === 'patchServerItem' && row.entity === 'item') {
              const payload = row.payload as {
                id?: string
                [key: string]: unknown
              }
              const id = String(payload.id ?? '')
              if (!id) throw new Error('patchServerItem missing id')
              const patch: Record<string, unknown> = { ...payload }
              delete patch.id
              if (Object.keys(patch).length > 0) {
                const { error } = await supabase.from('items').update(patch).eq('id', id)
                if (error) throw error
              }
            } else if (row.kind === 'patchMember' && row.entity === 'member') {
              const payload = row.payload as {
                memberId?: string
                name?: string
                is_public?: boolean
              }
              const memberId = String(payload.memberId ?? '')
              if (!memberId) throw new Error('patchMember missing memberId')
              const { error } = await supabase.rpc('update_member', {
                p_member_id: memberId,
                p_name: payload.name,
                p_is_public: payload.is_public,
              })
              if (error) throw error
            } else if (row.kind === 'patchArchived' && row.entity === 'item') {
              const payload = row.payload as {
                id?: string
                archived?: boolean
                archived_at?: string | null
              }
              const id = String(payload.id ?? '')
              if (!id) throw new Error('patchArchived missing id')
              const { error } = await supabase
                .from('items')
                .update({
                  archived: payload.archived ?? false,
                  archived_at: payload.archived_at ?? null,
                })
                .eq('id', id)
              if (error) throw error
            } else if (row.kind === 'patchList' && row.entity === 'list') {
              const payload = row.payload as {
                id?: string
                [key: string]: unknown
              }
              const id = String(payload.id ?? '')
              if (!id) throw new Error('patchList missing id')
              const patch: Record<string, unknown> = { ...payload }
              delete patch.id
              if (Object.keys(patch).length > 0) {
                const { error } = await supabase.from('lists').update(patch).eq('id', id)
                if (error) throw error
              }
            } else if (row.kind === 'patchListUser' && row.entity === 'list') {
              const payload = row.payload as {
                id?: string
                user_id?: string
                archived?: boolean
                sort_order?: number
                label?: string
              }
              const id = String(payload.id ?? '')
              const userId = String(payload.user_id ?? '')
              if (!id || !userId) throw new Error('patchListUser missing id/user_id')
              const patch: Record<string, unknown> = {}
              if (payload.archived !== undefined) patch.archived = payload.archived
              if (payload.sort_order !== undefined) patch.sort_order = payload.sort_order
              if (payload.label !== undefined) patch.label = payload.label
              if (Object.keys(patch).length > 0) {
                const { error } = await supabase
                  .from('list_users')
                  .update(patch)
                  .eq('list_id', id)
                  .eq('user_id', userId)
                if (error) throw error
              }
            }

            await db.transaction('rw', db.sync_queue, async () => {
              await db.sync_queue.delete([row.listId, row.itemKey])
            })
            appendMutationDiagnostic(
              `[sync<-server] ok kind=${row.kind} entity=${row.entity} key=${row.itemKey}`,
            )
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            appendMutationDiagnostic(
              `[sync<-server] error kind=${row.kind} entity=${row.entity} key=${row.itemKey} msg=${message}`,
            )
            if (isLikelyConnectivityError(error)) {
              setLastError(message)
              break
            }
            await db.sync_queue.update([row.listId, row.itemKey], {
              attemptCount: row.attemptCount + 1,
              lastError: message,
            })
            setLastError(message)
            break
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        setLastError(msg)
      } finally {
        drainingRef.current = false
        setIsDraining(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [queueRows, status])

  useEffect(() => {
    if (status === 'online' && queueRows.length > 0) {
      markOnlineRecovered('use-sync-store-online-drain')
    }
  }, [markOnlineRecovered, queueRows.length, status])

  return useMemo(
    () => ({
      pendingCount: queueRows.length,
      isDraining,
      lastError,
      hasSyncFailures: queueRows.some((row) => row.attemptCount > 0 && Boolean(row.lastError)),
    }),
    [isDraining, lastError, queueRows],
  )
}
