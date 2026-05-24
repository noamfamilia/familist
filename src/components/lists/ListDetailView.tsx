'use client'

/**
 * List **application data** (items, members, prefs) is loaded client-side via `useList` → Dexie
 * + localStorage when the app reports `offline`; no Supabase `get_list_data` runs in that mode.
 *
 * Opened from `/` via Zustand `activeListId` (modal) or from `/list/[id]` for bookmarks. Next may
 * still fetch RSC flight for the shell; list rows are not sourced from that payload — see
 * `useList` / `prefetchListPageForNavigation`.
 */
import { usePathname, useRouter } from 'next/navigation'
import { navigateBackToHome } from '@/lib/navigation/backToHome'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useAuth } from '@/providers/AuthProvider'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { OfflineIcon } from '@/components/icons/OfflineIcon'
import { OutboundQueueIndicator } from '@/components/connectivity/OutboundQueueIndicator'
import { useList, nextListUserSumScope } from '@/hooks/useList'
import { useMenuOpenAnimation } from '@/hooks/useMenuOpenAnimation'
import { useToast } from '@/components/ui/Toast'
import { useHasMounted } from '@/hooks/useHasMounted'
import {
  OFFLINE_ACTIONS_DISABLED_MSG,
  RECOVERING_MUTATIONS_DISABLED_MSG,
  shouldShowConnectivityRelatedMutationToast,
} from '@/lib/mutationToastPolicy'
import {
  getClientBuildId,
  isClientBuildIdKnown,
  setNormalOfflineRouteReadyMarker,
} from '@/lib/offlineRouteReadiness'
import { isLocalDexieNameUniquenessFailure } from '@/lib/data/localListMemberNameUniqueness'
import { inMemoryItemsHaveExactNormalizedText } from '@/lib/data/localItemTextUniqueness'
import { setListMirrorPriorityListId } from '@/lib/data/listMirror'
import { isPwaDebugEnabled } from '@/lib/pwaDebug'

import { Button } from '@/components/ui/Button'
import { SortableItemCard } from '@/components/items/SortableItemCard'
import { ItemCard } from '@/components/items/ItemCard'
import { ListSumRowCard } from '@/components/items/ListSumRowCard'
import { MemberHeader } from '@/components/items/MemberHeader'
import { itemCardRowHeightWithMembersPx, itemNameFontClassForStep } from '@/lib/itemNameFontStep'
import { ShareCardIcon } from '@/components/ui/ShareIcons'
import { LayerMultiIcon } from '@/components/icons/LayerMultiIcon'
import { LayerSingleIcon } from '@/components/icons/LayerSingleIcon'
import type { ItemWithState, ItemCategory, ListUserSumScope } from '@/lib/supabase/types'
import { ITEM_CATEGORIES } from '@/lib/supabase/types'
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

const TutorialTour = dynamic(() => import('@/components/ui/TutorialTour').then(mod => mod.TutorialTour), {
  ssr: false,
})
import { GuestShareSignInModal } from '@/components/auth/GuestShareSignInModal'

const ShareModal = dynamic(() => import('@/components/lists/ShareModal').then(mod => mod.ShareModal), {
  ssr: false,
})

const GOALS_OPTIONS: { value: 'hide' | 'mine' | 'all'; label: string }[] = [
  { value: 'hide', label: 'Hide all Tasks' },
  { value: 'mine', label: 'Show my Tasks' },
  { value: 'all', label: 'Show all Tasks' },
]

// List tour steps — targets use fixed-size wrappers in MemberHeader for accurate spotlights
const listTourSteps: Step[] = [
  {
    target: '[data-tour="share-settings"]',
    content: 'List sharing',
    disableBeacon: true,
    spotlightPadding: 4,
  },
  {
    target: '[data-tour="list-font"]',
    content: 'Font size and width',
    spotlightPadding: 4,
  },
  {
    target: '[data-tour="list-category"]',
    content: 'Categories names and sorting',
    spotlightPadding: 4,
  },
  {
    target: '[data-tour="list-gear"]',
    content: 'Add goals per user and more options',
    spotlightPadding: 4,
  },
]

async function getServiceWorkerDebugInfo() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      href: '',
      origin: '',
      protocol: '',
      hasServiceWorkerApi: false,
      controller: null,
      registrations: [],
    }
  }

  const result: any = {
    href: window.location.href,
    origin: window.location.origin,
    protocol: window.location.protocol,
    hasServiceWorkerApi: 'serviceWorker' in navigator,
    controller: navigator.serviceWorker?.controller
      ? {
          scriptURL: navigator.serviceWorker.controller.scriptURL,
          state: navigator.serviceWorker.controller.state,
        }
      : null,
    registrations: [],
  }

  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations()
    result.registrations = regs.map((reg) => ({
      scope: reg.scope,
      active: reg.active
        ? {
            scriptURL: reg.active.scriptURL,
            state: reg.active.state,
          }
        : null,
      waiting: reg.waiting
        ? {
            scriptURL: reg.waiting.scriptURL,
            state: reg.waiting.state,
          }
        : null,
      installing: reg.installing
        ? {
            scriptURL: reg.installing.scriptURL,
            state: reg.installing.state,
          }
        : null,
      currentUrlWithinScope: window.location.href.startsWith(reg.scope),
    }))
  }

  if (isPwaDebugEnabled()) {
    console.log('SW DEBUG', result)
  }
  return result
}

export type ListDetailSurface = 'page' | 'home_modal'

export interface ListDetailViewProps {
  listId: string
  surface: ListDetailSurface
  /** When `surface === 'home_modal'`, used for “Back” instead of `history.back`. */
  onRequestClose?: () => void
}

export function ListDetailView({ listId, surface, onRequestClose }: ListDetailViewProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading: authLoading, activeActorId, bootstrapUserId, profile, profileFetchPhase, isGuest } =
    useAuth()


  useEffect(() => {
    void setListMirrorPriorityListId(listId)
    return () => {
      void setListMirrorPriorityListId(null)
    }
  }, [listId])

  const { error: showError } = useToast()
  const hasMounted = useHasMounted()
  const { offlineAssetsReady, swControlled, online, isOffline, isRecovering } =
    useConnectivity()
  const {
    list,
    mirroredListUserRow,
    items,
    members,
    listDataStatus,
    sessionMirrorReady,
    loading,
    error,
    accessDenied,
    hasCompletedInitialFetch,
    memberFilter,
    itemTextWidth,
    itemTextWidthMode,
    itemNameFontStep,
    beginDisplayPrefsSession,
    commitDisplayPrefs,
    previewItemNameFontStep,
    categoryNames,
    categoryOrder,
    refresh,
    addItem,
    addItemsBulk,
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
    previewItemTextWidth,
    previewItemTextWidthMode,
    saveCategorySettings,
    categorySettingsMutationPending,
    lastViewedMembers,
    createTargets,
    sumScope,
    updateListUserSumScope,
    isOfflineActionsDisabled,
    allowItemMutationQueue,
  } = useList(listId)

  const listItemsClipboardText = useMemo(() => {
    const active = [...items]
      .filter(i => !i.archived)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    const archived = [...items]
      .filter(i => i.archived)
      .sort((a, b) => {
        const aTime = a.archived_at ? new Date(a.archived_at).getTime() : 0
        const bTime = b.archived_at ? new Date(b.archived_at).getTime() : 0
        return bTime - aTime
      })
    return [...active, ...archived]
      .map(i => i.text.trim())
      .filter(t => t.length > 0)
      .join('\n')
  }, [items])

  const wasOfflineRef = useRef(isOfflineActionsDisabled)
  useEffect(() => {
    if (wasOfflineRef.current && !isOfflineActionsDisabled) {
      void refresh()
    }
    wasOfflineRef.current = isOfflineActionsDisabled
  }, [isOfflineActionsDisabled, refresh])

  // Redirect to home if access is revoked
  useEffect(() => {
    if (accessDenied) {
      showError('You no longer have access to this list')
      router.replace('/')
    }
  }, [accessDenied, router, showError])

  const [showNewMemberAlert, setShowNewMemberAlert] = useState(false)
  const knownMemberIdsRef = useRef<Set<string> | null>(null)
  const normalOfflineMarkerAppliedSigRef = useRef<string>('')

  useEffect(() => {
    normalOfflineMarkerAppliedSigRef.current = ''
  }, [listId])

  useEffect(() => {
    const uid = activeActorId ?? null
    if (!uid) return
    if (typeof window === 'undefined') return
    const onDedicatedListRoute = pathname === `/list/${listId}`
    const onHomeModal = pathname === '/' && surface === 'home_modal'
    if (!onDedicatedListRoute && !onHomeModal) return
    if (!hasCompletedInitialFetch || loading) return
    if (!list || list.id !== listId || accessDenied) return
    if (!swControlled || !offlineAssetsReady) return
    if (!isClientBuildIdKnown()) return

    const markerSig = `${listId}|${uid}|${getClientBuildId()}`
    if (normalOfflineMarkerAppliedSigRef.current === markerSig) return
    normalOfflineMarkerAppliedSigRef.current = markerSig

    setNormalOfflineRouteReadyMarker(uid, listId)
  }, [
    pathname,
    surface,
    listId,
    user?.id,
    bootstrapUserId,
    hasCompletedInitialFetch,
    loading,
    list,
    accessDenied,
    swControlled,
    offlineAssetsReady,
  ])

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
        m =>
          m.created_by !== user.id &&
          new Date(m.server_created_at ?? m.client_created_at) > new Date(lastViewedMembers)
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
  const [addItemBulkMode, setAddItemBulkMode] = useState(false)
  const showAddItemCategoryPicker =
    !addItemBulkMode &&
    !!newItemText.trim() &&
    !inMemoryItemsHaveExactNormalizedText(items, newItemText)
  const addItemCategoryAnim = useMenuOpenAnimation(showAddItemCategoryPicker)
  const newItemTextRef = useRef('')
  newItemTextRef.current = newItemText
  const [hideDone, setHideDone] = useState<Record<string, boolean>>({})
  const [hideNotRelevant, setHideNotRelevant] = useState<Record<string, boolean>>({})
  const [expandSignal, setExpandSignal] = useState(0)
  const [collapseSignal, setCollapseSignal] = useState(0)
  const [confirmDeleteArchived, setConfirmDeleteArchived] = useState(false)
  const [confirmRestoreArchived, setConfirmRestoreArchived] = useState(false)
  const [bulkLoading, setBulkLoading] = useState(false)
  const addItemFormRef = useRef<HTMLFormElement>(null)
  const addItemTextareaRef = useRef<HTMLTextAreaElement>(null)
  /** True when the add-item form was submitted via Enter in the text field (refocus after success). */
  const addItemSubmitFromKeyboardRef = useRef(false)
  const addItemInFlightRef = useRef(false)
  const addItemWrapperRef = useRef<HTMLDivElement>(null)
  const [showShareModal, setShowShareModal] = useState(false)
  const [showGuestShareSignInModal, setShowGuestShareSignInModal] = useState(false)
  const [showWidthBoundaryGuide, setShowWidthBoundaryGuide] = useState(false)
  const widthBoundaryGuideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const shareSettingsOfflineBlocked = !online

  useEffect(() => {
    if (shareSettingsOfflineBlocked && showShareModal) {
      setShowShareModal(false)
    }
  }, [shareSettingsOfflineBlocked, showShareModal])

  const isListOwner =
    mirroredListUserRow?.role === 'owner' ||
    Boolean(list?.owner_id && list.owner_id === activeActorId)

  const hideWidthBoundaryGuide = useCallback(() => {
    if (widthBoundaryGuideTimeoutRef.current) {
      clearTimeout(widthBoundaryGuideTimeoutRef.current)
      widthBoundaryGuideTimeoutRef.current = null
    }
    setShowWidthBoundaryGuide(false)
  }, [])

  const pulseWidthBoundaryGuide = useCallback(() => {
    setShowWidthBoundaryGuide(true)
    if (widthBoundaryGuideTimeoutRef.current) clearTimeout(widthBoundaryGuideTimeoutRef.current)
    widthBoundaryGuideTimeoutRef.current = setTimeout(() => {
      widthBoundaryGuideTimeoutRef.current = null
      setShowWidthBoundaryGuide(false)
    }, 2000)
  }, [])

  useEffect(() => {
    return () => {
      if (widthBoundaryGuideTimeoutRef.current) clearTimeout(widthBoundaryGuideTimeoutRef.current)
    }
  }, [])

  const handleBackToLists = () => {
    if (surface === 'home_modal' && onRequestClose) {
      onRequestClose()
      return
    }
    navigateBackToHome(router)
  }

  const handleWidthChange = (delta: number) => {
    pulseWidthBoundaryGuide()
    if (itemTextWidthMode === 'auto') {
      previewItemTextWidthMode('manual')
    }
    previewItemTextWidth(itemTextWidth + delta)
  }

  const handleWidthModeToggle = () => {
    pulseWidthBoundaryGuide()
    previewItemTextWidthMode('auto')
  }

  const itemNameFontClassName = itemNameFontClassForStep(itemNameFontStep)
  const filterArchivedGapPx = useMemo(
    () => Math.round(itemCardRowHeightWithMembersPx(itemNameFontStep) / 2),
    [itemNameFontStep],
  )

  const [newItemCategory, setNewItemCategory] = useState<ItemCategory>(1)

  /** New list in the URL: reset add-item draft and category picker (sticky category is per visit, per list). */
  useEffect(() => {
    setNewItemText('')
    setNewItemCategory(1)
    setAddItemBulkMode(false)
  }, [listId])

  const clearNewItem = () => {
    setNewItemText('')
  }

  const handleClearAddItemDraftIfTyped = useCallback(() => {
    if (!newItemTextRef.current.trim()) return
    setNewItemText('')
  }, [])

  const blockOnListData =
    listDataStatus !== 'ready' && !list && !error

  const effectiveUserIdForMirror = user?.id ?? null
  const blockUntilSessionMirrorReady =
    !!list &&
    !accessDenied &&
    !!effectiveUserIdForMirror &&
    !sessionMirrorReady

  /** Prefetch leaves the store warm so we should not block first paint on `hasMounted` alone. */
  const mirrorPrimedForPaint = !!list && sessionMirrorReady

  const blockListShell =
    (!hasMounted && !mirrorPrimedForPaint) ||
    (authLoading && !activeActorId) ||
    loading ||
    blockOnListData ||
    blockUntilSessionMirrorReady

  if (blockListShell) {
    return (
      <div
        className="bg-white dark:bg-neutral-800 rounded-none sm:rounded-xl shadow-none sm:shadow-lg dark:shadow-black/40 p-6 sm:p-8 w-full sm:min-w-[300px] sm:w-auto min-h-screen sm:min-h-0 flex items-center justify-center"
        aria-busy="true"
      />
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
                className="text-teal hover:opacity-80 block text-sm sm:text-base"
              >
                ← Back
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-center text-gray-500 dark:text-gray-400">List not found or deleted</p>
            <button
              onClick={handleBackToLists}
              className="mt-4 text-teal hover:opacity-80 block mx-auto text-sm sm:text-base"
            >
              ← Back
            </button>
          </>
        )}
      </div>
    )
  }

  const handleAddItem = async () => {
    if (!newItemText.trim()) {
      addItemSubmitFromKeyboardRef.current = false
      return
    }
    if (addItemInFlightRef.current) {
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
        if (isLocalDexieNameUniquenessFailure(err.message)) {
          setNewItemText(itemText)
        }
        if (
          err.message === OFFLINE_ACTIONS_DISABLED_MSG ||
          err.message === RECOVERING_MUTATIONS_DISABLED_MSG
        ) {
          addItemTextareaRef.current?.blur()
        }
        if (shouldShowConnectivityRelatedMutationToast(err.message)) {
          showError(err.message || 'Failed to add item', { serverError: err })
        }
      }
    } finally {
      addItemInFlightRef.current = false
    }
    const refocus =
      addItemSubmitFromKeyboardRef.current && !err
    addItemSubmitFromKeyboardRef.current = false
    if (refocus) {
      requestAnimationFrame(() => addItemTextareaRef.current?.focus())
    }
  }

  const handleAddMany = async () => {
    const lines = newItemText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
    if (lines.length === 0) return
    if (addItemInFlightRef.current) return

    addItemInFlightRef.current = true
    setNewItemText('')
    let err: { message?: string; code?: string } | null | undefined
    try {
      const result = await addItemsBulk(lines, newItemCategory)
      err = result.error
      if (err) {
        if (isLocalDexieNameUniquenessFailure(err.message)) {
          setNewItemText(lines.join('\n'))
        }
        if (shouldShowConnectivityRelatedMutationToast(err.message)) {
          showError(err.message || 'Failed to add items', { serverError: err })
        }
      }
    } finally {
      addItemInFlightRef.current = false
    }
    const success = !err
    const refocus = addItemSubmitFromKeyboardRef.current && success
    addItemSubmitFromKeyboardRef.current = false
    if (success) {
      setAddItemBulkMode(false)
    }
    if (refocus) {
      requestAnimationFrame(() => addItemTextareaRef.current?.focus())
    }
  }

  const handleAddItemFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (addItemBulkMode) {
      void handleAddMany()
    } else {
      void handleAddItem()
    }
  }

  const searchText = addItemBulkMode ? '' : newItemText.trim().toLowerCase()

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

  const handleExpandAll = () => setExpandSignal(s => s + 1)
  const handleCollapseAll = () => setCollapseSignal(s => s + 1)

  const persistSumScope = async (next: ListUserSumScope) => {
    const { error } = await updateListUserSumScope(next)
    if (error && shouldShowConnectivityRelatedMutationToast(error.message)) {
      showError(error.message || 'Failed to update sum row', { serverError: error })
    }
  }

  const handleDeleteAllArchived = async () => {
    setBulkLoading(true)
    const { error } = await deleteArchivedItems()
    setBulkLoading(false)
    setConfirmDeleteArchived(false)
    if (error && shouldShowConnectivityRelatedMutationToast(error.message)) {
      showError(error.message || 'Failed to delete archived items', { serverError: error })
    }
  }

  const handleRestoreAllArchived = async () => {
    setBulkLoading(true)
    const { error } = await restoreArchivedItems()
    setBulkLoading(false)
    setConfirmRestoreArchived(false)
    if (error && shouldShowConnectivityRelatedMutationToast(error.message)) {
      showError(error.message || 'Failed to restore archived items', { serverError: error })
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    if (isOfflineActionsDisabled) return
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
        if (reorderError && shouldShowConnectivityRelatedMutationToast(reorderError.message)) {
          showError(reorderError.message || 'Failed to reorder items', { serverError: reorderError })
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
      {/* Top bar with back button and member filter */}
      <div className="flex w-full min-w-0 items-center justify-between mb-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={handleBackToLists}
            className="h-8 flex items-center text-teal hover:opacity-80 text-sm sm:text-base"
            aria-label="Go back"
          >
            <span>← Back</span>
          </button>
          <OutboundQueueIndicator />
          {isOffline || isRecovering ? (
            <OfflineIcon
              variant={isOffline ? 'offline' : 'recovering'}
              className="h-8 w-8 shrink-0"
              aria-hidden
            />
          ) : null}
        </div>
        {isListOwner && (
          <div
            data-tour="share-settings"
            className="flex h-10 w-10 shrink-0 items-center justify-center"
          >
            <button
              type="button"
              disabled={shareSettingsOfflineBlocked}
              onClick={() => {
                if (isGuest) {
                  setShowGuestShareSignInModal(true)
                  return
                }
                if (shareSettingsOfflineBlocked) return
                setShowShareModal(true)
              }}
              className={`flex h-10 w-10 items-center justify-center text-teal ${
                shareSettingsOfflineBlocked ? 'cursor-not-allowed opacity-40' : 'hover:opacity-70'
              }`}
              aria-label={
                shareSettingsOfflineBlocked
                  ? isRecovering
                    ? 'Share settings (unavailable while reconnecting)'
                    : 'Share settings (unavailable offline)'
                  : 'Share settings'
              }
            >
              <ShareCardIcon className="w-[30px] h-[30px]" emphasized />
            </button>
          </div>
        )}
      </div>

      {/* Header */}
      <header className="flex items-center justify-center mb-4 sm:mb-6 min-w-0 px-1">
        <h1 className="text-xl sm:text-2xl font-semibold text-teal truncate min-w-0 text-center">
          {list.name}
        </h1>
      </header>

      {/* Add item form */}
      <div ref={addItemWrapperRef} className="relative mb-4 sm:mb-6">
          {addItemCategoryAnim.mounted && (
          <div
            onMouseDown={(e) => e.preventDefault()}
            className={`absolute bottom-full left-0 right-0 z-20 mb-1 origin-bottom overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-neutral-600 dark:bg-neutral-900 dark:shadow-black/40 ${addItemCategoryAnim.menuClassName}`}
          >
            <div className={`p-3 ${ITEM_CATEGORY_STYLES[newItemCategory].shell}`}>
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
                    className={`h-7 px-2 rounded-md touch-manipulation flex items-center justify-center text-xs leading-none overflow-hidden ${ITEM_CATEGORY_STYLES[catId].swatch} ${
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
          )}
        <form ref={addItemFormRef} onSubmit={handleAddItemFormSubmit} className="flex w-full min-w-0 items-start gap-2 sm:gap-3" data-tour="add-item">
          <div className="flex-1 relative">
            <textarea
              ref={addItemTextareaRef}
              value={newItemText}
              onChange={e => setNewItemText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  clearNewItem()
                }
                if (addItemBulkMode) {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    if (!newItemText.trim()) return
                    addItemSubmitFromKeyboardRef.current = true
                    void handleAddMany()
                  }
                } else {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    addItemSubmitFromKeyboardRef.current = true
                    void handleAddItem()
                  }
                }
              }}
              placeholder={addItemBulkMode ? 'Add items\n(one per line)' : 'Add an item...'}
              aria-label={addItemBulkMode ? 'New item names, one per line' : 'New item name'}
              rows={1}
              className={`box-border w-full rounded-lg border border-gray-200 px-4 py-3 pr-14 text-base text-primary focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/20 dark:border-neutral-600 dark:bg-neutral-900 dark:text-gray-100 ${
                addItemBulkMode
                  ? 'min-h-[7.5rem] max-h-[min(70vh,32rem)] resize-y overflow-y-auto'
                  : 'min-h-[3.25rem] max-h-[3.25rem] resize-none overflow-hidden'
              } ${ITEM_CATEGORY_STYLES[newItemCategory].itemName}`}
            />
            <div
              className={`absolute flex items-center gap-0.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 ${
                addItemBulkMode ? 'right-2 top-3' : 'right-2 top-1/2 -translate-y-1/2'
              }`}
            >
              {addItemBulkMode ? (
                <button
                  type="button"
                  onClick={() => {
                    setAddItemBulkMode(false)
                    if (newItemText.trim()) setNewItemText('')
                  }}
                  className="rounded p-0.5 hover:bg-gray-100 dark:hover:bg-neutral-800"
                  aria-label="Single-line add mode"
                  title="Single-line add mode"
                >
                  <LayerSingleIcon className="h-5 w-5" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isOfflineActionsDisabled}
                  onClick={() => setAddItemBulkMode(true)}
                  className={`rounded p-0.5 hover:bg-gray-100 dark:hover:bg-neutral-800 ${isOfflineActionsDisabled ? 'cursor-not-allowed opacity-40' : ''}`}
                  aria-label="Multi-line add mode"
                  title={isOfflineActionsDisabled ? 'Unavailable offline' : 'Add many items (one per line)'}
                >
                  <LayerMultiIcon className="h-5 w-5" />
                </button>
              )}
              {newItemText ? (
                <button
                  type="button"
                  onClick={clearNewItem}
                  className="rounded p-0.5 hover:bg-gray-100 dark:hover:bg-neutral-800"
                  aria-label="Clear input"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </button>
              ) : null}
            </div>
          </div>
          <button
            type="submit"
            disabled={addItemBulkMode ? isOfflineActionsDisabled : false}
            className={`relative shrink-0 font-medium rounded-lg px-6 py-3 text-base disabled:opacity-60 disabled:cursor-not-allowed bg-gradient-to-r from-red-500 to-red-600 text-white hover:shadow-md ${newItemText && !addItemBulkMode ? 'animate-button-nudge' : ''} ${addItemBulkMode && isOfflineActionsDisabled ? 'cursor-not-allowed opacity-40' : ''}`}
          >
            Add
          </button>
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
            noMemberColumns ? 'relative inline-block w-max min-w-full' : 'relative inline-block min-w-full'
          }
        >
          {showWidthBoundaryGuide ? (
            <div
              className="pointer-events-none absolute inset-y-0 z-30 w-px bg-teal/70 shadow-[0_0_4px_rgba(13,148,136,0.55)]"
              style={{ left: itemTextWidth + 30 }}
              aria-hidden
            />
          ) : null}
          {/* Members header with hide done toggles — hidden while add-field filters the list */}
          {!searchText ? (
          <div
            className={`sticky top-0 z-40 bg-white dark:bg-neutral-900${noMemberColumns ? ' block min-w-full w-max' : ''}`}
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
              isOfflineActionsDisabled={isOfflineActionsDisabled}
              showAddMember={memberFilter !== 'hide'}
              itemTextWidth={itemTextWidth}
              itemTextWidthMode={itemTextWidthMode}
              onWidthChange={handleWidthChange}
              onWidthModeToggle={handleWidthModeToggle}
              itemNameFontStep={itemNameFontStep}
              onItemNameFontStepChange={previewItemNameFontStep}
              showActionsMenu
              actionsMenuLoading={categorySettingsMutationPending || bulkLoading}
              categoryEditorSortDisabled={bulkLoading}
              hasArchivedItems={archivedItems.length > 0}
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
              onDisableSumItems={() => void persistSumScope('none')}
              onDisplayControlsOpenChange={(open) => {
                if (open) {
                  beginDisplayPrefsSession()
                } else {
                  hideWidthBoundaryGuide()
                  void commitDisplayPrefs()
                }
              }}
            />
          </div>
          ) : null}

          {/* Active items — min-w-full w-max children so widest row sets column width */}
          <div className={noMemberColumns ? 'flex w-max min-w-full flex-col gap-2' : 'space-y-2'}>
            {!searchText && sumScope !== 'none' && (
              <ListSumRowCard
                sumScope={sumScope}
                items={items}
                members={filteredMembers}
                itemTextWidth={itemTextWidth}
                itemNameFontClassName={itemNameFontClassName}
                itemNameFontStep={itemNameFontStep}
                onCycleScope={() => void persistSumScope(nextListUserSumScope(sumScope))}
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
                      isOfflineActionsDisabled={isOfflineActionsDisabled}
                      allowItemMutationQueue={allowItemMutationQueue}
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

          {/* Archived section — divider when not filtering; half-row gap when filtering */}
          {archivedItems.length > 0 && (
            <>
              {!searchText ? (
                <div className="flex items-center gap-3 my-6">
                  <div className="flex-1 h-px bg-gray-300 dark:bg-neutral-700" />
                  <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">Archived</span>
                  <div className="flex-1 h-px bg-gray-300 dark:bg-neutral-700" />
                </div>
              ) : null}

              {/* Archived items list (no drag) */}
              <div
                className={noMemberColumns ? 'flex w-max min-w-full flex-col gap-2' : 'space-y-2'}
                style={
                  searchText && activeItems.length > 0
                    ? { marginTop: filterArchivedGapPx }
                    : undefined
                }
              >
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
                    isOfflineActionsDisabled={isOfflineActionsDisabled}
                    allowItemMutationQueue={allowItemMutationQueue}
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
        portalToBody
        disableScrollParentFix={false}
        contentKey={listId}
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

      <GuestShareSignInModal
        isOpen={showGuestShareSignInModal}
        onClose={() => setShowGuestShareSignInModal(false)}
      />

      {isListOwner && !isGuest && list && (
        <ShareModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          list={list}
          onUpdate={refresh}
          listItemsAsText={listItemsClipboardText}
        />
      )}
    </div>
  )
}
