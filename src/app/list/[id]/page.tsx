'use client'

import { useParams, useRouter } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useAuth } from '@/providers/AuthProvider'
import { useList } from '@/hooks/useList'
import { useToast } from '@/components/ui/Toast'
import { Toggle } from '@/components/ui/Toggle'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { SortableItemCard } from '@/components/items/SortableItemCard'
import { ItemCard } from '@/components/items/ItemCard'
import { MemberHeader } from '@/components/items/MemberHeader'
import type { ItemWithState } from '@/lib/supabase/types'
import { normalizeItemCategory } from '@/lib/supabase/types'
import type { Step } from 'react-joyride'

function compareItemsByCategoryThenOrder(a: ItemWithState, b: ItemWithState) {
  const ac = normalizeItemCategory(a.category)
  const bc = normalizeItemCategory(b.category)
  if (ac !== bc) return ac - bc
  return (a.sort_order || 0) - (b.sort_order || 0)
}

function compareArchivedByCategoryThenTime(a: ItemWithState, b: ItemWithState) {
  const byCat = compareItemsByCategoryThenOrder(a, b)
  if (byCat !== 0) return byCat
  const aTime = a.archived_at ? new Date(a.archived_at).getTime() : 0
  const bTime = b.archived_at ? new Date(b.archived_at).getTime() : 0
  return bTime - aTime
}

const TutorialTour = dynamic(() => import('@/components/ui/TutorialTour').then(mod => mod.TutorialTour), {
  ssr: false,
})

// All list tour steps - shown progressively as targets become available.
// view-toggle must be before add-item: delayedAdvance jumps add-item -> item-name and skips steps in between.
const listTourSteps: Step[] = [
  {
    target: '[data-tour="view-toggle"]',
    content: 'Show everyone\'s goals or just your own.',
    disableBeacon: true,
  },
  {
    target: '[data-tour="category-sort"]',
    content: 'Sort items by category.',
  },
  {
    target: '[data-tour="add-item"]',
    content: 'Add items to your list',
  },
  {
    target: '[data-tour="item-name"]',
    content: 'Click the item name to archive/restore it.',
  },
  {
    target: '[data-tour="drag-handle"]',
    content: 'Drag to re-arrange items.',
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
    target: '[data-tour="item-text-width"]',
    content: 'Use ◀ and ▶ to give item names more or less space.',
  },
  {
    target: '[data-tour="add-member"]',
    content: 'Set your own goals',
  },
  {
    target: '[data-tour="member-chip"]',
    content: 'Member menu options',
  },
]

export default function ListPage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const listId = params.id as string
  const { error: showError, success: showSuccess } = useToast()
  
  const {
    list,
    items,
    members,
    loading,
    fetchTimedOut,
    saveTimedOut,
    error,
    accessDenied,
    memberFilter,
    itemTextWidth,
    refresh,
    addItem,
    addMember,
    updateMember,
    deleteMember,
    updateItem,
    deleteItem,
    updateMemberState,
    changeQuantity,
    reorderItems,
    updateMemberFilter,
    updateItemTextWidth,
  } = useList(listId)

  // Redirect to home if access is revoked
  useEffect(() => {
    if (accessDenied) {
      showError('You no longer have access to this list')
      router.replace('/')
    }
  }, [accessDenied, router, showError])

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
  const addItemFormRef = useRef<HTMLFormElement>(null)

  const handleBackToLists = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }

    router.replace('/')
  }

  const handleWidthChange = (delta: number) => {
    updateItemTextWidth(itemTextWidth + delta)
  }

  useEffect(() => {
    if (!newItemText) return

    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target || addItemFormRef.current?.contains(target)) return
      setNewItemText('')
    }

    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [newItemText])

  if (!user) {
    return (
      <div className="bg-white rounded-none sm:rounded-xl shadow-none sm:shadow-lg p-6 sm:p-8 w-full sm:min-w-[300px] sm:w-auto min-h-screen sm:min-h-0 flex items-center justify-center">
        <p className="text-center text-gray-500">Please sign in to view this list</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="bg-white rounded-none sm:rounded-xl shadow-none sm:shadow-lg p-6 sm:p-8 w-full sm:min-w-[300px] sm:w-auto min-h-screen sm:min-h-0 flex items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (!list) {
    return (
      <div className="bg-white rounded-none sm:rounded-xl shadow-none sm:shadow-lg p-6 sm:p-8 w-full sm:min-w-[300px] sm:w-auto min-h-screen sm:min-h-0 flex flex-col items-center justify-center">
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
                className="text-primary hover:underline block"
              >
                ← Back to lists
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-center text-gray-500">List not found or deleted</p>
            <button
              onClick={handleBackToLists}
              className="mt-4 text-primary hover:underline block mx-auto"
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
    setAdding(true)
    setNewItemText('')
    const { error } = await addItem(itemText)
    if (error) {
      setNewItemText(itemText)
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
    : members.filter(m => m.created_by === user?.id)

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
    const active = items.filter(i => !i.archived)
    const archived = items.filter(i => i.archived)
    const sortedActive = [...active].sort(compareItemsByCategoryThenOrder)
    const sortedArchived = [...archived].sort(compareArchivedByCategoryThenTime)
    setCategorySortLoading(true)
    const { error: reorderError } = await reorderItems([...sortedActive, ...sortedArchived])
    setCategorySortLoading(false)
    if (reorderError) {
      showError(reorderError.message || 'Failed to sort by category')
    } else {
      showSuccess('Sorted items by category')
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
    <div className="bg-white rounded-none sm:rounded-xl shadow-none sm:shadow-lg w-full sm:min-w-[400px] max-w-3xl min-h-screen sm:min-h-0 px-4 pb-4 pt-6 sm:p-8">
      {/* Timeout message */}
      {(fetchTimedOut || saveTimedOut) && (
        <div className="bg-red-500 text-white px-4 py-3 rounded-lg text-center font-medium mb-4">
          Your changes may not have been saved to the server. Refresh page and try again
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-start justify-between gap-3 mb-4">
          <span className="min-w-0 flex-1">
            <span className="font-medium block">Can&apos;t refresh this list right now.</span>
            <span className="block text-xs text-red-600/90 mt-1.5 break-words font-mono leading-snug">
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
          className="h-8 flex items-center text-primary hover:underline text-sm sm:text-base"
          aria-label="Go back to all lists"
        >
          ← Back to lists
        </button>
        <div data-tour="view-toggle">
          <Toggle
            options={[
              { value: 'all', label: 'All' },
              { value: 'mine', label: 'Owned' },
            ]}
            value={memberFilter}
            onChange={updateMemberFilter}
          />
        </div>
      </div>

      {/* Header */}
      <header className="text-center mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold text-teal">{list.name}</h1>
      </header>

      {/* Add item form */}
      <form ref={addItemFormRef} onSubmit={handleAddItem} className="flex gap-2 sm:gap-3 mb-4 sm:mb-6" data-tour="add-item">
          <div className="flex-1">
            <Input
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setNewItemText('')
                }
              }}
              placeholder="Add an item..."
              disabled={adding}
              aria-label="New item name"
            />
          </div>
          <Button type="submit" loading={adding} className="bg-red-500 hover:bg-red-600">
            Add
          </Button>
        </form>

      {searchText && (
        <p className="text-xs text-gray-400 px-1 -mt-4 mb-4 sm:mb-6">
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
          <div className="sticky top-0 z-10 bg-white" data-tour="members-header">
            <MemberHeader
              members={filteredMembers}
              hideDone={hideDone}
              hideNotRelevant={hideNotRelevant}
              onToggleHideDone={toggleHideDone}
              onToggleHideNotRelevant={toggleHideNotRelevant}
              onAddMember={addMember}
              onUpdateMember={updateMember}
              onDeleteMember={deleteMember}
              listId={listId}
              showAddMember={memberFilter === 'all' && items.length > 0}
              itemTextWidth={itemTextWidth}
              onWidthChange={handleWidthChange}
              showCategorySort={items.length > 0}
              categorySortLoading={categorySortLoading}
              onCategorySortClick={handleCategorySortClick}
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
                    />
                  ))}
                </SortableContext>
              </DndContext>
            ) : items.length === 0 ? (
              <div className="text-center py-8 text-gray-500 italic">
                No items yet. Add one above!
              </div>
            ) : null}
          </div>

          {/* Archived section separator */}
          {archivedItems.length > 0 && (
            <>
              <div className="flex items-center gap-3 my-6">
                <div className="flex-1 h-px bg-gray-300" />
                <span className="text-sm text-gray-500 font-medium">Archived</span>
                <div className="flex-1 h-px bg-gray-300" />
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
    </div>
  )
}
