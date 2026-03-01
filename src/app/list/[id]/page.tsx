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
import { MemberHeader } from '@/components/items/MemberHeader'

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

  // Redirect to home if access is revoked
  useEffect(() => {
    if (accessDenied) {
      showError('You no longer have access to this list')
      router.push('/')
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
  const [viewMode, setViewMode] = useState<'active' | 'archived'>('active')
  const [newItemText, setNewItemText] = useState('')
  const [adding, setAdding] = useState(false)
  const [hideDone, setHideDone] = useState<Record<string, boolean>>({})

  if (!user) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-6 sm:p-8 w-full sm:min-w-[300px] sm:w-auto">
        <p className="text-center text-gray-500">Please sign in to view this list</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-6 sm:p-8 w-full sm:min-w-[300px] sm:w-auto">
        <div className="flex items-center justify-center py-8">
          <Spinner />
        </div>
      </div>
    )
  }

  if (!list) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-6 sm:p-8 w-full sm:min-w-[300px] sm:w-auto">
        <p className="text-center text-gray-500">List not found or deleted</p>
        <button
          onClick={() => router.push('/')}
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

  const filteredItems = items.filter(item => {
    return viewMode === 'active' ? !item.archived : item.archived
  })

  const toggleHideDone = (memberId: string) => {
    setHideDone(prev => ({
      ...prev,
      [memberId]: !prev[memberId],
    }))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    
    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex(i => i.id === active.id)
      const newIndex = items.findIndex(i => i.id === over.id)
      
      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = [...items]
        const [removed] = reordered.splice(oldIndex, 1)
        reordered.splice(newIndex, 0, removed)
        reorderItems(reordered)
      }
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-lg w-full sm:min-w-[400px] max-w-6xl p-4 sm:p-8">
      {/* Back button */}
      <button
        onClick={() => router.push('/')}
        className="text-primary hover:underline mb-4 block text-sm sm:text-base"
        aria-label="Go back to all lists"
      >
        ← Back to lists
      </button>

      {/* Header */}
      <header className="text-center mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold text-gray-800">{list.name}</h1>
      </header>

      {/* View toggle */}
      <div className="flex justify-center mb-4 sm:mb-6">
        <Toggle
          options={[
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
          ]}
          value={viewMode}
          onChange={(v) => setViewMode(v as 'active' | 'archived')}
        />
      </div>

      {/* Add item form */}
      {viewMode === 'active' && (
        <form onSubmit={handleAddItem} className="flex gap-2 sm:gap-3 mb-4 sm:mb-6">
          <div className="flex-1">
            <Input
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              placeholder="Add an item..."
              disabled={adding}
              aria-label="New item name"
            />
          </div>
          <Button type="submit" loading={adding}>
            Add
          </Button>
        </form>
      )}

      {/* Scrollable container for header + items */}
      <div className="overflow-x-auto overflow-y-auto max-h-[500px]">
        {/* Members header with hide done toggles */}
        <div className="sticky top-0 z-10 bg-white">
          <MemberHeader
            members={members}
            hideDone={hideDone}
            onToggleHideDone={toggleHideDone}
            onAddMember={addMember}
            onUpdateMember={updateMember}
            onDeleteMember={deleteMember}
            listId={listId}
          />
        </div>

        {/* Items list */}
        <div className="space-y-2">
        {filteredItems.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={filteredItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
              {filteredItems.map(item => (
                <SortableItemCard
                  key={item.id}
                  item={item}
                  members={members}
                  hideDone={hideDone}
                  onUpdateItem={updateItem}
                  onDeleteItem={deleteItem}
                  onChangeQuantity={changeQuantity}
                  onUpdateMemberState={updateMemberState}
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          <div className="text-center py-12 text-gray-500 italic">
            {viewMode === 'active'
              ? 'No items yet. Add one above!'
              : 'No archived items.'}
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
