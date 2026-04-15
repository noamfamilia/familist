'use client'

import { useParams, useRouter } from 'next/navigation'
import { navigateBackToHome } from '@/lib/navigation/backToHome'
import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useAuth } from '@/providers/AuthProvider'
import { useList } from '@/hooks/useList'
import { useToast } from '@/components/ui/Toast'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { SortableItemCard } from '@/components/items/SortableItemCard'
import { ItemCard } from '@/components/items/ItemCard'
import { MemberHeader } from '@/components/items/MemberHeader'
import type { ItemWithState, ItemCategory } from '@/lib/supabase/types'
import { normalizeItemCategory, ITEM_CATEGORIES } from '@/lib/supabase/types'
import { ITEM_CATEGORY_STYLES } from '@/lib/categoryStyles'
import type { Step } from 'react-joyride'

const ConfirmModal = dynamic(() => import('@/components/ui/ConfirmModal').then(mod => mod.ConfirmModal), {
  ssr: false,
})
const Modal = dynamic(() => import('@/components/ui/Modal').then(mod => mod.Modal), {
  ssr: false,
})

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

  const archivedByCategory = (a: ItemWithState, b: ItemWithState) => {
    const byCat = byCategory(a, b)
    if (byCat !== 0) return byCat
    const aTime = a.archived_at ? new Date(a.archived_at).getTime() : 0
    const bTime = b.archived_at ? new Date(b.archived_at).getTime() : 0
    return bTime - aTime
  }

  return { byCategory, archivedByCategory }
}

const TutorialTour = dynamic(() => import('@/components/ui/TutorialTour').then(mod => mod.TutorialTour), {
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
    target: '[data-tour="view-toggle"]',
    content: 'Choose which tasks to display: all, yours, or none.',
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
    content: 'List actions: sort, expand/collapse, and manage archived items.',
  },
  {
    target: '[data-tour="member-chip"]',
    content: 'Tap a member to see menu options.',
    spotlightPadding: 2,
  },
]

export default function ListPage() {
  const params = useParams()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const listId = params.id as string
  const { error: showError, success: showSuccess, info: showInfo } = useToast()
  
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
    updateCategoryNames,
    updateCategoryOrder,
    lastViewedMembers,
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
    const currentIds = new Set(members.map(m => m.id))

    if (knownMemberIdsRef.current === null) {
      // First load: seed known IDs, then check for unseen members from before this session
      knownMemberIdsRef.current = currentIds
      if (memberFilter === 'all' || !lastViewedMembers) return
      const hasNewFromOthers = members.some(
        m => m.created_by !== user.id && new Date(m.created_at) > new Date(lastViewedMembers)
      )
      if (hasNewFromOthers) setShowNewMemberAlert(true)
      return
    }

    // Realtime update: detect newly appeared members from other users
    if (memberFilter === 'all') {
      knownMemberIdsRef.current = currentIds
      return
    }
    const newFromOthers = members.some(
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
  const [adding, setAdding] = useState(false)
  const [hideDone, setHideDone] = useState<Record<string, boolean>>({})
  const [hideNotRelevant, setHideNotRelevant] = useState<Record<string, boolean>>({})
  const [categorySortLoading, setCategorySortLoading] = useState(false)
  const [expandSignal, setExpandSignal] = useState(0)
  const [collapseSignal, setCollapseSignal] = useState(0)
  const [confirmDeleteArchived, setConfirmDeleteArchived] = useState(false)
  const [confirmRestoreArchived, setConfirmRestoreArchived] = useState(false)
  const [bulkLoading, setBulkLoading] = useState(false)
  const addItemFormRef = useRef<HTMLFormElement>(null)
  const addItemWrapperRef = useRef<HTMLDivElement>(null)
  const [goalsDropdownOpen, setGoalsDropdownOpen] = useState(false)
  const goalsDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!goalsDropdownOpen) return
    const close = (e: MouseEvent) => {
      if (goalsDropdownRef.current && !goalsDropdownRef.current.contains(e.target as Node)) {
        e.preventDefault()
        e.stopPropagation()
        document.addEventListener('click', (ce) => { ce.preventDefault(); ce.stopPropagation() }, { capture: true, once: true })
        setGoalsDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', close, true)
    return () => document.removeEventListener('mousedown', close, true)
  }, [goalsDropdownOpen])

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

  const [newItemCategory, setNewItemCategory] = useState<ItemCategory>(1)

  const clearNewItem = () => {
    setNewItemText('')
    setNewItemCategory(1)
  }

  if (authLoading || loading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-none sm:rounded-xl shadow-none sm:shadow-lg dark:shadow-slate-900/50 p-6 sm:p-8 w-full sm:min-w-[300px] sm:w-auto min-h-screen sm:min-h-0 flex items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (!list) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-none sm:rounded-xl shadow-none sm:shadow-lg dark:shadow-slate-900/50 p-6 sm:p-8 w-full sm:min-w-[300px] sm:w-auto min-h-screen sm:min-h-0 flex flex-col items-center justify-center">
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
    if (!newItemText.trim()) return

    const itemText = newItemText.trim()
    const cat = newItemCategory
    setAdding(true)
    clearNewItem()
    const { error } = await addItem(itemText, cat)
    if (error) {
      setNewItemText(itemText)
      setNewItemCategory(cat)
      showError(error.message || 'Failed to add item')
    }
    setAdding(false)
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
    const { byCategory, archivedByCategory } = makeCategoryComparators(categoryOrder)
    const active = items.filter(i => !i.archived)
    const archived = items.filter(i => i.archived)
    const sortedActive = [...active].sort(byCategory)
    const sortedArchived = [...archived].sort(archivedByCategory)
    setCategorySortLoading(true)
    const { error: reorderError } = await reorderItems([...sortedActive, ...sortedArchived])
    setCategorySortLoading(false)
    if (reorderError) {
      showError(reorderError.message || 'Failed to sort by category')
    }
  }

  const handleExpandAll = () => setExpandSignal(s => s + 1)
  const handleCollapseAll = () => setCollapseSignal(s => s + 1)

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
        const reordered = [...activeItems]
        const [removed] = reordered.splice(oldIndex, 1)
        reordered.splice(newIndex, 0, removed)
        const { error: reorderError } = await reorderItems([...reordered, ...archivedItems])
        if (reorderError) {
          showError(reorderError.message || 'Failed to reorder items')
        }
      }
    }
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-none sm:rounded-xl shadow-none sm:shadow-lg dark:shadow-slate-900/50 w-full sm:min-w-[400px] max-w-3xl min-h-screen sm:min-h-0 px-4 pb-4 pt-6 sm:p-8">
      {/* Timeout message */}
      {(fetchTimedOut || saveTimedOut) && (
        <div className="bg-red-500 text-white px-4 py-3 rounded-lg text-center font-medium mb-4">
          Your changes may not have been saved to the server. Refresh page and try again
        </div>
      )}

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
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={handleBackToLists}
          className="h-8 flex items-center text-primary dark:text-gray-100 hover:underline text-sm sm:text-base"
          aria-label="Go back to all lists"
        >
          ← Back to lists
        </button>
        <div data-tour="view-toggle" className="relative" ref={goalsDropdownRef}>
          <button
            type="button"
            onClick={() => setGoalsDropdownOpen(o => !o)}
            className="h-8 px-3 pr-7 rounded-lg bg-teal text-white text-sm font-medium focus:outline-none relative"
          >
            {GOALS_OPTIONS.find(o => o.value === memberFilter)?.label}
            <svg className="absolute right-2 top-1/2 -translate-y-1/2" width="12" height="12" viewBox="0 0 12 12"><path fill="white" d="M3 5l3 3 3-3"/></svg>
          </button>
          {goalsDropdownOpen && (
            <div className="absolute right-0 mt-1 rounded-lg border border-teal bg-white dark:bg-slate-800 shadow-lg dark:shadow-slate-900/50 z-50 min-w-full overflow-hidden">
              {GOALS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { updateMemberFilter(opt.value); setGoalsDropdownOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                    opt.value === memberFilter
                      ? 'bg-teal/10 text-teal'
                      : 'text-teal hover:bg-teal/5'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Header */}
      <header className="text-center mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold text-teal">{list.name}</h1>
      </header>

      {/* Add item form */}
      <div ref={addItemWrapperRef} className="relative mb-4 sm:mb-6">
        {newItemText && (
          <div
            onMouseDown={(e) => e.preventDefault()}
            className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-gray-200 dark:border-slate-600 shadow-lg z-20 bg-white dark:bg-slate-800 overflow-hidden"
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
                    aria-label={`Category ${catId}`}
                    aria-pressed={catId === newItemCategory}
                    onClick={() => setNewItemCategory(catId)}
                    className={`h-7 px-2 rounded-md touch-manipulation transition-shadow flex items-center justify-center text-xs leading-none overflow-hidden ${ITEM_CATEGORY_STYLES[catId].swatch} ${
                      catId === newItemCategory ? 'ring-2 ring-teal ring-offset-1 ring-offset-white dark:ring-offset-slate-800 shadow-sm font-semibold text-primary dark:text-gray-100' : 'hover:opacity-90 text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    <span className="truncate">{label}</span>
                  </button>
                )
              })}
            </div>
            </div>
          </div>
        )}
        <form ref={addItemFormRef} onSubmit={handleAddItem} className="flex gap-2 sm:gap-3" data-tour="add-item">
          <div className="flex-1 relative">
            <Input
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  clearNewItem()
                }
              }}
              placeholder="Add an item..."
              disabled={adding}
              aria-label="New item name"
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
          <Button type="submit" loading={adding} className={`bg-red-500 hover:bg-red-600 ${newItemText ? 'animate-button-nudge' : ''}`}>
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

      {/* Horizontal scroll only: nested vertical overflow breaks react-joyride spotlight alignment */}
      <div className="overflow-x-auto">
        {/* Inner container that sizes based on content */}
        <div className="inline-block min-w-full">
          {/* Members header with hide done toggles */}
          <div className="sticky top-0 z-10 bg-white dark:bg-slate-800" data-tour="members-header">
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
              showActionsMenu
              actionsMenuLoading={categorySortLoading || bulkLoading}
              hasArchivedItems={archivedItems.length > 0}
              onCategorySortClick={handleCategorySortClick}
              onExpandAll={handleExpandAll}
              onCollapseAll={handleCollapseAll}
              onDeleteAllArchived={() => setConfirmDeleteArchived(true)}
              onRestoreAllArchived={() => setConfirmRestoreArchived(true)}
              isOwner={list?.owner_id === user?.id}
              categoryNames={categoryNames}
              categoryOrder={categoryOrder}
              onUpdateCategoryNames={updateCategoryNames}
              onUpdateCategoryOrder={updateCategoryOrder}
            />
          </div>

          {/* Active items list */}
          <div className="space-y-2">
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
                <div className="flex-1 h-px bg-gray-300 dark:bg-slate-600" />
                <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">Archived</span>
                <div className="flex-1 h-px bg-gray-300 dark:bg-slate-600" />
              </div>

              {/* Archived items list (no drag) */}
              <div className="space-y-2">
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
            className="px-5 py-2 text-base font-medium text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-slate-600 rounded-lg hover:bg-gray-300"
          >
            Dismiss
          </button>
        </div>
      </Modal>

    </div>
  )
}
