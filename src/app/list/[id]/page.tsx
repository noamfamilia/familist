'use client'

import { useParams, useRouter } from 'next/navigation'
import { navigateBackToHome } from '@/lib/navigation/backToHome'
import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useAuth } from '@/providers/AuthProvider'
import { useList, nextListUserSumScope } from '@/hooks/useList'
import { useToast } from '@/components/ui/Toast'
import { USER_MUTATION_WAIT_MSG } from '@/lib/userMutationGate'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { SortableItemCard } from '@/components/items/SortableItemCard'
import { ItemCard } from '@/components/items/ItemCard'
import { ListSumRowCard } from '@/components/items/ListSumRowCard'
import { MemberHeader } from '@/components/items/MemberHeader'
import { itemNameFontClassForStep } from '@/lib/itemNameFontStep'
import { ShareCardIcon } from '@/components/ui/ShareIcons'
import type { ItemWithState, ItemCategory, ListUserSumScope } from '@/lib/supabase/types'
import { normalizeItemCategory, ITEM_CATEGORIES } from '@/lib/supabase/types'
import { ITEM_CATEGORY_STYLES } from '@/lib/categoryStyles'
import type { Step } from 'react-joyride'

const ConfirmModal = dynamic(() => import('@/components/ui/ConfirmModal').then(mod => mod.ConfirmModal), {
  ssr: false,
})
const Modal = dynamic(() => import('@/components/ui/Modal').then(mod => mod.Modal), {
  ssr: false,
})

/**
 * Drag-and-drop: move one item in the full list. Archived items never move.
 * The dragged item lands below any adjacent archived items, except when all
 * items above the insertion point are archived (position-0 exception).
 */
function reorderWithDrag(
  currentFull: ItemWithState[],
  newActiveOrder: ItemWithState[],
  draggedId: string,
): ItemWithState[] {
  const dragged = currentFull.find(i => i.id === draggedId)!
  const without = currentFull.filter(i => i.id !== draggedId)

  const dragIdx = newActiveOrder.findIndex(i => i.id === draggedId)
  const nextActive = newActiveOrder[dragIdx + 1]

  if (nextActive) {
    const nextIdx = without.findIndex(i => i.id === nextActive.id)
    // Exception: if everything before nextActive is archived, insert at 0
    const allArchivedAbove = without.slice(0, nextIdx).every(i => i.archived)
    if (nextIdx > 0 && allArchivedAbove) {
      return [dragged, ...without]
    }
    const result = [...without]
    result.splice(nextIdx, 0, dragged)
    return result
  }

  // Dragged is last: insert after previous active + trailing archived items
  const prevActive = newActiveOrder[dragIdx - 1]
  if (prevActive) {
    const prevIdx = without.findIndex(i => i.id === prevActive.id)
    let insertAt = prevIdx + 1
    while (insertAt < without.length && without[insertAt].archived) {
      insertAt++
    }
    const result = [...without]
    result.splice(insertAt, 0, dragged)
    return result
  }

  return [dragged, ...without]
}

/**
 * Category sort: active items get sorted, archived items stay at their
 * exact positions in the full list.
 */
function reorderByCategory(
  currentFull: ItemWithState[],
  sortedActive: ItemWithState[],
): ItemWithState[] {
  const result = [...currentFull]
  let activeIdx = 0
  for (let i = 0; i < result.length; i++) {
    if (!result[i].archived) {
      result[i] = sortedActive[activeIdx++]
    }
  }
  return result
}

function makeCategoryComparators(order: number[]) {
  const positionOf = (cat: number) => {
    const idx = order.indexOf(cat)
    return idx === -1 ? order.length : idx
  }

  const byCategory = (a: ItemWithState, b: ItemWithState) => {
    const ac = positionOf(normalizeItemCategory(a.category))
    const bc = positionOf(normalizeItemCategory(b.category))
    if (ac !== bc) return ac - bc
    return (a.sort_order || 0) - (b.sort_order || 0)
  }

  return { byCategory }
}

const TutorialTour = dynamic(() => import('@/components/ui/TutorialTour').then(mod => mod.TutorialTour), {
  ssr: false,
})
const ShareModal = dynamic(() => import('@/components/lists/ShareModal').then(mod => mod.ShareModal), {
  ssr: false,
})

const GOALS_OPTIONS: { value: 'hide' | 'mine' | 'all'; label: string }[] = [
  { value: 'hide', label: 'Hide all Tasks' },
  { value: 'mine', label: 'Show my Tasks' },
  { value: 'all', label: 'Show all Tasks' },
]

// All list tour steps - shown progressively as targets become available (filtered by DOM).
// Order: add-item → item-text-width → row (name, drag, item menu, quantity); +Goal then sort; member kebab.
const listTourSteps: Step[] = [
  {
    target: '[data-tour="share-settings"]',
    content: 'Share this list with others.',
    disableBeacon: true,
  },
  {
    target: '[data-tour="add-item"]',
    content: 'Add items to your list',
  },
  {
    target: '[data-tour="item-text-width"]',
    content: 'Use ◀ and ▶ to give item names more or less space.',
  },
  {
    target: '[data-tour="item-name"]',
    content: 'Click the item name to archive/restore it.',
  },
  {
    target: '[data-tour="drag-handle"]',
    content: 'Drag to re-arrange items.',
    spotlightPadding: 2,
  },
  {
    target: '[data-tour="item-menu"]',
    content: 'Item menu options',
  },
  {
    target: '[data-tour="item-state"]',
    content: 'Edit quantity and status.',
  },
  {
    target: '[data-tour="add-member"]',
    content: 'Set your own tasks',
  },
  {
    target: '[data-tour="category-sort"]',
    content: 'List actions menu.',
  },
  {
    target: '[data-tour="member-chip"]',
    content: 'Tap a member to view, edit and filter.',
    spotlightPadding: 2,
  },
]

export default function ListPage() {
  const params = useParams()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const listId = params.id as string
  const { error: showError, warning: showWarning } = useToast()
  
  const {
    list,
    items,
    members,
    loading,
    fetchTimedOut,
    saveTimedOut,
    error,
    accessDenied,
    hasCompletedInitialFetch,
    memberFilter,
    itemTextWidth,
    itemTextWidthMode,
    itemNameFontStep,
    updateItemNameFontStep,
    categoryNames,
    categoryOrder,
    refresh,
    addItem,
    addMember,
    updateMember,
    deleteMember,
    ownMember,
    updateItem,
    deleteItem,
    updateMemberState,
    changeQuantity,
    reorderItems,
    deleteArchivedItems,
    restoreArchivedItems,
    updateMemberFilter,
    updateItemTextWidth,
    updateItemTextWidthMode,
    saveCategorySettings,
    lastViewedMembers,
    createTargets,
    sumScope,
    updateListUserSumScope,
    isOfflineActionsDisabled,
  } = useList(listId)

  // Redirect to home if access is revoked
  useEffect(() => {
    if (accessDenied) {
      showError('You no longer have access to this list')
      router.replace('/')
    }
  }, [accessDenied, router, showError])

  const [showNewMemberAlert, setShowNewMemberAlert] = useState(false)
  const knownMemberIdsRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!hasCompletedInitialFetch || !user) return
    const nonTargetMembers = members.filter(m => !m.is_target)
    const currentIds = new Set(nonTargetMembers.map(m => m.id))

    if (knownMemberIdsRef.current === null) {
      knownMemberIdsRef.current = currentIds
      if (memberFilter === 'all') return
      if (!lastViewedMembers) {
        if (nonTargetMembers.some(m => m.created_by !== user.id)) setShowNewMemberAlert(true)
        return
      }
      const hasNewFromOthers = nonTargetMembers.some(
        m => m.created_by !== user.id && new Date(m.created_at) > new Date(lastViewedMembers)
      )
      if (hasNewFromOthers) setShowNewMemberAlert(true)
      return
    }

    if (memberFilter === 'all') {
      knownMemberIdsRef.current = currentIds
      return
    }
    const newFromOthers = nonTargetMembers.some(
      m => !knownMemberIdsRef.current!.has(m.id) && m.created_by !== user.id
    )
    knownMemberIdsRef.current = currentIds
    if (newFromOthers) setShowNewMemberAlert(true)
  }, [hasCompletedInitialFetch, lastViewedMembers, members, memberFilter, user])

  useEffect(() => {
    if (!showNewMemberAlert) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        updateMemberFilter('all')
        setShowNewMemberAlert(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showNewMemberAlert, updateMemberFilter])

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
  const [newItemText, setNewItemText] = useState('')
  const newItemTextRef = useRef('')
  newItemTextRef.current = newItemText
  const [hideDone, setHideDone] = useState<Record<string, boolean>>({})
  const [hideNotRelevant, setHideNotRelevant] = useState<Record<string, boolean>>({})
  const [categorySortLoading, setCategorySortLoading] = useState(false)
  const [expandSignal, setExpandSignal] = useState(0)
  const [collapseSignal, setCollapseSignal] = useState(0)
  const [confirmDeleteArchived, setConfirmDeleteArchived] = useState(false)
  const [confirmRestoreArchived, setConfirmRestoreArchived] = useState(false)
  const [bulkLoading, setBulkLoading] = useState(false)
  const addItemFormRef = useRef<HTMLFormElement>(null)
  const addItemInputRef = useRef<HTMLInputElement>(null)
  /** True when the add-item form was submitted via Enter in the text field (refocus after success). */
  const addItemSubmitFromKeyboardRef = useRef(false)
  const addItemInFlightRef = useRef(false)
  const addItemWrapperRef = useRef<HTMLDivElement>(null)
  const timeoutToastShownRef = useRef(false)
  const [showShareModal, setShowShareModal] = useState(false)

  const handleBackToLists = () => {
    navigateBackToHome(router)
  }

  const handleWidthChange = (delta: number) => {
    if (itemTextWidthMode === 'auto') {
      updateItemTextWidthMode('manual')
    }
    updateItemTextWidth(itemTextWidth + delta)
  }

  const handleWidthModeToggle = () => {
    updateItemTextWidthMode('auto')
  }

  const itemNameFontClassName = itemNameFontClassForStep(itemNameFontStep)

  const [newItemCategory, setNewItemCategory] = useState<ItemCategory>(1)

  /** New list in the URL: reset add-item draft and category picker (sticky category is per visit, per list). */
  useEffect(() => {
    setNewItemText('')
    setNewItemCategory(1)
  }, [listId])

  const clearNewItem = () => {
    setNewItemText('')
  }

  const handleClearAddItemDraftIfTyped = useCallback(() => {
    if (!newItemTextRef.current.trim()) return
    setNewItemText('')
  }, [])

  useEffect(() => {
    const timedOut = fetchTimedOut || saveTimedOut
    if (!timedOut) {
      timeoutToastShownRef.current = false
      return
    }
    if (timeoutToastShownRef.current) return
    timeoutToastShownRef.current = true
    showError('Sync with server failed')
  }, [fetchTimedOut, saveTimedOut, showError])

  if (authLoading || loading) {
    return (
      <div className="bg-white dark:bg-neutral-800 rounded-none sm:rounded-xl shadow-none sm:shadow-lg dark:shadow-black/40 p-6 sm:p-8 w-full sm:min-w-[300px] sm:w-auto min-h-screen sm:min-h-0 flex items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (!list) {
    return (
      <div className="bg-white dark:bg-neutral-800 rounded-none sm:rounded-xl shadow-none sm:shadow-lg dark:shadow-black/40 p-6 sm:p-8 w-full sm:min-w-[300px] sm:w-auto min-h-screen sm:min-h-0 flex flex-col items-center justify-center">
        {error ? (
          <>
            <p className="text-center text-red-700 font-medium">Can&apos;t load this list right now.</p>
            <p className="text-center text-sm text-red-600 mt-1">Please try again.</p>
            <div className="flex items-center gap-3 mt-4">
              <Button type="button" size="sm" variant="secondary" onClick={refresh}>
                Retry
              </Button>
              <button
                onClick={handleBackToLists}
                className="text-primary dark:text-gray-100 hover:underline block"
              >
                ← Back to lists
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-center text-gray-500 dark:text-gray-400">List not found or deleted</p>
            <button
              onClick={handleBackToLists}
              className="mt-4 text-primary dark:text-gray-100 hover:underline block mx-auto"
            >
              ← Back to lists
            </button>
          </>
        )}
      </div>
    )
  }

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newItemText.trim()) {
      addItemSubmitFromKeyboardRef.current = false
      return
    }
    if (addItemInFlightRef.current) {
      showWarning(USER_MUTATION_WAIT_MSG)
      return
    }

    const itemText = newItemText.trim()
    const cat = newItemCategory
    addItemInFlightRef.current = true
    setNewItemText('')
    let err: { message?: string } | null | undefined
    try {
      const result = await addItem(itemText, cat)
      err = result.error as { message?: string } | null | undefined
      if (err) {
        if (err.message === 'Offline (actions disabled)') {
          addItemInputRef.current?.blur()
        }
        if (
          err.message !== 'Syncing with server ...' &&
          err.message !== USER_MUTATION_WAIT_MSG &&
          err.message !== 'Offline (actions disabled)'
        ) {
          showError(err.message || 'Failed to add item')
        }
      }
    } finally {
      addItemInFlightRef.current = false
    }
    const refocus =
      addItemSubmitFromKeyboardRef.current && !err
    addItemSubmitFromKeyboardRef.current = false
    if (refocus) {
      requestAnimationFrame(() => addItemInputRef.current?.focus())
    }
  }

  const searchText = newItemText.trim().toLowerCase()

  const activeItemsBase = items
    .filter(item => !item.archived)
    .filter(item => searchText ? item.text.toLowerCase().includes(searchText) : true)

  const activeItems = [...activeItemsBase].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))

  const archivedItemsBase = items
    .filter(item => item.archived)
    .filter(item => searchText ? item.text.toLowerCase().includes(searchText) : true)

  const archivedItems = [...archivedItemsBase].sort((a, b) => {
    const aTime = a.archived_at ? new Date(a.archived_at).getTime() : 0
    const bTime = b.archived_at ? new Date(b.archived_at).getTime() : 0
    return bTime - aTime
  })

  const hasTargetMember = members.some(m => m.is_target)

  const filteredMembers = memberFilter === 'all'
    ? members
    : memberFilter === 'mine'
    ? members.filter(m => m.created_by === user?.id)
    : []

  const toggleHideDone = (memberId: string) => {
    setHideDone(prev => ({
      ...prev,
      [memberId]: !prev[memberId],
    }))
  }

  const toggleHideNotRelevant = (memberId: string) => {
    setHideNotRelevant(prev => ({
      ...prev,
      [memberId]: !prev[memberId],
    }))
  }

  const handleCategorySortClick = async () => {
    if (categorySortLoading || items.length === 0) return
    const { byCategory } = makeCategoryComparators(categoryOrder)
    const currentFull = [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const sortedActive = currentFull.filter(i => !i.archived).sort(byCategory)
    const fullOrder = reorderByCategory(currentFull, sortedActive)
    setCategorySortLoading(true)
    const { error: reorderError } = await reorderItems(fullOrder)
    setCategorySortLoading(false)
    if (reorderError) {
      showError(reorderError.message || 'Failed to sort by category')
    }
  }

  const handleExpandAll = () => setExpandSignal(s => s + 1)
  const handleCollapseAll = () => setCollapseSignal(s => s + 1)

  const persistSumScope = async (next: ListUserSumScope) => {
    const { error } = await updateListUserSumScope(next)
    if (error) {
      showError(error.message || 'Failed to update sum row')
    }
  }

  const handleDeleteAllArchived = async () => {
    setBulkLoading(true)
    const { error } = await deleteArchivedItems()
    setBulkLoading(false)
    setConfirmDeleteArchived(false)
    if (error) {
      showError(error.message || 'Failed to delete archived items')
    }
  }

  const handleRestoreAllArchived = async () => {
    setBulkLoading(true)
    const { error } = await restoreArchivedItems()
    setBulkLoading(false)
    setConfirmRestoreArchived(false)
    if (error) {
      showError(error.message || 'Failed to restore archived items')
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = activeItems.findIndex(i => i.id === active.id)
      const newIndex = activeItems.findIndex(i => i.id === over.id)

      if (oldIndex !== -1 && newIndex !== -1) {
        const newActiveOrder = [...activeItems]
        const [removed] = newActiveOrder.splice(oldIndex, 1)
        newActiveOrder.splice(newIndex, 0, removed)
        const currentFull = [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        const fullOrder = reorderWithDrag(currentFull, newActiveOrder, active.id as string)
        const { error: reorderError } = await reorderItems(fullOrder)
        if (reorderError) {
          showError(reorderError.message || 'Failed to reorder items')
        }
      }
    }
  }

  const noMemberColumns = filteredMembers.length === 0
  const openMutatingModal = (open: () => void) => {
    if (isOfflineActionsDisabled) {
      return
    }
    open()
  }

  return (
    <div className="bg-white dark:bg-neutral-800 rounded-none sm:rounded-xl shadow-none sm:shadow-lg dark:shadow-black/40 w-fit max-w-full min-w-0 sm:min-w-[450px] min-h-screen sm:min-h-0 px-4 pb-4 pt-6 sm:p-8">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 px-4 py-3 rounded-lg text-sm flex items-start justify-between gap-3 mb-4">
          <span className="min-w-0 flex-1">
            <span className="font-medium block">Can&apos;t refresh this list right now.</span>
            <span className="block text-xs text-red-600/90 dark:text-red-400 mt-1.5 break-words font-mono leading-snug">
              {error}
            </span>
          </span>
          <Button type="button" size="sm" variant="secondary" onClick={refresh} className="flex-shrink-0">
            Retry
          </Button>
        </div>
      )}

      {/* Top bar with back button and member filter */}
      <div className="flex w-full min-w-0 items-center justify-between mb-4">
        <button
          type="button"
          onClick={handleBackToLists}
          className="h-8 flex items-center text-primary dark:text-gray-100 hover:underline text-sm sm:text-base"
          aria-label="Go back to all lists"
        >
          ← Back to lists
        </button>
        {list && list.owner_id === user?.id && (
          <button
            type="button"
            onClick={() => setShowShareModal(true)}
            className="text-teal hover:opacity-70"
            aria-label="Share settings"
            data-tour="share-settings"
          >
            <ShareCardIcon className="w-[30px] h-[30px]" emphasized />
          </button>
        )}
      </div>

      {/* Header */}
      <header className="text-center mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold text-teal">{list.name}</h1>
      </header>

      {/* Add item form */}
      <div ref={addItemWrapperRef} className="relative mb-4 sm:mb-6">
          <div
            onMouseDown={(e) => e.preventDefault()}
            className={`absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-gray-200 dark:border-neutral-600 shadow-lg z-20 bg-white dark:bg-neutral-900 overflow-hidden transition-all duration-150 ease-out origin-bottom ${
              newItemText
                ? 'opacity-100 scale-y-100 translate-y-0'
                : 'opacity-0 scale-y-95 translate-y-1 pointer-events-none'
            }`}
          >
            <div className={`p-3 transition-colors ${ITEM_CATEGORY_STYLES[newItemCategory].shell}`}>
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Item category">
              {(categoryOrder || ITEM_CATEGORIES).map(c => {
                const catId = c as ItemCategory
                const label = categoryNames?.[String(catId)] || ''
                return (
                  <button
                    key={catId}
                    type="button"
                    tabIndex={-1}
                    aria-label={`Category ${catId}`}
                    aria-pressed={catId === newItemCategory}
                    onClick={() => setNewItemCategory(catId)}
                    className={`h-7 px-2 rounded-md touch-manipulation transition-shadow flex items-center justify-center text-xs leading-none overflow-hidden ${ITEM_CATEGORY_STYLES[catId].swatch} ${
                      catId === newItemCategory
                        ? 'ring-2 ring-teal ring-offset-1 ring-offset-white shadow-sm font-semibold text-primary dark:ring-transparent dark:ring-offset-0 dark:outline-2 dark:outline-current'
                        : 'text-gray-500 hover:opacity-90 dark:hover:opacity-90'
                    }`}
                  >
                    <span className="truncate">{label}</span>
                  </button>
                )
              })}
            </div>
            </div>
          </div>
        <form ref={addItemFormRef} onSubmit={handleAddItem} className="flex w-full min-w-0 gap-2 sm:gap-3" data-tour="add-item">
          <div className="flex-1 relative">
            <Input
              ref={addItemInputRef}
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  addItemSubmitFromKeyboardRef.current = true
                }
                if (e.key === 'Escape') {
                  clearNewItem()
                }
              }}
              placeholder="Add an item..."
              aria-label="New item name"
              className={ITEM_CATEGORY_STYLES[newItemCategory].itemName}
            />
            {newItemText && (
              <button
                type="button"
                onClick={clearNewItem}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                aria-label="Clear input"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>
          <Button type="submit" className={`bg-red-500 hover:bg-red-600 ${newItemText ? 'animate-button-nudge' : ''}`}>
            Add
          </Button>
        </form>
      </div>

      {searchText && (
        <p className="text-xs text-gray-400 dark:text-gray-500 px-1 -mt-4 mb-4 sm:mb-6">
          {activeItems.length > 0 || archivedItems.length > 0
            ? 'Filtering...'
            : items.length > 0
              ? 'No matching items'
              : 'Filtering...'}
        </p>
      )}

      {/* With members: scroll horizontally if table exceeds viewport (outer is w-fit max-w-full). Without members: width follows widest item row. */}
      <div className={noMemberColumns ? 'w-full min-w-0' : 'max-w-full overflow-x-auto'}>
        <div
          className={
            noMemberColumns ? 'inline-block w-max min-w-full' : 'inline-block min-w-full'
          }
        >
          {/* Members header with hide done toggles */}
          <div
            className={`sticky top-0 z-40 bg-white dark:bg-neutral-900${noMemberColumns ? ' block min-w-full w-max' : ''}`}
            data-tour="members-header"
          >
            <MemberHeader
              members={filteredMembers}
              allMembers={members}
              hideDone={hideDone}
              hideNotRelevant={hideNotRelevant}
              onToggleHideDone={toggleHideDone}
              onToggleHideNotRelevant={toggleHideNotRelevant}
              onAddMember={addMember}
              onUpdateMember={updateMember}
              onDeleteMember={deleteMember}
              onOwnMember={ownMember}
              listId={listId}
              showAddMember={memberFilter !== 'hide'}
              itemTextWidth={itemTextWidth}
              itemTextWidthMode={itemTextWidthMode}
              onWidthChange={handleWidthChange}
              onWidthModeToggle={handleWidthModeToggle}
              itemNameFontStep={itemNameFontStep}
              onItemNameFontStepChange={updateItemNameFontStep}
              showActionsMenu
              actionsMenuLoading={categorySortLoading || bulkLoading}
              hasArchivedItems={archivedItems.length > 0}
              onCategorySortClick={handleCategorySortClick}
              onExpandAll={handleExpandAll}
              onCollapseAll={handleCollapseAll}
              onDeleteAllArchived={() => openMutatingModal(() => setConfirmDeleteArchived(true))}
              onRestoreAllArchived={() => openMutatingModal(() => setConfirmRestoreArchived(true))}
              isOwner={list?.owner_id === user?.id}
              hasTargetMember={hasTargetMember}
              onCreateTargets={createTargets}
              categoryNames={categoryNames}
              categoryOrder={categoryOrder}
              onSaveCategorySettings={saveCategorySettings}
              sumScope={sumScope}
              onEnableSumItems={() => void persistSumScope('all')}
            />
          </div>

          {/* Active items — min-w-full w-max children so widest row sets column width */}
          <div className={noMemberColumns ? 'flex w-max min-w-full flex-col gap-2' : 'space-y-2'}>
            {sumScope !== 'none' && (
              <ListSumRowCard
                sumScope={sumScope}
                items={items}
                members={filteredMembers}
                itemTextWidth={itemTextWidth}
                itemNameFontClassName={itemNameFontClassName}
                itemNameFontStep={itemNameFontStep}
                onCycleScope={() => void persistSumScope(nextListUserSumScope(sumScope))}
                onRemove={() => void persistSumScope('none')}
                onClearAddItemDraft={handleClearAddItemDraftIfTyped}
              />
            )}
            {activeItems.length > 0 ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={activeItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                  {activeItems.map(item => (
                    <SortableItemCard
                      key={item.id}
                      item={item}
                      members={filteredMembers}
                      hideDone={hideDone}
                      hideNotRelevant={hideNotRelevant}
                      onUpdateItem={updateItem}
                      onDeleteItem={deleteItem}
                      onChangeQuantity={changeQuantity}
                      onUpdateMemberState={updateMemberState}
                      itemTextWidth={itemTextWidth}
                      expandSignal={expandSignal}
                      collapseSignal={collapseSignal}
                      categoryNames={categoryNames}
                      categoryOrder={categoryOrder}
                      onClearAddItemDraft={handleClearAddItemDraftIfTyped}
                      itemNameFontClassName={itemNameFontClassName}
                      itemNameFontStep={itemNameFontStep}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            ) : items.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400 italic">
                No items yet. Add one above!
              </div>
            ) : null}
          </div>

          {/* Archived section separator */}
          {archivedItems.length > 0 && (
            <>
              <div className="flex items-center gap-3 my-6">
                <div className="flex-1 h-px bg-gray-300 dark:bg-neutral-700" />
                <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">Archived</span>
                <div className="flex-1 h-px bg-gray-300 dark:bg-neutral-700" />
              </div>

              {/* Archived items list (no drag) */}
              <div className={noMemberColumns ? 'flex w-max min-w-full flex-col gap-2' : 'space-y-2'}>
                {archivedItems.map(item => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    members={filteredMembers}
                    hideDone={hideDone}
                    hideNotRelevant={hideNotRelevant}
                    onUpdateItem={updateItem}
                    onDeleteItem={deleteItem}
                    onChangeQuantity={changeQuantity}
                    onUpdateMemberState={updateMemberState}
                    isDraggable={false}
                    itemTextWidth={itemTextWidth}
                    expandSignal={expandSignal}
                    collapseSignal={collapseSignal}
                    categoryNames={categoryNames}
                    categoryOrder={categoryOrder}
                    onClearAddItemDraft={handleClearAddItemDraftIfTyped}
                    itemNameFontClassName={itemNameFontClassName}
                    itemNameFontStep={itemNameFontStep}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      
      {/* Tutorial - shows available steps, resumes when new targets appear */}
      <TutorialTour 
        tourId="list" 
        steps={listTourSteps}
        contentKey={`${items.map(item => `${item.id}:${item.archived ? 'archived' : 'active'}`).join('|')}::${members.map(member => member.id).join('|')}`}
      />

      <ConfirmModal
        isOpen={confirmDeleteArchived}
        onClose={() => setConfirmDeleteArchived(false)}
        onConfirm={handleDeleteAllArchived}
        title="Delete all Archived"
        message={`Delete all ${archivedItems.length} archived item${archivedItems.length === 1 ? '' : 's'}? This cannot be undone.`}
        confirmText="Delete all"
        variant="danger"
        loading={bulkLoading}
      />

      <ConfirmModal
        isOpen={confirmRestoreArchived}
        onClose={() => setConfirmRestoreArchived(false)}
        onConfirm={handleRestoreAllArchived}
        title="Restore all Archived"
        message={`Restore all ${archivedItems.length} archived item${archivedItems.length === 1 ? '' : 's'} back to the active list?`}
        confirmText="Restore all"
        variant="danger"
        loading={bulkLoading}
      />

      <Modal
        isOpen={showNewMemberAlert}
        onClose={() => setShowNewMemberAlert(false)}
        size="xs"
        hideClose
        contentClassName="!mt-16"
      >
        <p className="text-base text-gray-700 dark:text-gray-300 text-center leading-relaxed mb-6">
          A user added a new task.
          <br />
          Switch to &ldquo;Show all Tasks&rdquo; to view it?
        </p>
        <div className="flex justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              updateMemberFilter('all')
              setShowNewMemberAlert(false)
            }}
            className="px-5 py-2 text-base font-medium text-white bg-teal rounded-lg hover:opacity-80"
          >
            Ok
          </button>
          <button
            type="button"
            onClick={() => setShowNewMemberAlert(false)}
            className="px-5 py-2 text-base font-medium text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-neutral-700 rounded-lg hover:bg-gray-300"
          >
            Dismiss
          </button>
        </div>
      </Modal>

      {list && list.owner_id === user?.id && (
        <ShareModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          list={list}
          onUpdate={refresh}
        />
      )}
    </div>
  )
}
