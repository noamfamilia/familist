'use client'
// @ts-nocheck

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import type { List, Member, MemberWithCreator, Item, ItemMemberState } from '@/lib/supabase/types'
import type { RealtimeChannel } from '@supabase/supabase-js'

const supabase = createClient()

export interface ItemWithState extends Item {
  memberStates: Record<string, ItemMemberState>
}

export function useList(listId: string) {
  const { user } = useAuth()
  const [list, setList] = useState<List | null>(null)
  const [items, setItems] = useState<ItemWithState[]>([])
  const [members, setMembers] = useState<MemberWithCreator[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const [memberFilter, setMemberFilter] = useState<'all' | 'mine'>('all')
  const [itemTextWidth, setItemTextWidth] = useState(80)
  const fetchingRef = useRef(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const hadAccessRef = useRef(false)
  const hasInitialDataRef = useRef(false)
  const skipRealtimeUntilRef = useRef(0)
  const userId = user?.id

  const fetchList = useCallback(async () => {
    if (!userId || !listId) {
      setLoading(false)
      return
    }

    if (fetchingRef.current) return
    fetchingRef.current = true

    // Only show loading spinner on initial load, not on background refreshes
    if (!hasInitialDataRef.current) {
      setLoading(true)
    }
    setError(null)

    try {
      // Fetch all list data in a single RPC call
      const { data, error: rpcError } = await (supabase.rpc as any)('get_list_data', {
        p_list_id: listId
      })

      if (rpcError) {
        // If we previously had access but now get an error, access was revoked
        if (hadAccessRef.current && (rpcError.code === 'P0001' || rpcError.message?.includes('Access denied'))) {
          setAccessDenied(true)
          return
        }
        throw rpcError
      }

      if (!data || !data.list) {
        if (hadAccessRef.current) {
          setAccessDenied(true)
          return
        }
        throw new Error('List not found')
      }
      
      // Mark that we have access
      hadAccessRef.current = true
      setList(data.list)
      setMembers(data.members || [])
      setItems(data.items || [])
      hasInitialDataRef.current = true

      // Fetch user preferences from list_users
      const { data: listUserData } = await supabase
        .from('list_users')
        .select('member_filter, item_text_width')
        .eq('list_id', listId)
        .eq('user_id', userId)
        .single()

      if (listUserData) {
        if (listUserData.member_filter === 'all' || listUserData.member_filter === 'mine') {
          setMemberFilter(listUserData.member_filter)
        }
        if (listUserData.item_text_width && listUserData.item_text_width >= 80) {
          setItemTextWidth(listUserData.item_text_width)
        }
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
      fetchingRef.current = false
    }
  }, [userId, listId])

  // Initial fetch
  useEffect(() => {
    fetchList()
  }, [fetchList])

  // Real-time subscriptions
  useEffect(() => {
    if (!userId || !listId) return

    const handleRealtimeChange = () => {
      // Skip if we recently made a local change (prevents flickering)
      if (Date.now() < skipRealtimeUntilRef.current) return
      fetchList()
    }

    const channel = supabase
      .channel(`list-${listId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'items', filter: `list_id=eq.${listId}` },
        handleRealtimeChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'members', filter: `list_id=eq.${listId}` },
        handleRealtimeChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'item_member_state' },
        handleRealtimeChange
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'list_users', filter: `list_id=eq.${listId}` },
        (payload) => {
          // Check if the current user was removed (always process, don't skip)
          if (payload.old && (payload.old as { user_id?: string }).user_id === userId) {
            setAccessDenied(true)
          }
        }
      )
      .on(
        'broadcast',
        { event: 'item_updated' },
        handleRealtimeChange
      )
      .on(
        'broadcast',
        { event: 'item_deleted' },
        handleRealtimeChange
      )
      .on(
        'broadcast',
        { event: 'member_added' },
        handleRealtimeChange
      )
      .on(
        'broadcast',
        { event: 'member_deleted' },
        handleRealtimeChange
      )
      .on(
        'broadcast',
        { event: 'member_updated' },
        handleRealtimeChange
      )
      .on(
        'broadcast',
        { event: 'user_left' },
        handleRealtimeChange
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
    }
  }, [userId, listId, fetchList])

  const addItem = async (text: string) => {
    const maxSortOrder = items.reduce((max, item) => 
      Math.max(max, item.sort_order || 0), 0)

    const { data, error } = await supabase
      .from('items')
      .insert({
        list_id: listId,
        text,
        sort_order: maxSortOrder + 1,
      })
      .select()
      .single()

    if (error) {
      // Handle unique constraint violation
      if (error.code === '23505') {
        return { data: null, error: { ...error, message: 'An item with this name already exists' } }
      }
      return { data: null, error }
    }

    skipRealtimeUntilRef.current = Date.now() + 2000
    setItems(prev => [...prev, { ...data, memberStates: {} }])
    return { data, error: null }
  }

  const updateItem = async (itemId: string, updates: Partial<Item>) => {
    const { error } = await supabase
      .from('items')
      .update(updates)
      .eq('id', itemId)

    if (error) {
      // Handle unique constraint violation
      if (error.code === '23505') {
        return { error: { ...error, message: 'An item with this name already exists' } }
      }
      return { error }
    }

    skipRealtimeUntilRef.current = Date.now() + 2000
    setItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, ...updates } : item
    ))
    
    // Broadcast to other clients
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'item_updated',
        payload: { itemId }
      })
    }
    
    return { error: null }
  }

  const deleteItem = async (itemId: string) => {
    const { error } = await supabase
      .from('items')
      .delete()
      .eq('id', itemId)

    if (!error) {
      skipRealtimeUntilRef.current = Date.now() + 2000
      setItems(prev => prev.filter(item => item.id !== itemId))
      
      // Broadcast to other clients
      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'item_deleted',
          payload: { itemId }
        })
      }
    }

    return { error }
  }

  const addMember = async (name: string, creatorNickname?: string) => {
    if (!userId) return { error: new Error('Not authenticated') }

    const maxSortOrder = members.reduce((max, member) => 
      Math.max(max, member.sort_order || 0), 0)

    const { data, error } = await supabase
      .from('members')
      .insert({
        list_id: listId,
        name,
        created_by: userId,
        sort_order: maxSortOrder + 1,
      })
      .select()
      .single()

    if (!error && data) {
      skipRealtimeUntilRef.current = Date.now() + 2000
      // Include creator info in optimistic update
      const memberWithCreator = {
        ...data,
        creator: creatorNickname ? { nickname: creatorNickname } : null
      }
      setMembers(prev => [...prev, memberWithCreator])
      
      // Broadcast to other clients
      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'member_added',
          payload: { memberId: data.id }
        })
      }
    }

    return { data, error }
  }

  const updateMember = async (memberId: string, updates: Partial<Member>) => {
    // Use RPC to enforce creator-only permission
    const { error } = await (supabase.rpc as any)('update_member', {
      p_member_id: memberId,
      p_name: updates.name !== undefined ? updates.name : null,
      p_is_public: updates.is_public !== undefined ? updates.is_public : null,
    })

    if (error) {
      return { error: { ...error, message: error.message || 'Failed to update member' } }
    }

    skipRealtimeUntilRef.current = Date.now() + 2000
    setMembers(prev => prev.map(member =>
      member.id === memberId ? { ...member, ...updates } : member
    ))

    // Broadcast to other users that the list changed
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'member_updated',
        payload: { memberId }
      })
    }

    return { error: null }
  }

  const deleteMember = async (memberId: string) => {
    // Use RPC to enforce creator-only permission
    const { error } = await (supabase.rpc as any)('delete_member', {
      p_member_id: memberId,
    })

    if (error) {
      return { error: { ...error, message: error.message || 'Failed to delete member' } }
    }

    skipRealtimeUntilRef.current = Date.now() + 2000
    setMembers(prev => prev.filter(member => member.id !== memberId))
    // Also remove member states from items
    setItems(prev => prev.map(item => ({
      ...item,
      memberStates: Object.fromEntries(
        Object.entries(item.memberStates).filter(([mid]) => mid !== memberId)
      ),
    })))

    // Broadcast to other users that the list changed
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'member_deleted',
        payload: { memberId }
      })
    }

    return { error: null }
  }

  const updateMemberState = async (
    itemId: string,
    memberId: string,
    updates: { quantity?: number; done?: boolean }
  ) => {
    // Check if state exists
    const existingState = items.find(i => i.id === itemId)?.memberStates[memberId]

    if (existingState) {
      // Update existing
      const { error } = await supabase
        .from('item_member_state')
        .update(updates)
        .eq('item_id', itemId)
        .eq('member_id', memberId)

      if (!error) {
        skipRealtimeUntilRef.current = Date.now() + 2000
        setItems(prev => prev.map(item => {
          if (item.id !== itemId) return item
          return {
            ...item,
            memberStates: {
              ...item.memberStates,
              [memberId]: { ...item.memberStates[memberId], ...updates },
            },
          }
        }))
      }

      return { error }
    } else {
      // Insert new
      const { data, error } = await supabase
        .from('item_member_state')
        .insert({
          item_id: itemId,
          member_id: memberId,
          quantity: updates.quantity ?? 0,
          done: updates.done ?? false,
        })
        .select()
        .single()

      if (!error && data) {
        skipRealtimeUntilRef.current = Date.now() + 2000
        setItems(prev => prev.map(item => {
          if (item.id !== itemId) return item
          return {
            ...item,
            memberStates: {
              ...item.memberStates,
              [memberId]: data,
            },
          }
        }))
      }

      return { error }
    }
  }

  const changeQuantity = async (itemId: string, memberId: string, delta: number) => {
    const { data, error } = await (supabase.rpc as any)('change_quantity', {
      p_item_id: itemId,
      p_member_id: memberId,
      p_delta: delta,
    })

    if (!error) {
      skipRealtimeUntilRef.current = Date.now() + 2000
      setItems(prev => prev.map(item => {
        if (item.id !== itemId) return item
        const currentState = item.memberStates[memberId] || {
          item_id: itemId,
          member_id: memberId,
          quantity: 0,
          done: false,
          updated_at: new Date().toISOString(),
        }
        return {
          ...item,
          memberStates: {
            ...item.memberStates,
            [memberId]: { ...currentState, quantity: data || 0 },
          },
        }
      }))
    }

    return { data, error }
  }

  const reorderItems = async (reorderedItems: ItemWithState[]) => {
    // Optimistically update the UI with updated sort_order values
    skipRealtimeUntilRef.current = Date.now() + 2000
    const itemsWithUpdatedOrder = reorderedItems.map((item, index) => ({
      ...item,
      sort_order: index
    }))
    setItems(itemsWithUpdatedOrder)

    // Update sort_order in database for each item
    const updates = reorderedItems.map((item, index) => 
      supabase
        .from('items')
        .update({ sort_order: index })
        .eq('id', item.id)
    )

    await Promise.all(updates)
  }

  const updateMemberFilter = async (filter: 'all' | 'mine') => {
    setMemberFilter(filter)
    if (userId) {
      await supabase
        .from('list_users')
        .update({ member_filter: filter })
        .eq('list_id', listId)
        .eq('user_id', userId)
    }
  }

  const updateItemTextWidth = async (width: number) => {
    const newWidth = Math.max(80, width)
    setItemTextWidth(newWidth)
    if (userId) {
      await supabase
        .from('list_users')
        .update({ item_text_width: newWidth })
        .eq('list_id', listId)
        .eq('user_id', userId)
    }
  }

  return {
    list,
    items,
    members,
    loading,
    error,
    accessDenied,
    memberFilter,
    itemTextWidth,
    refresh: fetchList,
    addItem,
    updateItem,
    deleteItem,
    addMember,
    updateMember,
    deleteMember,
    updateMemberState,
    changeQuantity,
    reorderItems,
    updateMemberFilter,
    updateItemTextWidth,
  }
}
