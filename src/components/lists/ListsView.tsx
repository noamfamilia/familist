'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
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
import type { Step } from 'react-joyride'

const TutorialTour = dynamic(() => import('@/components/ui/TutorialTour').then(mod => mod.TutorialTour), {
  ssr: false,
})

interface ListsViewProps {
  viewMode: 'all' | 'mine'
  homeTourSteps?: Step[]
  showTutorial?: boolean
}

export function ListsView({ viewMode, homeTourSteps, showTutorial = true }: ListsViewProps) {
  const { lists, loading, isInitialSyncing, fetchTimedOut, saveTimedOut, error: fetchError, refresh, createList, updateList, deleteList, updateUserListState, joinListByToken, leaveList, duplicateList, reorderLists } = useLists()
  
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
  const searchText = isJoinMode ? '' : inputValue.trim().toLowerCase()

  // Filter lists based on ownership (all or mine only) and search text
  const filteredLists = lists.filter(list => {
    const matchesViewMode = viewMode === 'mine' ? list.role === 'owner' : true
    const matchesSearch = searchText ? list.name.toLowerCase().includes(searchText) : true
    return matchesViewMode && matchesSearch
  })

  // Separate active and archived lists
  const activeLists = filteredLists.filter(list => !list.userArchived)
  const archivedLists = filteredLists.filter(list => list.userArchived)
  
  // Get all owned list names (including archived) for duplicate name checking
  const ownedListNames = lists.filter(l => l.role === 'owner').map(l => l.name)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputValue.trim()) return

    const submittedValue = inputValue.trim()
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
        showError(error.message || 'Failed to join list')
      } else {
        setInputValue('')
        success('Joined list successfully!')
      }
    } else {
      setInputValue('')
      const { error } = await createList(submittedValue)
      
      if (error) {
        setInputValue(submittedValue)
        setError(error.message)
        showError('Failed to create list')
      } else {
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
      {/* Timeout message */}
      {(fetchTimedOut || saveTimedOut) && (
        <div className="bg-red-500 text-white px-4 py-3 rounded-lg text-center font-medium">
          Your changes may not have been saved to the server. Refresh page and try again
        </div>
      )}

      {/* Create or Join */}
      <form onSubmit={handleSubmit} className="flex gap-3" data-tour="create-list">
        <div className="flex-1">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="List name or @token"
            disabled={submitting || isInitialSyncing}
          />
        </div>
        <Button type="submit" loading={submitting} disabled={isInitialSyncing} className="bg-red-500 hover:bg-red-600">
          {isJoinMode ? 'Join' : 'Create'}
        </Button>
      </form>

      {searchText && (
        <p className="text-xs text-gray-400 px-1 -mt-4">
          {filteredLists.length > 0
            ? 'Filtering...'
            : lists.length > 0
              ? 'No matching lists'
              : 'Filtering...'}
        </p>
      )}

      {error && (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {fetchError && lists.length > 0 && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between gap-3">
          <span>Can&apos;t refresh your lists right now.</span>
          <Button type="button" size="sm" variant="secondary" onClick={refresh}>
            Retry
          </Button>
        </div>
      )}

      {/* Lists */}
      <div className={`space-y-2 min-h-[120px] ${isInitialSyncing ? '[&_button]:pointer-events-none [&_button]:opacity-50 [&_input]:pointer-events-none [&_input]:opacity-50' : ''}`}>
        {fetchError && lists.length === 0 && (
          <div className="text-center py-10 px-4 border border-red-200 bg-red-50 rounded-lg">
            <p className="text-red-700 font-medium">Can&apos;t load your lists right now.</p>
            <p className="text-sm text-red-600 mt-1">Please try again.</p>
            <Button type="button" size="sm" variant="secondary" className="mt-4" onClick={refresh}>
              Retry
            </Button>
          </div>
        )}

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
        {archivedLists.length > 0 && (
          <div className="flex items-center gap-3 py-3">
            <div className="flex-1 h-px bg-gray-300"></div>
            <span className="text-sm text-gray-500 font-medium">Archived</span>
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

        {/* Empty state - only show when truly no lists exist */}
        {lists.length === 0 && (
          <div className="text-center py-12 text-gray-500 italic">
            No lists yet. Create one above!
          </div>
        )}
      </div>
      
      {/* Tutorial - shows available steps, resumes when new targets appear */}
      {homeTourSteps && showTutorial && (
        <TutorialTour 
          tourId="home" 
          steps={homeTourSteps}
          contentKey={lists.length}
        />
      )}
    </div>
  )
}
