'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
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
import { LabelManagerModal } from './LabelManagerModal'
import type { ListWithRole } from '@/lib/supabase/types'
import type { Step } from 'react-joyride'
import { appendMutationDiagnostic } from '@/lib/offlineNavDiagnostics'
import { prefetchListPageForNavigation } from '@/lib/data/listPageCachePrefetch'
import { useAuth } from '@/providers/AuthProvider'
import { useListsCatalogStore } from '@/stores/listsCatalogStore'

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
  localLabels?: string[]
  showImport?: boolean
  onCloseImport?: () => void
  onAddLocalLabel?: (label: string) => void
  labelManagerOpen?: boolean
  onCloseLabelManager?: () => void
  onOfflineActionsDisabledChange?: (offline: boolean) => void
}

export function ListsView({ viewMode, homeTourSteps, showTutorial = true, inviteToken = null, onInviteHandled, selectedLabel = 'Any', onLabelsChange, onSelectLabel, onCreatingChange, preCreateFilter, localLabels = [], showImport, onCloseImport, onAddLocalLabel, labelManagerOpen = false, onCloseLabelManager, onOfflineActionsDisabledChange }: ListsViewProps) {
  const { lists, loading, error: fetchError, refresh, createList, updateList, deleteList, updateUserListState, joinListByToken, leaveList, duplicateList, importList, reorderLists, updateListLabel, applyListLabelsBatch, labels, isOfflineActionsDisabled } = useLists()
  const { recentSuccesses, remoteDetailInflightIds, remoteDetailPulseAt } = useListsCatalogStore(
    useShallow((s) => ({
      recentSuccesses: s.recentSuccesses,
      remoteDetailInflightIds: s.remoteDetailInflightIds,
      remoteDetailPulseAt: s.remoteDetailPulseAt,
    })),
  )
  const { user, loading: authLoading, bootstrapUserId } = useAuth()
  const router = useRouter()
  /** `inviteToken:userId` after a successful join so we do not enqueue twice. */
  const inviteJoinSucceededKeyRef = useRef<string | null>(null)
  
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
  const inputValueRef = useRef('')
  inputValueRef.current = inputValue
  const [error, setError] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** True when create form was submitted via Enter in the text field (refocus after success). */
  const createListSubmitFromKeyboardRef = useRef(false)
  const createListInFlightRef = useRef(false)

  useEffect(() => {
    onOfflineActionsDisabledChange?.(isOfflineActionsDisabled)
  }, [isOfflineActionsDisabled, onOfflineActionsDisabledChange])

  const wasOfflineRef = useRef(isOfflineActionsDisabled)
  useEffect(() => {
    if (wasOfflineRef.current && !isOfflineActionsDisabled) {
      refresh()
    }
    wasOfflineRef.current = isOfflineActionsDisabled
  }, [isOfflineActionsDisabled, refresh])

  useEffect(() => {
    onLabelsChange?.(labels)
  }, [labels, onLabelsChange])

  // Notify parent when create field has draft text
  const isCreating = !!inputValue.trim()
  useEffect(() => {
    onCreatingChange?.(isCreating)
  }, [isCreating, onCreatingChange])

  const clearCreateInput = () => {
    setInputValue('')
  }

  /** Clear create draft only when the field has text (same idea as add-item draft on list page). */
  const clearCreateInputIfTyped = useCallback(() => {
    if (!inputValueRef.current.trim()) return
    setInputValue('')
  }, [])

  useEffect(() => {
    if (showImport) clearCreateInput()
  }, [showImport])

  const searchText = inputValue.trim().toLowerCase()

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
    if (!inputValue.trim()) {
      createListSubmitFromKeyboardRef.current = false
      return
    }
    if (createListInFlightRef.current) {
      return
    }

    const submittedValue = inputValue.trim()
    createListInFlightRef.current = true
    setError('')

    let refocusInput = false

    try {
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
      showError('Failed to create list', { serverError: error })
      refocusInput = true
    } else {
      onSelectLabel?.(filterAfterCreate)
      refocusInput = createListSubmitFromKeyboardRef.current
    }
    } finally {
      createListInFlightRef.current = false
    }
    createListSubmitFromKeyboardRef.current = false
    if (refocusInput) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    appendMutationDiagnostic(
      `[mutation:list.reorder.drag] event active=${String(active?.id ?? 'n/a')} over=${String(over?.id ?? 'n/a')} activeCount=${activeLists.length} archivedCount=${archivedLists.length} filteredCount=${filteredLists.length} totalCount=${lists.length}`,
    )
    
    if (over && active.id !== over.id) {
      const oldIndex = activeLists.findIndex(l => l.id === active.id)
      const newIndex = activeLists.findIndex(l => l.id === over.id)
      appendMutationDiagnostic(
        `[mutation:list.reorder.drag] indices oldIndex=${oldIndex} newIndex=${newIndex} beforeHead=${activeLists.slice(0, 5).map((l) => l.id).join(',')}`,
      )
      
      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = [...activeLists]
        const [removed] = reordered.splice(oldIndex, 1)
        reordered.splice(newIndex, 0, removed)
        appendMutationDiagnostic(
          `[mutation:list.reorder.drag] afterHead=${reordered.slice(0, 5).map((l) => l.id).join(',')} moved=${String(removed?.id ?? 'n/a')}`,
        )

        // Merge into full `lists` so RPC receives every list id once (hidden rows keep their slots).
        const nextFull = [...lists]
        const visibleActiveIds = new Set(activeLists.map((l) => l.id))
        const activeIndicesInFull: number[] = []
        for (let i = 0; i < lists.length; i++) {
          const l = lists[i]
          if (!l.userArchived && visibleActiveIds.has(l.id)) {
            activeIndicesInFull.push(i)
          }
        }
        if (activeIndicesInFull.length !== reordered.length) {
          appendMutationDiagnostic(
            `[mutation:list.reorder.drag] mergeSkip slots=${activeIndicesInFull.length} reordered=${reordered.length}`,
          )
        } else {
          for (let i = 0; i < activeIndicesInFull.length; i++) {
            nextFull[activeIndicesInFull[i]] = reordered[i]
          }
          appendMutationDiagnostic(
            `[mutation:list.reorder.drag] mergeFull head=${nextFull.slice(0, 5).map((l) => l.id).join(',')}`,
          )
          reorderLists(nextFull)
        }
      }
    }
  }

  useEffect(() => {
    if (!inviteToken) {
      inviteJoinSucceededKeyRef.current = null
      return
    }

    if (authLoading) {
      appendMutationDiagnostic(
        `[invite] ListsView defer join reason=authLoading tokenLen=${inviteToken.length} bootstrapUserId=${bootstrapUserId ? 'set' : 'absent'}`,
      )
      return
    }

    if (!user?.id) {
      appendMutationDiagnostic(
        `[invite] ListsView defer join reason=no_user_session tokenLen=${inviteToken.length} bootstrapUserId=${bootstrapUserId ? 'set' : 'absent'}`,
      )
      return
    }

    const successKey = `${inviteToken}:${user.id}`
    if (inviteJoinSucceededKeyRef.current === successKey) {
      return
    }

    let cancelled = false

    const handleInviteJoin = async () => {
      setError('')
      appendMutationDiagnostic(`[invite] ListsView join start userId=${user.id} tokenLen=${inviteToken.length}`)
      const { data, error, joinedListName } = await joinListByToken(inviteToken)
      if (cancelled) {
        appendMutationDiagnostic('[invite] ListsView join cancelled (unmount)')
        return
      }

      if (error) {
        if (error.message === 'Session still loading') {
          appendMutationDiagnostic('[invite] ListsView join returned session_loading (unexpected)')
          return
        }
        appendMutationDiagnostic(
          `[invite] ListsView join failed userId=${user.id} tokenLen=${inviteToken.length} err=${error.message}`,
        )
        setError(error.message)
        showError(error.message || 'Failed to join list', { serverError: error })
        return
      }

      onSelectLabel?.('Any')

      inviteJoinSucceededKeyRef.current = successKey
      onInviteHandled?.()

      appendMutationDiagnostic(
        `[invite] ListsView join ok userId=${user.id} tokenLen=${inviteToken.length} dataType=${typeof data} clearedUrl=1`,
      )

      if (typeof data === 'string' && data) {
        const nameFromCatalog =
          joinedListName ??
          lists.find((l) => l.id === data)?.name ??
          useListsCatalogStore.getState().lists.find((l) => l.id === data)?.name
        success(
          nameFromCatalog
            ? `Joined successfully to list ${nameFromCatalog}`
            : 'Joined successfully to list',
        )
        try {
          await prefetchListPageForNavigation(user.id, data)
        } catch {
          /* list page will warm if prefetch fails */
        }
        router.replace(`/list/${data}`)
      } else {
        success('Joined successfully to list')
      }
    }

    void handleInviteJoin()

    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- omit `lists` so catalog updates do not cancel/re-run join; toast reads snapshot
  }, [
    inviteToken,
    user?.id,
    authLoading,
    bootstrapUserId,
    joinListByToken,
    onInviteHandled,
    router,
    showError,
    success,
    onSelectLabel,
  ])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Create list */}
      <form ref={formRef} onSubmit={handleSubmit} className="flex gap-3" data-tour="create-list">
        <div className="flex-1 relative">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                createListSubmitFromKeyboardRef.current = true
              }
              if (e.key === 'Escape') {
                clearCreateInput()
              }
            }}
            placeholder="List name"
          />
          {inputValue && (
            <button
              type="button"
              onClick={clearCreateInput}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              aria-label="Clear input"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
        <Button type="submit" className={`bg-red-500 hover:bg-red-600 ${inputValue ? 'animate-button-nudge' : ''}`}>
          Create
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
                    recentSuccessStartedAt={recentSuccesses.get(list.id) ?? 0}
                    existingListNames={ownedListNames}
                    onUpdate={updateList}
                    onDelete={deleteList}
                    onArchive={updateUserListState}
                    onDuplicate={duplicateList}
                    onLeave={leaveList}
                    labels={mergedLabels}
                    onUpdateLabel={updateListLabel}
                    onSelectLabel={onSelectLabel}
                    currentFilter={selectedLabel}
                    onClearCreateInput={clearCreateInput}
                    onClearCreateInputIfTyped={clearCreateInputIfTyped}
                    isOfflineActionsDisabled={isOfflineActionsDisabled}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {/* Separator between active and archived */}
        {archivedLists.length > 0 && (
          <div className="flex items-center gap-3 py-3">
            <div className="flex-1 h-px bg-gray-300 dark:bg-neutral-700"></div>
            <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">Archived</span>
            <div className="flex-1 h-px bg-gray-300 dark:bg-neutral-700"></div>
          </div>
        )}

        {/* Archived Lists - not draggable */}
        {archivedLists.length > 0 && (
          <div className="space-y-2">
            {archivedLists.map(list => (
              <ListCard
                    key={list.id}
                    list={list}
                    recentSuccessStartedAt={recentSuccesses.get(list.id) ?? 0}
                    remoteDetailInflight={remoteDetailInflightIds.has(list.id)}
                    remotePulseStartedAt={remoteDetailPulseAt.get(list.id) ?? 0}
                    existingListNames={ownedListNames}
                    onUpdate={updateList}
                    onDelete={deleteList}
                    onArchive={updateUserListState}
                    onDuplicate={duplicateList}
                    onLeave={leaveList}
                    labels={mergedLabels}
                    onUpdateLabel={updateListLabel}
                    onSelectLabel={onSelectLabel}
                    currentFilter={selectedLabel}
                    onClearCreateInput={clearCreateInput}
                    onClearCreateInputIfTyped={clearCreateInputIfTyped}
                    isOfflineActionsDisabled={isOfflineActionsDisabled}
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

      <LabelManagerModal
        isOpen={labelManagerOpen}
        onClose={() => onCloseLabelManager?.()}
        lists={lists}
        availableLabels={labels}
        mergedLabels={mergedLabels}
        applyListLabelsBatch={applyListLabelsBatch}
        onAddLocalLabel={onAddLocalLabel ?? (() => {})}
        onError={showError}
      />
    </div>
  )
}
