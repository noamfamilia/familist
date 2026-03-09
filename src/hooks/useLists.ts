'use client'
// @ts-nocheck

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient, forceNewClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import { getCachedLists, setCachedLists } from '@/lib/cache'
import type { ListWithRole } from '@/lib/supabase/types'
import type { RealtimeChannel } from '@supabase/supabase-js'

const supabase = createClient()

export function useLists() {
  const { user } = useAuth()
  // Initialize from cache for instant load
  const [lists, setLists] = useState<ListWithRole[]>(() => getCachedLists()?.lists || [])
  const [loading, setLoading] = useState(() => !getCachedLists()?.lists?.length)
  const [isFetching, setIsFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetchingRef = useRef(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const skipRealtimeUntilRef = useRef<number>(0)
  const hasInitialDataRef = useRef(false)
  const userId = user?.id

  const fetchLists = useCallback(async () => {
    if (!userId) {
      setLists([])
      setLoading(false)
      setIsFetching(false)
      return
    }

    if (fetchingRef.current) return
    fetchingRef.current = true
    setIsFetching(true)

    // Only show loading spinner on initial load if no cached data
    if (!hasInitialDataRef.current && !getCachedLists()?.lists?.length) {
      setLoading(true)
    }
    setError(null)

    try {
      // Fetch all lists with counts in a single RPC call
      const { data, error: rpcError } = await (supabase.rpc as any)('get_user_lists')

      if (rpcError) throw rpcError

      const listsData: ListWithRole[] = (data || []).map((item: any) => ({
        id: item.id,
        name: item.name,
        owner_id: item.owner_id,
        visibility: item.visibility,
        archived: item.archived,
        created_at: item.created_at,
        updated_at: item.updated_at,
        role: item.role,
        userArchived: item.userArchived,
        memberCount: item.memberCount,
        activeItemCount: item.activeItemCount,
        ownerNickname: item.ownerNickname,
        comment: item.comment,
      }))

      setLists(listsData)
      setCachedLists(listsData)
      hasInitialDataRef.current = true
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
      setIsFetching(false)
      fetchingRef.current = false
    }
  }, [userId])

  // Initial fetch
  useEffect(() => {
    fetchLists()
  }, [fetchLists])

  // Real-time subscriptions
  useEffect(() => {
    if (!userId) return

    const handleRealtimeChange = () => {
      // Skip fetch if we recently did a local optimistic update (within 2 seconds)
      if (Date.now() < skipRealtimeUntilRef.current) {
        return
      }
      fetchLists()
    }

    const channel = supabase
      .channel(`lists-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lists' },
        handleRealtimeChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'list_users', filter: `user_id=eq.${userId}` },
        handleRealtimeChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'members' },
        handleRealtimeChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'items' },
        handleRealtimeChange
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
    }
  }, [userId, fetchLists])

  const createList = async (name: string) => {
    if (!user) return { error: new Error('Not authenticated') }

    const { data, error } = await supabase
      .from('lists')
      .insert({ name, owner_id: user.id })
      .select()
      .single()

    if (error) {
      // Check for unique constraint violation
      if (error.code === '23505') {
        return { error: new Error('You already have a list with this name') }
      }
      return { error }
    }

    // Skip next realtime fetch since we're updating optimistically
    skipRealtimeUntilRef.current = Date.now() + 2000

    // Optimistically add the new list to state (prevent duplicates)
    const newList: ListWithRole = {
      ...data,
      role: 'owner',
      userArchived: false,
      memberCount: 0,
      activeItemCount: 0,
    }
    setLists(prev => {
      if (prev.some(l => l.id === newList.id)) return prev
      return [newList, ...prev]
    })

    return { data, error: null }
  }

  const updateList = async (listId: string, updates: { name?: string; archived?: boolean; comment?: string | null }) => {
    const { error } = await supabase
      .from('lists')
      .update(updates)
      .eq('id', listId)

    if (error) {
      if (error.code === '23505') {
        return { error: new Error('You already have a list with this name') }
      }
      return { error }
    }

    skipRealtimeUntilRef.current = Date.now() + 2000
    setLists(prev => prev.map(list => 
      list.id === listId ? { ...list, ...updates } : list
    ))

    return { error: null }
  }

  const deleteList = async (listId: string) => {
    const { error } = await supabase
      .from('lists')
      .delete()
      .eq('id', listId)

    if (!error) {
      skipRealtimeUntilRef.current = Date.now() + 2000
      setLists(prev => prev.filter(list => list.id !== listId))
    }

    return { error }
  }

  const updateUserListState = async (listId: string, updates: { archived?: boolean; sort_order?: number }) => {
    if (!user) return { error: new Error('Not authenticated') }

    const { error } = await supabase
      .from('list_users')
      .update(updates)
      .eq('list_id', listId)
      .eq('user_id', user.id)

    if (!error) {
      skipRealtimeUntilRef.current = Date.now() + 2000
      setLists(prev => prev.map(list => 
        list.id === listId ? { ...list, userArchived: updates.archived ?? list.userArchived } : list
      ))
    }

    return { error }
  }

  const joinListByToken = async (token: string) => {
    // Use a fresh client to ensure we have the current user's session
    const freshClient = forceNewClient()
    const { data, error } = await (freshClient.rpc as any)('join_list_by_token', { p_token: token })

    if (!error) {
      skipRealtimeUntilRef.current = Date.now() + 2000
      await fetchLists()
    }

    return { data, error }
  }

  const leaveList = async (listId: string) => {
    if (!user) return { error: new Error('Not authenticated') }

    // Delete all members created by this user in the list
    // (cascade will delete their item_member_state entries)
    const { error: membersError } = await supabase
      .from('members')
      .delete()
      .eq('list_id', listId)
      .eq('created_by', user.id)

    if (membersError) return { error: membersError }

    // Remove user from list_users
    const { error: listUsersError } = await supabase
      .from('list_users')
      .delete()
      .eq('list_id', listId)
      .eq('user_id', user.id)

    if (listUsersError) return { error: listUsersError }

    // Broadcast to other users that the list changed (so they refresh metadata)
    supabase.channel(`list-${listId}`).send({
      type: 'broadcast',
      event: 'user_left',
      payload: { userId: user.id }
    })

    // Remove list from local state
    skipRealtimeUntilRef.current = Date.now() + 2000
    setLists(prev => prev.filter(list => list.id !== listId))

    return { error: null }
  }

  const duplicateList = async (listId: string, newName: string) => {
    if (!user) return { error: new Error('Not authenticated') }

    // First, fetch the original list's items and members
    const [itemsResult, membersResult] = await Promise.all([
      supabase.from('items').select('*').eq('list_id', listId),
      supabase.from('members').select('*').eq('list_id', listId),
    ])

    if (itemsResult.error) return { error: itemsResult.error }
    if (membersResult.error) return { error: membersResult.error }

    // Create new list
    const { data: newList, error: createError } = await supabase
      .from('lists')
      .insert({ name: newName, owner_id: user.id })
      .select()
      .single()

    if (createError) {
      if (createError.code === '23505') {
        return { error: new Error('You already have a list with this name') }
      }
      return { error: createError }
    }

    // Create member mapping (old ID -> new ID)
    const memberMapping: Record<string, string> = {}

    // Duplicate members
    if (membersResult.data && membersResult.data.length > 0) {
      for (const member of membersResult.data) {
        const { data: newMember, error: memberError } = await supabase
          .from('members')
          .insert({
            list_id: newList.id,
            name: member.name,
            created_by: user.id,
            sort_order: member.sort_order,
          })
          .select()
          .single()

        if (memberError) continue
        memberMapping[member.id] = newMember.id
      }
    }

    // Duplicate items and their member states
    if (itemsResult.data && itemsResult.data.length > 0) {
      for (const item of itemsResult.data) {
        const { data: newItem, error: itemError } = await supabase
          .from('items')
          .insert({
            list_id: newList.id,
            text: item.text,
            comment: item.comment,
            archived: item.archived,
            sort_order: item.sort_order,
          })
          .select()
          .single()

        if (itemError || !newItem) continue

        // Fetch and duplicate item_member_state
        const { data: states } = await supabase
          .from('item_member_state')
          .select('*')
          .eq('item_id', item.id)

        if (states) {
          for (const state of states) {
            const newMemberId = memberMapping[state.member_id]
            if (newMemberId) {
              await supabase.from('item_member_state').insert({
                item_id: newItem.id,
                member_id: newMemberId,
                quantity: state.quantity,
                done: state.done,
              })
            }
          }
        }
      }
    }

    // Optimistically add the duplicated list
    skipRealtimeUntilRef.current = Date.now() + 2000
    const duplicatedList: ListWithRole = {
      ...newList,
      role: 'owner',
      userArchived: false,
      memberCount: membersResult.data?.length || 0,
      activeItemCount: itemsResult.data?.filter(i => !i.archived).length || 0,
    }
    // Prevent duplicate entries
    setLists(prev => {
      if (prev.some(l => l.id === duplicatedList.id)) return prev
      return [duplicatedList, ...prev]
    })

    return { data: newList, error: null }
  }

  const reorderLists = async (reorderedLists: ListWithRole[]) => {
    if (!user) return

    // Optimistically update the UI
    skipRealtimeUntilRef.current = Date.now() + 2000
    setLists(reorderedLists)

    // Update sort_order in database for each list
    const updates = reorderedLists.map((list, index) => 
      supabase
        .from('list_users')
        .update({ sort_order: index })
        .eq('list_id', list.id)
        .eq('user_id', user.id)
    )

    await Promise.all(updates)
  }

  return {
    lists,
    loading,
    isFetching,
    error,
    refresh: fetchLists,
    createList,
    updateList,
    deleteList,
    updateUserListState,
    joinListByToken,
    leaveList,
    duplicateList,
    reorderLists,
  }
}
