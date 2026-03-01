'use client'

import { useState } from 'react'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useLists } from '@/hooks/useLists'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/Toast'
import { SortableListCard } from './SortableListCard'
import { ListCard } from './ListCard'
import type { ListWithRole } from '@/lib/supabase/types'

interface ListsViewProps {
  viewMode: 'active' | 'archived'
}

export function ListsView({ viewMode }: ListsViewProps) {
  const { lists, loading, refresh, createList, updateList, deleteList, updateUserListState, joinListByToken, leaveList, duplicateList, reorderLists } = useLists()
  
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )
  const { success, error: showError } = useToast()
  const [inputValue, setInputValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  
  const isJoinMode = inputValue.startsWith('@')

  // Filter lists based on view mode and ownership
  const filteredLists = lists.filter(list => {
    const isArchived = list.userArchived
    return viewMode === 'active' ? !isArchived : isArchived
  })

  const myLists = filteredLists.filter(list => list.role === 'owner')
  const sharedLists = filteredLists.filter(list => list.role !== 'owner')
  
  // Get all owned list names (including archived) for duplicate name checking
  const ownedListNames = lists.filter(l => l.role === 'owner').map(l => l.name)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputValue.trim()) return

    setSubmitting(true)
    setError('')

    if (isJoinMode) {
      const token = inputValue.slice(1).trim()
      if (!token) {
        setSubmitting(false)
        return
      }
      
      const { error } = await joinListByToken(token)
      
      if (error) {
        setError(error.message)
        showError('Invalid or expired token')
      } else {
        setInputValue('')
        success('Joined list successfully!')
      }
    } else {
      const { error } = await createList(inputValue.trim())
      
      if (error) {
        setError(error.message)
        showError('Failed to create list')
      } else {
        setInputValue('')
        success('List created!')
      }
    }
    
    setSubmitting(false)
  }

  const handleDragEnd = (event: DragEndEvent, listsToReorder: ListWithRole[], isMyLists: boolean) => {
    const { active, over } = event
    
    if (over && active.id !== over.id) {
      const oldIndex = listsToReorder.findIndex(l => l.id === active.id)
      const newIndex = listsToReorder.findIndex(l => l.id === over.id)
      
      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = [...listsToReorder]
        const [removed] = reordered.splice(oldIndex, 1)
        reordered.splice(newIndex, 0, removed)
        
        // Get the other lists (that weren't reordered)
        const otherLists = isMyLists ? sharedLists : myLists
        
        // Combine back: my lists first, then shared
        const allReordered = isMyLists 
          ? [...reordered, ...otherLists]
          : [...otherLists, ...reordered]
        
        reorderLists(allReordered)
      }
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Create or Join */}
      <form onSubmit={handleSubmit} className="flex gap-3" data-tour="create-list">
        <div className="flex-1">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="List name or @token to join..."
            disabled={submitting}
          />
        </div>
        <Button type="submit" loading={submitting} className="bg-red-500 hover:bg-red-600">
          {isJoinMode ? 'Join' : 'Create'}
        </Button>
      </form>

      {error && (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Lists */}
      <div className="space-y-6 min-h-[120px]">
        {/* My Lists */}
        {myLists.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2">
              My Lists
            </h3>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e) => handleDragEnd(e, myLists, true)}
            >
              <SortableContext items={myLists.map(l => l.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {myLists.map(list => (
                    <SortableListCard
                      key={list.id}
                      list={list}
                      existingListNames={ownedListNames}
                      onUpdate={updateList}
                      onDelete={deleteList}
                      onArchive={updateUserListState}
                      onDuplicate={duplicateList}
                      onLeave={leaveList}
                      onRefresh={refresh}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}

        {/* Shared Lists */}
        {sharedLists.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2">
              Shared Lists
            </h3>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e) => handleDragEnd(e, sharedLists, false)}
            >
              <SortableContext items={sharedLists.map(l => l.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {sharedLists.map(list => (
                    <SortableListCard
                      key={list.id}
                      list={list}
                      existingListNames={ownedListNames}
                      onUpdate={updateList}
                      onDelete={deleteList}
                      onArchive={updateUserListState}
                      onDuplicate={duplicateList}
                      onLeave={leaveList}
                      onRefresh={refresh}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}

        {/* Empty state */}
        {filteredLists.length === 0 && (
          <div className="text-center py-12 text-gray-500 italic">
            {viewMode === 'active' 
              ? 'No active lists. Create one above!'
              : 'No archived lists.'}
          </div>
        )}
      </div>
    </div>
  )
}
