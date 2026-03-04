'use client'

import { useParams, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useAuth } from '@/providers/AuthProvider'
import { useList, ItemWithState } from '@/hooks/useList'
import { useToast } from '@/components/ui/Toast'
import { Toggle } from '@/components/ui/Toggle'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { SortableItemCard } from '@/components/items/SortableItemCard'
import { ItemCard } from '@/components/items/ItemCard'
import { MemberHeader } from '@/components/items/MemberHeader'
import { TutorialTour, hasSeenTutorial } from '@/components/ui/TutorialTour'
import type { Step } from 'react-joyride'

// Intro steps - always shown first
const listIntroSteps: Step[] = [
  {
    target: '[data-tour="add-item"]',
    content: 'Add items to your list here.',
    disableBeacon: true,
  },
  {
    target: '[data-tour="view-toggle"]',
    content: 'Filter to show all members or just the ones you created.',
  },
  {
    target: '[data-tour="add-member"]',
    content: 'Click to add members that are owned by you.',
  },
  {
    target: '[data-tour="members-header"]',
    content: 'A shared list can have multiple members that are owned by different users.',
  },
]

// Item-specific steps - shown when items exist
const listItemSteps: Step[] = [
  {
    target: '[data-tour="item-archive"]',
    content: 'Click the item name to archive it. Click again to restore.',
    disableBeacon: true,
  },
  {
    target: '[data-tour="item-menu"]',
    content: 'Use the menu (⋮) to rename, add a comment, or delete the item.',
  },
]

// Member-specific steps - shown when members exist
const listMemberSteps: Step[] = [
  {
    target: '[data-tour="member-kebab"]',
    content: 'Each member has a menu to rename, toggle visibility filters, and manage privacy settings.',
    disableBeacon: true,
  },
  {
    target: '[data-tour="item-state"]',
    content: 'Each member column shows quantity and done status. Tap quantity to edit directly.',
  },
]

export default function ListPage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const listId = params.id as string
  const { error: showError } = useToast()
  
  const {
    list,
    items,
    members,
    loading,
    accessDenied,
    addItem,
    addMember,
    updateMember,
    deleteMember,
    updateItem,
    deleteItem,
    updateMemberState,
    changeQuantity,
    reorderItems,
  } = useList(listId)

  const [introComplete, setIntroComplete] = useState(false)
  const [itemsComplete, setItemsComplete] = useState(false)

  // Set initial tutorial state after mount to avoid SSR issues
  useEffect(() => {
    setIntroComplete(hasSeenTutorial('list-intro'))
    setItemsComplete(hasSeenTutorial('list-items'))
  }, [])

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
  const [memberFilter, setMemberFilter] = useState<'all' | 'mine'>('all')
  const [newItemText, setNewItemText] = useState('')
  const [adding, setAdding] = useState(false)
  const [hideDone, setHideDone] = useState<Record<string, boolean>>({})
  const [hideNotRelevant, setHideNotRelevant] = useState<Record<string, boolean>>({})

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
        <p className="text-center text-gray-500">List not found or deleted</p>
        <button
          onClick={() => router.replace('/')}
          className="mt-4 text-primary hover:underline block mx-auto"
        >
          ← Back to lists
        </button>
      </div>
    )
  }

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newItemText.trim()) return

    setAdding(true)
    const { error } = await addItem(newItemText.trim())
    if (error) {
      showError(error.message || 'Failed to add item')
    } else {
      setNewItemText('')
    }
    setAdding(false)
  }

  const activeItems = items
    .filter(item => !item.archived)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  
  const archivedItems = items
    .filter(item => item.archived)
    .sort((a, b) => {
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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    
    if (over && active.id !== over.id) {
      const oldIndex = activeItems.findIndex(i => i.id === active.id)
      const newIndex = activeItems.findIndex(i => i.id === over.id)
      
      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = [...activeItems]
        const [removed] = reordered.splice(oldIndex, 1)
        reordered.splice(newIndex, 0, removed)
        reorderItems([...reordered, ...archivedItems])
      }
    }
  }

  return (
    <div className="bg-white rounded-none sm:rounded-xl shadow-none sm:shadow-lg w-full sm:min-w-[400px] max-w-6xl min-h-screen sm:min-h-0 p-4 sm:p-8">
      {/* Top bar with back button and member filter */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => router.replace('/')}
          className="text-primary hover:underline text-sm sm:text-base"
          aria-label="Go back to all lists"
        >
          ← Back to lists
        </button>
        <div data-tour="view-toggle">
          <Toggle
            options={[
              { value: 'all', label: 'All' },
              { value: 'mine', label: 'Mine' },
            ]}
            value={memberFilter}
            onChange={(v) => setMemberFilter(v as 'all' | 'mine')}
          />
        </div>
      </div>

      {/* Header */}
      <header className="text-center mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold text-teal">{list.name}</h1>
      </header>

      {/* Add item form */}
      <form onSubmit={handleAddItem} className="flex gap-2 sm:gap-3 mb-4 sm:mb-6" data-tour="add-item">
          <div className="flex-1">
            <Input
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              placeholder="Add an item..."
              disabled={adding}
              aria-label="New item name"
            />
          </div>
          <Button type="submit" loading={adding} className="bg-red-500 hover:bg-red-600">
            Add
          </Button>
        </form>

      {/* Scrollable container for header + items */}
      <div className="overflow-x-auto overflow-y-auto max-h-[500px]">
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
              showAddMember={memberFilter === 'all'}
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
                    />
                  ))}
                </SortableContext>
              </DndContext>
            ) : (
              <div className="text-center py-8 text-gray-500 italic">
                No items yet. Add one above!
              </div>
            )}
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
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      
      {/* Tutorial - intro steps (always available) */}
      <TutorialTour 
        tourId="list-intro" 
        steps={listIntroSteps} 
        onComplete={() => setIntroComplete(true)}
      />
      
      {/* Tutorial - item-specific steps (only after intro done and items exist) */}
      {items.length > 0 && introComplete && (
        <TutorialTour 
          tourId="list-items" 
          steps={listItemSteps}
          onComplete={() => setItemsComplete(true)}
        />
      )}
      
      {/* Tutorial - member-specific steps (only after items done and members exist) */}
      {members.length > 0 && introComplete && itemsComplete && (
        <TutorialTour tourId="list-members" steps={listMemberSteps} />
      )}
    </div>
  )
}
