'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
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
  inviteToken?: string | null
  onInviteHandled?: () => void
}

export function ListsView({ viewMode, homeTourSteps, showTutorial = true, inviteToken = null, onInviteHandled }: ListsViewProps) {
  const { lists, loading, fetchTimedOut, saveTimedOut, error: fetchError, refresh, createList, updateList, deleteList, updateUserListState, joinListByToken, leaveList, duplicateList, reorderLists, updateListLabel, labels } = useLists()
  const router = useRouter()
  const inviteJoinRef = useRef<string | null>(null)
  
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
  const formRef = useRef<HTMLFormElement>(null)
  const [selectedLabel, setSelectedLabel] = useState('All')
  const [labelDropdownOpen, setLabelDropdownOpen] = useState(false)
  const [addingLabel, setAddingLabel] = useState(false)
  const [newLabelText, setNewLabelText] = useState('')
  const labelDropdownRef = useRef<HTMLDivElement>(null)
  const addLabelInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!labelDropdownOpen) return
    const close = (e: MouseEvent) => {
      if (labelDropdownRef.current && !labelDropdownRef.current.contains(e.target as Node)) {
        setLabelDropdownOpen(false)
        setAddingLabel(false)
        setNewLabelText('')
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [labelDropdownOpen])

  useEffect(() => {
    if (addingLabel && addLabelInputRef.current) {
      addLabelInputRef.current.focus()
    }
  }, [addingLabel])

  const handleAddLabel = () => {
    const trimmed = newLabelText.trim()
    if (!trimmed) return
    setSelectedLabel(trimmed)
    setAddingLabel(false)
    setNewLabelText('')
    setLabelDropdownOpen(false)
  }

  const isJoinMode = inputValue.startsWith('@')
  const searchText = isJoinMode ? '' : inputValue.trim().toLowerCase()

  // Filter lists based on ownership, search text, and label
  const filteredLists = lists.filter(list => {
    const matchesViewMode = viewMode === 'mine' ? list.role === 'owner' : true
    const matchesSearch = searchText ? list.name.toLowerCase().includes(searchText) : true
    const matchesLabel = selectedLabel === 'All' ? true : (list.label || '') === selectedLabel
    return matchesViewMode && matchesSearch && matchesLabel
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
      }
    } else {
      setInputValue('')
      const labelToAssign = selectedLabel !== 'All' ? selectedLabel : undefined
      const { error } = await createList(submittedValue, labelToAssign)
      
      if (error) {
        setInputValue(submittedValue)
        setError(error.message)
        showError('Failed to create list')
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

  useEffect(() => {
    if (!inputValue) return

    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target || formRef.current?.contains(target)) return
      setInputValue('')
    }

    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [inputValue])

  useEffect(() => {
    if (!inviteToken) {
      inviteJoinRef.current = null
      return
    }

    if (inviteJoinRef.current === inviteToken) return
    inviteJoinRef.current = inviteToken

    let cancelled = false

    const handleInviteJoin = async () => {
      setError('')
      const { data, error } = await joinListByToken(inviteToken)
      if (cancelled) return

      onInviteHandled?.()

      if (error) {
        setError(error.message)
        showError(error.message || 'Failed to join list')
        return
      }

      success('Joined list!')

      if (typeof data === 'string' && data) {
        router.replace(`/list/${data}`)
      }
    }

    void handleInviteJoin()

    return () => {
      cancelled = true
    }
  }, [inviteToken, joinListByToken, onInviteHandled, router, showError, success])

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

      {/* Label filter dropdown */}
      <div className="flex justify-end" ref={labelDropdownRef}>
        <div className="relative">
          <button
            type="button"
            onClick={() => { setLabelDropdownOpen(o => !o); setAddingLabel(false); setNewLabelText('') }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              labelDropdownOpen
                ? 'bg-white dark:bg-slate-800 text-teal border border-teal'
                : 'bg-teal text-white'
            }`}
          >
            <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 1024 1024" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M746.5 575.9L579.2 743.6l-173-173.5-53.3-112.4 108.3-108.6 112.2 53.4z" opacity="0.3" />
              <path d="M579.4 389.9l-112.2-53.4c-5.3-2.5-11.6-1.4-15.8 2.7L435 355.7c-85.5-108.1-150.2-83.1-152.9-82-5 2-8.4 6.7-8.8 12.1-4.6 72.2 38.2 118.1 86.8 145l-17 17c-4.2 4.2-5.3 10.5-2.7 15.8L393.7 576c0.7 1.4 1.6 2.8 2.7 3.9l173.1 173.5c5.4 5.4 14.2 5.4 19.7 0l167.3-167.6c2.6-2.6 4.1-6.2 4.1-9.9s-1.5-7.2-4.1-9.9L583.3 392.6c-1.2-1.1-2.5-2-3.9-2.7z m-278.7-91.5c17.3-0.6 58.8 5.9 114 76.6 0.1 0.2 0.3 0.3 0.5 0.5l-34.7 34.8c-38.8-19.1-78.8-53-79.8-111.9z m426.1 277.5L579.2 723.8 417.7 562l-48-101.4 17-17c14 5.8 27.9 10.1 40.7 13.1 1.1 4.7 3.5 9.3 7.2 13a27.22 27.22 0 0 0 38.6 0c10.7-10.7 10.7-28 0-38.7-10.3-10.3-26.6-10.6-37.3-1.1-7.5-1.8-17.1-4.4-27.6-8l55.8-55.9 101.2 48 161.5 161.9z" />
            </svg>
            {selectedLabel}
            <svg className={`h-3 w-3 transition-transform ${labelDropdownOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>

          {labelDropdownOpen && (
            <div className="absolute right-0 mt-1 min-w-[160px] rounded-lg border border-teal bg-white dark:bg-slate-800 shadow-lg dark:shadow-slate-900/50 z-50 overflow-hidden">
              {/* "All" option */}
              <button
                type="button"
                onClick={() => { setSelectedLabel('All'); setLabelDropdownOpen(false) }}
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                  selectedLabel === 'All' ? 'bg-teal/10 text-teal font-semibold' : 'text-teal hover:bg-gray-50 dark:hover:bg-slate-700'
                }`}
              >
                All
              </button>
              {/* Existing labels */}
              {labels.map(l => (
                <button
                  key={l}
                  type="button"
                  onClick={() => { setSelectedLabel(l); setLabelDropdownOpen(false) }}
                  className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                    selectedLabel === l ? 'bg-teal/10 text-teal font-semibold' : 'text-teal hover:bg-gray-50 dark:hover:bg-slate-700'
                  }`}
                >
                  {l}
                </button>
              ))}
              {/* Add label */}
              {!addingLabel ? (
                <button
                  type="button"
                  onClick={() => setAddingLabel(true)}
                  className="w-full text-left px-4 py-2 text-sm text-teal hover:bg-gray-50 dark:hover:bg-slate-700 border-t border-gray-200 dark:border-slate-600"
                >
                  + Add label
                </button>
              ) : (
                <div className="p-2 border-t border-gray-200 dark:border-slate-600 space-y-2">
                  <input
                    ref={addLabelInputRef}
                    type="text"
                    value={newLabelText}
                    onChange={(e) => setNewLabelText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleAddLabel() }
                      if (e.key === 'Escape') { setAddingLabel(false); setNewLabelText('') }
                    }}
                    placeholder="Label name..."
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:border-teal bg-white dark:bg-slate-800 text-gray-800 dark:text-gray-200"
                  />
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => { setAddingLabel(false); setNewLabelText('') }}
                      className="px-2 py-1 text-xs text-white rounded bg-gray-400 hover:bg-gray-500"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewLabelText('')}
                      className="px-2 py-1 text-xs text-white rounded bg-teal hover:opacity-80"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={handleAddLabel}
                      className="px-2 py-1 text-xs text-white rounded bg-red-500 hover:bg-red-600"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create or Join */}
      <form ref={formRef} onSubmit={handleSubmit} className="flex gap-3" data-tour="create-list">
        <div className="flex-1">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setInputValue('')
              }
            }}
            placeholder="List name"
            disabled={submitting}
          />
        </div>
        <Button type="submit" loading={submitting} className="bg-red-500 hover:bg-red-600">
          {isJoinMode ? 'Join' : 'Create'}
        </Button>
      </form>

      {searchText && (
        <p className="text-xs text-gray-400 dark:text-gray-500 px-1 -mt-4">
          {filteredLists.length > 0
            ? 'Filtering...'
            : lists.length > 0
              ? 'No matching lists'
              : 'Filtering...'}
        </p>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {fetchError && lists.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between gap-3">
          <span>Can&apos;t refresh your lists right now.</span>
          <Button type="button" size="sm" variant="secondary" onClick={refresh}>
            Retry
          </Button>
        </div>
      )}

      {/* Lists */}
      <div className="space-y-2 min-h-[120px]">
        {fetchError && lists.length === 0 && (
          <div className="text-center py-10 px-4 border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 rounded-lg">
            <p className="text-red-700 font-medium">Can&apos;t load your lists right now.</p>
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">Please try again.</p>
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
                    onDuplicate={(id, name) => duplicateList(id, name, selectedLabel !== 'All' ? selectedLabel : undefined)}
                    onLeave={leaveList}
                    onRefresh={refresh}
                    labels={labels}
                    onUpdateLabel={updateListLabel}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {/* Separator between active and archived */}
        {archivedLists.length > 0 && (
          <div className="flex items-center gap-3 py-3">
            <div className="flex-1 h-px bg-gray-300 dark:bg-slate-600"></div>
            <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">Archived</span>
            <div className="flex-1 h-px bg-gray-300 dark:bg-slate-600"></div>
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
                    onDuplicate={(id, name) => duplicateList(id, name, selectedLabel !== 'All' ? selectedLabel : undefined)}
                    onLeave={leaveList}
                    onRefresh={refresh}
                    labels={labels}
                    onUpdateLabel={updateListLabel}
                  />
            ))}
          </div>
        )}

        {/* Empty state - only show when truly no lists exist */}
        {lists.length === 0 && (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400 italic">
            No lists yet. Create one above!
          </div>
        )}
      </div>
      
      {/* Tutorial - shows available steps, resumes when new targets appear */}
      {homeTourSteps && showTutorial && (
        <TutorialTour 
          tourId="home" 
          steps={homeTourSteps}
          contentKey={lists.map(list => `${list.id}:${list.userArchived ? 'archived' : 'active'}`).join('|')}
        />
      )}
    </div>
  )
}
