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
import { TutorialTour } from '@/components/ui/TutorialTour'
import type { ListWithRole } from '@/lib/supabase/types'
import type { Step } from 'react-joyride'

interface ListsViewProps {
  viewMode: 'all' | 'mine'
  homeIntroSteps?: Step[]
  homeListSteps?: Step[]
  showTutorial?: boolean
}

export function ListsView({ viewMode, homeIntroSteps, homeListSteps, showTutorial = true }: ListsViewProps) {
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

  // Filter lists based on ownership (all or mine only)
  const filteredLists = viewMode === 'mine' 
    ? lists.filter(list => list.role === 'owner')
    : lists

  // Separate active and archived lists
  const activeLists = filteredLists.filter(list => !list.userArchived)
  const archivedLists = filteredLists.filter(list => list.userArchived)
  
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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    
    if (over && active.id !== over.id) {
      const oldIndex = activeLists.findIndex(l => l.id === active.id)
      const newIndex = activeLists.findIndex(l => l.id === over.id)
      
      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = [...activeLists]
        const [removed] = reordered.splice(oldIndex, 1)
        reordered.splice(newIndex, 0, removed)
        
        // Combine active reordered with archived (archived stay at end)
        reorderLists([...reordered, ...archivedLists])
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
            placeholder="List name or @token"
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
      <div className="space-y-2 min-h-[120px]">
        {/* Active Lists - draggable */}
        {activeLists.length > 0 && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={activeLists.map(l => l.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {activeLists.map(list => (
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
        )}

        {/* Separator between active and archived */}
        {activeLists.length > 0 && archivedLists.length > 0 && (
          <div className="flex items-center gap-3 py-3">
            <div className="flex-1 h-px bg-gray-300"></div>
            <span className="text-xs text-gray-400 tracking-wide">Archived</span>
            <div className="flex-1 h-px bg-gray-300"></div>
          </div>
        )}

        {/* Archived Lists - not draggable */}
        {archivedLists.length > 0 && (
          <div className="space-y-2">
            {archivedLists.map(list => (
              <ListCard
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
        )}

        {/* Empty state */}
        {filteredLists.length === 0 && (
          <div className="text-center py-12 text-gray-500 italic">
            No lists yet. Create one above!
          </div>
        )}
      </div>
      
      {/* Tutorial - intro steps (always available) */}
      {homeIntroSteps && showTutorial && (
        <TutorialTour tourId="home-intro" steps={homeIntroSteps} />
      )}
      
      {/* Tutorial - list-specific steps (only when lists exist) */}
      {homeListSteps && showTutorial && lists.length > 0 && (
        <TutorialTour tourId="home-lists" steps={homeListSteps} />
      )}
    </div>
  )
}
