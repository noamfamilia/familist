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
import { ImportModal } from '@/components/import/ImportModal'
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
  selectedLabel?: string
  onLabelsChange?: (labels: string[]) => void
  onSelectLabel?: (label: string) => void
  onCreatingChange?: (creating: boolean) => void
  preCreateFilter?: string | null
  labelDropdownRef?: React.RefObject<HTMLDivElement | null>
  localLabels?: string[]
  showImport?: boolean
  onCloseImport?: () => void
  onAddLocalLabel?: (label: string) => void
}

export function ListsView({ viewMode, homeTourSteps, showTutorial = true, inviteToken = null, onInviteHandled, selectedLabel = 'Any', onLabelsChange, onSelectLabel, onCreatingChange, preCreateFilter, labelDropdownRef, localLabels = [], showImport, onCloseImport, onAddLocalLabel }: ListsViewProps) {
  const { lists, loading, fetchTimedOut, saveTimedOut, error: fetchError, refresh, createList, updateList, deleteList, updateUserListState, joinListByToken, leaveList, duplicateList, importList, reorderLists, updateListLabel, labels } = useLists()
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

  useEffect(() => {
    onLabelsChange?.(labels)
  }, [labels, onLabelsChange])

  // Notify parent when creating state changes
  const isCreating = !!inputValue && !inputValue.startsWith('@')
  useEffect(() => {
    onCreatingChange?.(isCreating)
  }, [isCreating, onCreatingChange])

  const clearCreateInput = () => {
    setInputValue('')
  }

  const isJoinMode = inputValue.startsWith('@')
  const searchText = isJoinMode ? '' : inputValue.trim().toLowerCase()

  // Filter lists based on ownership, search text, and label
  const filteredLists = lists.filter(list => {
    const matchesViewMode = viewMode === 'mine' ? list.role === 'owner' : true
    const matchesSearch = searchText ? list.name.toLowerCase().includes(searchText) : true
    const matchesLabel = isCreating || selectedLabel === 'Any' ? true : (list.label || '') === selectedLabel
    return matchesViewMode && matchesSearch && matchesLabel
  })

  // Separate active and archived lists
  const activeLists = filteredLists.filter(list => !list.userArchived)
  const archivedLists = filteredLists.filter(list => list.userArchived)
  
  // Get all owned list names (including archived) for duplicate name checking
  const ownedListNames = lists.filter(l => l.role === 'owner').map(l => l.name)
  const mergedLabels = [...labels, ...localLabels.filter(l => !labels.includes(l))]

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
      
      const { data, error } = await joinListByToken(token)
      
      if (error) {
        setError(error.message)
        showError(error.message || 'Failed to join list')
      } else {
        setInputValue('')
        onSelectLabel?.('Any')
        if (typeof data === 'string' && data) {
          const joined = lists.find(l => l.id === data)
          if (joined) {
            const by = joined.ownerNickname ? ` (by ${joined.ownerNickname})` : ''
            success(`Joined list "${joined.name}"${by}`)
          } else {
            success('Joined list!')
          }
        } else {
          success('Joined list!')
        }
      }
    } else {
      const chosenLabel = selectedLabel
      const labelToAssign = chosenLabel && chosenLabel !== 'Any' && chosenLabel !== '' ? chosenLabel : undefined
      const isSpecificLabel = !!labelToAssign
      const filterAfterCreate = isSpecificLabel
        ? chosenLabel
        : (preCreateFilter !== null && preCreateFilter !== 'Any' && preCreateFilter !== '' ? 'Any' : (preCreateFilter ?? 'Any'))
      clearCreateInput()
      const { error } = await createList(submittedValue, labelToAssign)
      
      if (error) {
        setInputValue(submittedValue)
        setError(error.message)
        showError('Failed to create list')
      } else {
        onSelectLabel?.(filterAfterCreate)
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
      if (!target || formRef.current?.contains(target) || labelDropdownRef?.current?.contains(target)) return
      clearCreateInput()
    }

    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
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

      onSelectLabel?.('Any')

      if (typeof data === 'string' && data) {
        const joined = lists.find(l => l.id === data)
        if (joined) {
          const by = joined.ownerNickname ? ` (by ${joined.ownerNickname})` : ''
          success(`Joined list "${joined.name}"${by}`)
        } else {
          success('Joined list!')
        }
        router.replace(`/list/${data}`)
      } else {
        success('Joined list!')
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

      {/* Create or Join */}
      <form ref={formRef} onSubmit={handleSubmit} className="flex gap-3" data-tour="create-list">
        <div className="flex-1">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                clearCreateInput()
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
                    onDuplicate={duplicateList}
                    onLeave={leaveList}
                    onRefresh={refresh}
                    labels={mergedLabels}
                    onUpdateLabel={updateListLabel}
                    onSelectLabel={onSelectLabel}
                    currentFilter={selectedLabel}
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
                    onDuplicate={duplicateList}
                    onLeave={leaveList}
                    onRefresh={refresh}
                    labels={mergedLabels}
                    onUpdateLabel={updateListLabel}
                    onSelectLabel={onSelectLabel}
                    currentFilter={selectedLabel}
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

      <ImportModal
        isOpen={!!showImport}
        onClose={() => onCloseImport?.()}
        labels={mergedLabels}
        currentFilter={selectedLabel}
        onSelectLabel={onSelectLabel}
        onAddLocalLabel={onAddLocalLabel}
        importList={importList}
        existingLists={lists}
      />
    </div>
  )
}
