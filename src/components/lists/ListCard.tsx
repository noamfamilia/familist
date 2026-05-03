'use client'

import { useState, useRef, useEffect, useCallback, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useToast } from '@/components/ui/Toast'
import { appendOfflineNavDiagnostic } from '@/lib/offlineNavDiagnostics'
import { LinkEnabledCardIcon } from '@/components/ui/ShareIcons'
import { cachedListDataExists } from '@/lib/cache'
import {
  getClientBuildId,
  getLastOfflineRouteMarkerRecord,
  normalOfflineRouteReady,
} from '@/lib/offlineRouteReadiness'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { useMenuOpenAnimation } from '@/hooks/useMenuOpenAnimation'
import type { ListWithRole } from '@/lib/supabase/types'

function subscribeNavigatorOnline(cb: () => void) {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

function getNavigatorOnlineSnapshot() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}

function getNavigatorOnlineServerSnapshot() {
  return true
}

const ConfirmModal = dynamic(() => import('@/components/ui/ConfirmModal').then(mod => mod.ConfirmModal), {
  ssr: false,
})
const Modal = dynamic(() => import('@/components/ui/Modal').then(mod => mod.Modal), {
  ssr: false,
})
interface ListCardProps {
  list: ListWithRole
  existingListNames: string[]
  onUpdate: (listId: string, updates: { name?: string; archived?: boolean; comment?: string }) => Promise<{ error: Error | null }>
  onDelete: (listId: string) => Promise<{ error: Error | null }>
  onArchive: (listId: string, updates: { archived?: boolean }) => Promise<{ error: Error | null }>
  onDuplicate: (listId: string, newName: string, label?: string) => Promise<{ error: Error | null; warning?: string | null }>
  onLeave: (listId: string) => Promise<{ error: Error | null }>
  dragHandleProps?: Record<string, unknown>
  labels?: string[]
  onUpdateLabel?: (listId: string, label: string) => Promise<{ error: Error | null }>
  onSelectLabel?: (label: string) => void
  currentFilter?: string
  onClearCreateInput?: () => void
  /** Like clearing add-item draft when archiving an item: clear home create field if it had text. */
  onClearCreateInputIfTyped?: () => void
  isOfflineActionsDisabled?: boolean
}

export function ListCard({ list, existingListNames, onUpdate, onDelete, onArchive, onDuplicate, onLeave, dragHandleProps, labels = [], onUpdateLabel, onSelectLabel, currentFilter = 'Any', onClearCreateInput, onClearCreateInputIfTyped, isOfflineActionsDisabled = false }: ListCardProps) {
  const { error: showError } = useToast()
  const router = useRouter()
  const navigatorOnLine = useSyncExternalStore(
    subscribeNavigatorOnline,
    getNavigatorOnlineSnapshot,
    getNavigatorOnlineServerSnapshot,
  )
  const browserOffline = !navigatorOnLine
  const { offlineAssetsReady, swControlled, status: connectivityStatus } = useConnectivity()
  const [menuOpen, setMenuOpen] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [newName, setNewName] = useState(list.name)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
  const [dupName, setDupName] = useState('')
  const [dupLabel, setDupLabel] = useState('')
  const [dupLabelDropdownOpen, setDupLabelDropdownOpen] = useState(false)
  const dupLabelDropdownRef = useRef<HTMLDivElement>(null)
  const [dupAddingLabel, setDupAddingLabel] = useState(false)
  const [dupNewLabelText, setDupNewLabelText] = useState('')
  const dupAddLabelInputRef = useRef<HTMLInputElement>(null)
  const dupAddLabelPopoverRef = useRef<HTMLDivElement>(null)
  const dupNameInputRef = useRef<HTMLInputElement>(null)
  const [comment, setComment] = useState(list.comment || '')
  const [editingComment, setEditingComment] = useState(false)
  const [draftComment, setDraftComment] = useState('')
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const renamePopoverRef = useRef<HTMLDivElement>(null)
  const commentPopoverRef = useRef<HTMLDivElement>(null)
  const [labelDropdownOpen, setLabelDropdownOpen] = useState(false)
  const [addingLabel, setAddingLabel] = useState(false)
  const [newLabelText, setNewLabelText] = useState('')
  const labelDropdownRef = useRef<HTMLDivElement>(null)
  const addLabelInputRef = useRef<HTMLInputElement>(null)
  const addLabelPopoverRef = useRef<HTMLDivElement>(null)
  const offlineListAccessible =
    swControlled &&
    offlineAssetsReady &&
    cachedListDataExists(list.id) &&
    normalOfflineRouteReady(list.id)

  const listKebabMenuAnim = useMenuOpenAnimation(menuOpen)
  const listRenameAnim = useMenuOpenAnimation(isRenaming)
  const listCommentEditAnim = useMenuOpenAnimation(editingComment)
  const listLabelDropdownAnim = useMenuOpenAnimation(labelDropdownOpen)
  const listAddLabelAnim = useMenuOpenAnimation(addingLabel && !labelDropdownOpen)
  const dupLabelDropdownAnim = useMenuOpenAnimation(dupLabelDropdownOpen)
  const dupAddLabelAnim = useMenuOpenAnimation(dupAddingLabel && !dupLabelDropdownOpen)

  // Sync comment state when list updates from realtime
  useEffect(() => {
    setComment(list.comment || '')
  }, [list.comment])

  useEffect(() => {
    if (!labelDropdownOpen) return
    const close = (e: MouseEvent) => {
      if (labelDropdownRef.current && !labelDropdownRef.current.contains(e.target as Node)) {
        e.preventDefault()
        e.stopPropagation()
        document.addEventListener('click', (ce) => { ce.preventDefault(); ce.stopPropagation() }, { capture: true, once: true })
        setLabelDropdownOpen(false)
        setAddingLabel(false)
        setNewLabelText('')
      }
    }
    document.addEventListener('mousedown', close, true)
    return () => document.removeEventListener('mousedown', close, true)
  }, [labelDropdownOpen])

  useEffect(() => {
    if (addingLabel && addLabelInputRef.current) {
      addLabelInputRef.current.focus()
    }
  }, [addingLabel])

  // Outside-click: cancel add-label
  useEffect(() => {
    if (!addingLabel || labelDropdownOpen) return
    const handleMouseDown = (e: MouseEvent) => {
      if (addLabelPopoverRef.current && !addLabelPopoverRef.current.contains(e.target as Node)) {
        e.preventDefault()
        e.stopPropagation()
        document.addEventListener('click', (ce) => { ce.preventDefault(); ce.stopPropagation() }, { capture: true, once: true })
        handleCancelAddLabel()
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true)
    return () => document.removeEventListener('mousedown', handleMouseDown, true)
  })

  const handleAddLabelDone = () => {
    if (isOfflineActionsDisabled) {
      handleCancelAddLabel()
      return
    }
    const trimmed = newLabelText.trim()
    if (trimmed && trimmed.toLowerCase() !== 'any' && onUpdateLabel) {
      void onUpdateLabel(list.id, trimmed)
    }
    setAddingLabel(false)
    setNewLabelText('')
  }

  const handleCancelAddLabel = () => {
    setAddingLabel(false)
    setNewLabelText('')
  }

  const handleOfflineListTitleNav = useCallback(
    async (e: React.MouseEvent<HTMLAnchorElement>) => {
      const native = e.nativeEvent
      const offline = typeof navigator !== 'undefined' ? !navigator.onLine : false
      const hasCachedListData = cachedListDataExists(list.id)
      const routeReady = normalOfflineRouteReady(list.id)
      const lastMarker = getLastOfflineRouteMarkerRecord(list.id)
      const currentBuildId = getClientBuildId()
      const offlineNavAllowed =
        offline &&
        swControlled &&
        offlineAssetsReady &&
        hasCachedListData &&
        routeReady
      const allowed = !offline || offlineNavAllowed
      let reason: string
      if (!offline) {
        reason = 'allowed_online'
      } else if (!swControlled) {
        reason = 'blocked_sw_not_controlled'
      } else if (!offlineAssetsReady) {
        reason = 'blocked_offline_assets_not_ready'
      } else if (!hasCachedListData) {
        reason = 'blocked_list_data_not_cached'
      } else if (!routeReady) {
        reason = 'blocked_route_not_verified_offline'
      } else {
        reason = 'allowed_offline_normal_route_ready'
      }
      const targetHref = `/list/${list.id}`
      const currentPath =
        typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : ''
      const ctrl = typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : undefined

      appendOfflineNavDiagnostic(
        [
          '[list-click] BEFORE',
          `type=${native.type}`,
          `button=${native.button}`,
          `meta=${e.metaKey ? 1 : 0} ctrl=${e.ctrlKey ? 1 : 0} shift=${e.shiftKey ? 1 : 0} alt=${e.altKey ? 1 : 0}`,
          `defaultPrevented(before)=${e.defaultPrevented ? 1 : 0}`,
          `currentPath=${currentPath}`,
          `targetHref=${targetHref}`,
          `offline=${offline ? 1 : 0} swControlled=${swControlled ? 1 : 0} offlineAssetsReady=${offlineAssetsReady ? 1 : 0}`,
          `cachedListDataExists=${hasCachedListData ? 1 : 0} normalOfflineRouteReady=${routeReady ? 1 : 0}`,
          `lastMarkerBuildId=${lastMarker?.buildId ?? 'none'} currentBuildId=${currentBuildId}`,
          `offlineNavAllowed=${offlineNavAllowed ? 1 : 0} reason=${reason} allowed=${allowed ? 1 : 0}`,
          `sw.controller.state=${ctrl?.state ?? 'no-controller'}`,
          ctrl?.scriptURL ? `sw.controller.scriptURL=${ctrl.scriptURL}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )

      if (native.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        appendOfflineNavDiagnostic(
          '[list-click] non-primary or modified click — not intercepting (no preventDefault, default navigation)',
        )
        return
      }

      e.preventDefault()
      appendOfflineNavDiagnostic('[list-click] preventDefault called')

      if (!allowed) {
        appendOfflineNavDiagnostic(`[list-click] blocked — no router.push reason=${reason}`)
        return
      }

      try {
        appendOfflineNavDiagnostic(
          `[list-click] navAction=router_push reason=${reason} targetHref=${targetHref}`,
        )
        appendOfflineNavDiagnostic(`[list-click] router.push calling ${targetHref}`)
        await router.push(targetHref)
        appendOfflineNavDiagnostic('[list-click] router.push promise resolved')
      } catch (err) {
        appendOfflineNavDiagnostic(
          `[list-click] router.push threw: ${err instanceof Error ? err.stack || err.message : String(err)}`,
        )
      }
    },
    [list.id, offlineAssetsReady, router, swControlled],
  )

  // Duplicate modal: outside-click for label dropdown
  useEffect(() => {
    if (!dupLabelDropdownOpen) return
    const close = (e: MouseEvent) => {
      if (dupLabelDropdownRef.current && !dupLabelDropdownRef.current.contains(e.target as Node)) {
        e.preventDefault()
        e.stopPropagation()
        document.addEventListener('click', (ce) => { ce.preventDefault(); ce.stopPropagation() }, { capture: true, once: true })
        setDupLabelDropdownOpen(false)
        setDupAddingLabel(false)
        setDupNewLabelText('')
      }
    }
    document.addEventListener('mousedown', close, true)
    return () => document.removeEventListener('mousedown', close, true)
  }, [dupLabelDropdownOpen])

  useEffect(() => {
    if (dupAddingLabel && dupAddLabelInputRef.current) {
      dupAddLabelInputRef.current.focus()
    }
  }, [dupAddingLabel])

  // Duplicate modal: outside-click cancel add-label popover
  useEffect(() => {
    if (!dupAddingLabel || dupLabelDropdownOpen) return
    const handleMouseDown = (e: MouseEvent) => {
      if (dupAddLabelPopoverRef.current && !dupAddLabelPopoverRef.current.contains(e.target as Node)) {
        e.preventDefault()
        e.stopPropagation()
        document.addEventListener('click', (ce) => { ce.preventDefault(); ce.stopPropagation() }, { capture: true, once: true })
        setDupAddingLabel(false)
        setDupNewLabelText('')
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true)
    return () => document.removeEventListener('mousedown', handleMouseDown, true)
  })

  const handleDupAddLabelDone = () => {
    const trimmed = dupNewLabelText.trim()
    if (trimmed) {
      setDupLabel(trimmed)
    }
    setDupAddingLabel(false)
    setDupNewLabelText('')
  }

  // Focus duplicate name input when modal opens
  useEffect(() => {
    if (showDuplicateModal && dupNameInputRef.current) {
      dupNameInputRef.current.focus()
      dupNameInputRef.current.select()
    }
  }, [showDuplicateModal])

  const autoGrow = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [])

  const isOwner = list.role === 'owner'

  const handleCancelRename = () => {
    setNewName(list.name)
    setIsRenaming(false)
    inputRef.current?.blur()
  }

  const handleClearName = () => {
    setNewName('')
    inputRef.current?.focus()
  }

  const handleStartEditComment = () => {
    if (isOfflineActionsDisabled) return
    setDraftComment(comment)
    setEditingComment(true)
  }

  const handleSaveComment = async () => {
    const trimmed = draftComment.trim()
    setComment(trimmed)
    setEditingComment(false)
    const { error } = await onUpdate(list.id, { comment: trimmed || null })
    if (error) {
      showError('Failed to save comment')
      setComment(list.comment || '')
    }
  }

  const handleCancelComment = () => {
    setDraftComment(comment)
    setEditingComment(false)
  }

  const handleClearComment = () => {
    setDraftComment('')
    if (commentRef.current) {
      commentRef.current.style.height = 'auto'
    }
  }

  useEffect(() => {
    if (!isOfflineActionsDisabled || !editingComment) return
    setDraftComment(comment)
    setEditingComment(false)
  }, [isOfflineActionsDisabled, editingComment, comment])

  useEffect(() => {
    if (!isOfflineActionsDisabled || !isRenaming) return
    setNewName(list.name)
    setIsRenaming(false)
    inputRef.current?.blur()
  }, [isOfflineActionsDisabled, isRenaming, list.name])

  useEffect(() => {
    if (!isOfflineActionsDisabled) return
    setLabelDropdownOpen(false)
    setAddingLabel(false)
    setNewLabelText('')
    setShowDuplicateModal(false)
    setDupLabelDropdownOpen(false)
    setDupAddingLabel(false)
    setDupNewLabelText('')
  }, [isOfflineActionsDisabled])

  // Focus input when renaming
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isRenaming])

  // Outside-click: cancel rename
  useEffect(() => {
    if (!isRenaming) return
    const handleMouseDown = (e: MouseEvent) => {
      if (renamePopoverRef.current && !renamePopoverRef.current.contains(e.target as Node)) {
        e.preventDefault()
        e.stopPropagation()
        document.addEventListener('click', (ce) => { ce.preventDefault(); ce.stopPropagation() }, { capture: true, once: true })
        handleCancelRename()
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true)
    return () => document.removeEventListener('mousedown', handleMouseDown, true)
  })

  // Outside-click: cancel comment
  useEffect(() => {
    if (!editingComment) return
    const handleMouseDown = (e: MouseEvent) => {
      if (commentPopoverRef.current && !commentPopoverRef.current.contains(e.target as Node)) {
        e.preventDefault()
        e.stopPropagation()
        document.addEventListener('click', (ce) => { ce.preventDefault(); ce.stopPropagation() }, { capture: true, once: true })
        handleCancelComment()
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true)
    return () => document.removeEventListener('mousedown', handleMouseDown, true)
  })

  // Focus and auto-grow comment textarea on open
  useEffect(() => {
    if (editingComment && commentRef.current) {
      commentRef.current.focus()
      autoGrow(commentRef.current)
    }
  }, [editingComment, autoGrow])

  const handleArchiveClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isOfflineActionsDisabled) return
    onClearCreateInputIfTyped?.()

    // Toggle archive state
    await onArchive(list.id, { archived: !list.userArchived })
  }

  const handleRename = () => {
    if (isOfflineActionsDisabled) {
      setNewName(list.name)
      setIsRenaming(false)
      return
    }
    if (newName.trim() && newName !== list.name) {
      const trimmed = newName.trim()
      setIsRenaming(false)
      void onUpdate(list.id, { name: trimmed }).then(({ error }) => {
        if (error) {
          showError('Failed to rename list')
          setNewName(list.name)
        }
      })
      return
    }
    setIsRenaming(false)
  }

  const handleDeleteClick = () => {
    if (isOfflineActionsDisabled) {
      return
    }
    setShowDeleteConfirm(true)
  }

  const handleDeleteConfirm = async () => {
    setDeleting(true)
    const { error } = await onDelete(list.id)
    if (error) {
      showError('Failed to delete list')
    }
    setDeleting(false)
    setShowDeleteConfirm(false)
  }

  const openDuplicateModal = () => {
    if (isOfflineActionsDisabled) {
      return
    }
    const existingNamesLower = existingListNames.map(n => n.toLowerCase())
    let name = `${list.name} (copy)`
    let attempt = 1
    const maxAttempts = 20
    while (existingNamesLower.includes(name.toLowerCase()) && attempt < maxAttempts) {
      attempt++
      name = `${list.name} (copy ${attempt})`
    }
    setDupName(name)
    setDupLabel(list.label || '')
    setDupLabelDropdownOpen(false)
    setDupAddingLabel(false)
    setDupNewLabelText('')
    setShowDuplicateModal(true)
  }

  const closeDuplicateModal = () => {
    setShowDuplicateModal(false)
    onClearCreateInput?.()
  }

  const handleDuplicateConfirm = () => {
    if (isOfflineActionsDisabled) return
    if (!dupName.trim()) return
    if (duplicating) return
    setDuplicating(true)
    closeDuplicateModal()
    const isSpecificLabel = dupLabel && dupLabel !== ''
    const filterAfterDuplicate = isSpecificLabel
      ? dupLabel
      : (currentFilter !== 'Any' && currentFilter !== '' ? 'Any' : currentFilter)
    onSelectLabel?.(filterAfterDuplicate ?? 'Any')

    void onDuplicate(list.id, dupName.trim(), dupLabel || undefined).then(({ error, warning }) => {
      if (error) {
        showError('Failed to duplicate list')
      } else if (warning) {
        showError(warning)
      }
      setDuplicating(false)
    })
  }

  const handleLeaveClick = () => {
    if (isOfflineActionsDisabled) {
      return
    }
    setShowLeaveConfirm(true)
  }

  const handleLeaveConfirm = async () => {
    setLeaving(true)
    const { error } = await onLeave(list.id)
    if (error) {
      showError('Failed to leave list')
    }
    setLeaving(false)
    setShowLeaveConfirm(false)
  }

  const ownerBadge = !isOwner && list.ownerNickname ? (
    <span className="ml-1 inline-flex items-center gap-1 align-middle text-xs text-gray-400 dark:text-gray-500">
      <span aria-hidden="true">·</span>
      <bdi dir="auto">{list.ownerNickname}</bdi>
    </span>
  ) : null

  return (
    <>
    {/* Main card content */}
    <div className="group relative rounded-lg bg-gray-50 hover:bg-gray-100 dark:bg-neutral-900 dark:hover:bg-neutral-700">
      {connectivityStatus !== 'online' ? (
        <span
          className={`pointer-events-none absolute end-1.5 top-1.5 z-20 h-[5.6px] w-[5.6px] rounded-full ring-1 ring-black/10 dark:ring-white/15 ${
            offlineListAccessible ? 'bg-green-500' : 'bg-red-500'
          }`}
          role="status"
          aria-label={offlineListAccessible ? 'Openable offline' : 'Not openable offline'}
        />
      ) : null}
      {/* Card row */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3">
      {/* Drag handle - only for active lists */}
      {!list.userArchived && dragHandleProps && (
        <div 
          className="text-gray-400 dark:text-gray-500 cursor-grab select-none text-lg tracking-tighter touch-none"
          {...dragHandleProps}
          data-tour="list-drag-handle"
        >
          ⋮⋮
        </div>
      )}

      {/* Archive/Restore icon */}
      <button
        type="button"
        disabled={isOfflineActionsDisabled}
        onClick={handleArchiveClick}
        className={`text-xl flex-shrink-0 text-coral ${isOfflineActionsDisabled ? 'cursor-not-allowed opacity-40' : 'hover:opacity-70'}`}
        data-tour="list-archive"
      >
        {list.userArchived ? '▲' : '▼'}
      </button>

      {/* List name */}
      <div className="flex-1 min-w-0 relative">
        {list.userArchived ? (
          <span
            className="block font-medium truncate text-lg text-gray-400 dark:text-gray-500 line-through"
            data-tour="list-card"
          >
            {list.name}
            {ownerBadge}
          </span>
        ) : menuOpen && isOwner ? (
          isOfflineActionsDisabled ? (
            <span
              className="flex items-center gap-1 font-medium text-lg text-primary dark:text-gray-100 cursor-default"
              data-tour="list-card"
            >
              <span className="truncate">{list.name}</span>
              {ownerBadge}
            </span>
          ) : (
            <span
              className="flex items-center gap-1 font-medium text-lg text-primary dark:text-gray-100 hover:text-teal cursor-pointer"
              data-tour="list-card"
              onClick={(e) => {
                e.stopPropagation()
                setNewName(list.name)
                setIsRenaming(true)
              }}
            >
              <span className="truncate">{list.name}</span>
              {ownerBadge}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0 opacity-40" aria-hidden>
                <path fillRule="evenodd" clipRule="evenodd" d="M8.56078 20.2501L20.5608 8.25011L15.7501 3.43945L3.75012 15.4395V20.2501H8.56078ZM15.7501 5.56077L18.4395 8.25011L16.5001 10.1895L13.8108 7.50013L15.7501 5.56077ZM12.7501 8.56079L15.4395 11.2501L7.93946 18.7501H5.25012L5.25012 16.0608L12.7501 8.56079Z"/>
              </svg>
            </span>
          )
        ) : browserOffline ? (
          <a
            href={`/list/${list.id}`}
            onClick={(e) => {
              void handleOfflineListTitleNav(e)
            }}
            className="block font-medium truncate text-lg text-primary dark:text-gray-100 hover:text-teal"
            data-tour="list-card"
          >
            {list.name}
            {ownerBadge}
          </a>
        ) : (
          <Link
            href={`/list/${list.id}`}
            className="block font-medium truncate text-lg text-primary dark:text-gray-100 hover:text-teal"
            data-tour="list-card"
          >
            {list.name}
            {ownerBadge}
          </Link>
        )}
        {listRenameAnim.mounted && (
          <div
            ref={renamePopoverRef}
            className={`absolute left-0 top-full mt-1 z-50 bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-600 shadow-lg dark:shadow-black/40 p-2 w-[200px] ${listRenameAnim.menuClassName}`}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleRename()
                if (e.key === 'Escape') handleCancelRename()
              }}
              className="w-full text-center text-lg border border-teal rounded-lg px-2 py-1 mb-2 focus:outline-none focus:ring-2 focus:ring-teal/20"
              aria-label="List name"
              autoFocus
            />
            <div className="flex gap-1.5">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleCancelRename()}
                className="flex-1 px-1 py-1 text-xs text-white rounded bg-gray-400 hover:bg-gray-500"
              >
                Cancel
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void handleRename()}
                className="flex-1 px-1 py-1 text-xs text-white rounded bg-teal hover:opacity-80"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Comment indicator - hidden when expanded */}
      {list.comment && list.comment.trim().length > 0 && !menuOpen && (
        <span className="text-teal text-sm opacity-80">💬</span>
      )}

      {/* Link-enabled indicator — owned lists only; decorative (share settings: list ⋮ menu) */}
      {isOwner && list.visibility === 'link' && (
        <span
          className={`flex-shrink-0 pointer-events-none select-none text-cyan ${list.userArchived ? 'opacity-40' : 'opacity-70'}`}
          aria-label="Link sharing enabled"
        >
          <LinkEnabledCardIcon className="w-5 h-5" />
        </span>
      )}

      {/* Kebab menu button */}
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-1 text-lg leading-none"
        data-tour="list-menu"
      >
        {menuOpen ? '✕' : '⋮'}
      </button>
      </div>

      {/* Expanded menu with comment field and action buttons */}
      {listKebabMenuAnim.mounted && (
        <div className={`space-y-2 rounded-b-lg bg-transparent px-3 py-2 ${listKebabMenuAnim.menuClassName}`}>
          {/* Comment display / editor */}
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            {comment ? (
              <p
                className={`text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words ${isOfflineActionsDisabled ? 'cursor-default' : 'cursor-pointer hover:text-teal'}`}
                onClick={() => handleStartEditComment()}
              >
                {comment}
                {!isOfflineActionsDisabled ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="inline-block ml-1 opacity-40 align-text-bottom" aria-hidden>
                    <path fillRule="evenodd" clipRule="evenodd" d="M8.56078 20.2501L20.5608 8.25011L15.7501 3.43945L3.75012 15.4395V20.2501H8.56078ZM15.7501 5.56077L18.4395 8.25011L16.5001 10.1895L13.8108 7.50013L15.7501 5.56077ZM12.7501 8.56079L15.4395 11.2501L7.93946 18.7501H5.25012L5.25012 16.0608L12.7501 8.56079Z"/>
                  </svg>
                ) : null}
              </p>
            ) : (
              <p
                className={`text-sm text-gray-400 dark:text-gray-500 ${isOfflineActionsDisabled ? 'cursor-default' : 'cursor-pointer hover:text-teal'}`}
                onClick={() => {
                  if (!isOfflineActionsDisabled) handleStartEditComment()
                }}
              >
                Add a comment...
              </p>
            )}
            {listCommentEditAnim.mounted && (
              <div
                ref={commentPopoverRef}
                className={`absolute left-0 right-0 top-0 z-50 bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-600 shadow-lg dark:shadow-black/40 p-2 ${listCommentEditAnim.menuClassName}`}
              >
                <textarea
                  ref={commentRef}
                  rows={1}
                  value={draftComment}
                  onChange={(e) => { setDraftComment(e.target.value); autoGrow(e.target) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') handleCancelComment()
                  }}
                  className="w-full px-3 py-1.5 text-sm border border-teal rounded-lg focus:outline-none focus:ring-2 focus:ring-teal/20 resize-none overflow-hidden mb-2"
                  placeholder="Add a comment..."
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleCancelComment()}
                    className="w-[80px] px-1 py-1 text-xs text-white rounded bg-gray-400 hover:bg-gray-500"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleClearComment()}
                    className="w-[80px] px-1 py-1 text-xs text-white rounded bg-cyan hover:opacity-80"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void handleSaveComment()}
                    className="w-[80px] px-1 py-1 text-xs text-white rounded bg-teal hover:opacity-80"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
          {/* Label selector + action buttons (label left, buttons right, label wraps below if needed) */}
          <div className="flex items-center gap-2 flex-wrap-reverse" onClick={(e) => e.stopPropagation()}>
            {/* Label selector */}
            {onUpdateLabel && (
              <div className="relative" ref={labelDropdownRef}>
                <button
                  type="button"
                  disabled={isOfflineActionsDisabled}
                  onClick={() => {
                    if (isOfflineActionsDisabled) return
                    setLabelDropdownOpen(o => !o)
                    setAddingLabel(false)
                    setNewLabelText('')
                  }}
                  className="text-sm bg-white dark:bg-neutral-900 border border-gray-300 dark:border-neutral-600 rounded-md px-2 py-1 text-gray-700 dark:text-gray-300 focus:outline-none focus:border-teal flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                >
                  <svg className="h-8 w-8 flex-shrink-0 -my-1.5" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                    <path d="M746.5 575.9L579.2 743.6l-173-173.5-53.3-112.4 108.3-108.6 112.2 53.4z" fill="#FBBA22" />
                    <path d="M579.4 389.9l-112.2-53.4c-5.3-2.5-11.6-1.4-15.8 2.7L435 355.7c-85.5-108.1-150.2-83.1-152.9-82-5 2-8.4 6.7-8.8 12.1-4.6 72.2 38.2 118.1 86.8 145l-17 17c-4.2 4.2-5.3 10.5-2.7 15.8L393.7 576c0.7 1.4 1.6 2.8 2.7 3.9l173.1 173.5c5.4 5.4 14.2 5.4 19.7 0l167.3-167.6c2.6-2.6 4.1-6.2 4.1-9.9s-1.5-7.2-4.1-9.9L583.3 392.6c-1.2-1.1-2.5-2-3.9-2.7z m-278.7-91.5c17.3-0.6 58.8 5.9 114 76.6 0.1 0.2 0.3 0.3 0.5 0.5l-34.7 34.8c-38.8-19.1-78.8-53-79.8-111.9z m426.1 277.5L579.2 723.8 417.7 562l-48-101.4 17-17c14 5.8 27.9 10.1 40.7 13.1 1.1 4.7 3.5 9.3 7.2 13a27.22 27.22 0 0 0 38.6 0c10.7-10.7 10.7-28 0-38.7-10.3-10.3-26.6-10.6-37.3-1.1-7.5-1.8-17.1-4.4-27.6-8l55.8-55.9 101.2 48 161.5 161.9z" className="fill-gray-800 dark:fill-gray-200" />
                  </svg>
                  {list.label || <span className="text-gray-400">None</span>}
                  <svg className={`h-3 w-3 ${labelDropdownOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
                {listLabelDropdownAnim.mounted && (
                  <div className={`absolute left-0 mt-1 min-w-[140px] rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 shadow-lg dark:shadow-black/40 z-50 overflow-hidden ${listLabelDropdownAnim.menuClassName}`}>
                    {labels.map(l => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => { void onUpdateLabel(list.id, l); setLabelDropdownOpen(false) }}
                        className={`w-full text-left px-3 py-1.5 text-sm ${
                          list.label === l ? 'bg-teal/10 text-teal font-semibold' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-neutral-800'
                        }`}
                      >
                        {l}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => { void onUpdateLabel(list.id, ''); setLabelDropdownOpen(false) }}
                      className={`w-full text-left px-3 py-1.5 text-sm ${
                        !list.label ? 'bg-teal/10 text-teal font-semibold' : 'text-gray-400 hover:bg-gray-50 dark:hover:bg-neutral-800'
                      }`}
                    >
                      None
                    </button>
                    <button
                      type="button"
                      onClick={() => { setLabelDropdownOpen(false); setAddingLabel(true) }}
                      className="w-full text-left px-3 py-1.5 text-sm text-teal hover:bg-gray-50 dark:hover:bg-neutral-800 border-t border-gray-200 dark:border-neutral-600"
                    >
                      + Add label
                    </button>
                  </div>
                )}
                {listAddLabelAnim.mounted && (
                  <div
                    ref={addLabelPopoverRef}
                    className={`absolute left-0 top-full mt-1 z-50 bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-600 shadow-lg dark:shadow-black/40 p-2 w-[200px] ${listAddLabelAnim.menuClassName}`}
                  >
                    <input
                      ref={addLabelInputRef}
                      type="text"
                      value={newLabelText}
                      onChange={(e) => setNewLabelText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); handleAddLabelDone() }
                        if (e.key === 'Escape') handleCancelAddLabel()
                      }}
                      placeholder="Label name..."
                      className="w-full text-center text-lg border border-teal rounded-lg px-2 py-1 mb-2 focus:outline-none focus:ring-2 focus:ring-teal/20"
                      autoFocus
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleCancelAddLabel()}
                        className="flex-1 px-1 py-1 text-xs text-white rounded bg-gray-400 hover:bg-gray-500"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleAddLabelDone()}
                        className="flex-1 px-1 py-1 text-xs text-white rounded bg-teal hover:opacity-80"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {!list.userArchived && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  openDuplicateModal()
                }}
                className="ml-auto px-3 py-1.5 text-sm text-white rounded-lg hover:opacity-80 bg-cyan"
              >
                Duplicate
              </button>
            )}
            {isOwner ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteClick()
                }}
                className={`${list.userArchived ? 'ml-auto' : ''} px-3 py-1.5 text-sm text-white rounded-lg hover:opacity-80 bg-red-500`}
              >
                Delete
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleLeaveClick()
                }}
                className={`${list.userArchived ? 'ml-auto' : ''} px-3 py-1.5 text-sm text-white rounded-lg hover:opacity-80 bg-red-500`}
              >
                Leave
              </button>
            )}
          </div>
        </div>
      )}
    </div>

    <ConfirmModal
      isOpen={showDeleteConfirm}
      onClose={() => setShowDeleteConfirm(false)}
      onConfirm={handleDeleteConfirm}
      title="Delete List"
      message="Are you sure you want to delete this list? This action cannot be undone."
      confirmText="Delete"
      cancelText="Cancel"
      variant="danger"
      loading={deleting}
    />

    <ConfirmModal
      isOpen={showLeaveConfirm}
      onClose={() => setShowLeaveConfirm(false)}
      onConfirm={handleLeaveConfirm}
      title="Leave List"
      message="Are you sure you want to leave this list? Your members and their data will be removed."
      confirmText="Leave"
      cancelText="Cancel"
      variant="danger"
      loading={leaving}
    />

    <Modal
      isOpen={showDuplicateModal}
      onClose={closeDuplicateModal}
      title="Duplicate list"
      size="sm"
      contentClassName="!overflow-visible"
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
          <input
            ref={dupNameInputRef}
            type="text"
            value={dupName}
            onChange={(e) => setDupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void handleDuplicateConfirm() }
            }}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-neutral-600 rounded-lg focus:outline-none focus:border-teal bg-white dark:bg-neutral-800 text-gray-800 dark:text-gray-200"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Label</label>
          <div className="relative" ref={dupLabelDropdownRef}>
            <button
              type="button"
              onClick={() => { setDupLabelDropdownOpen(o => !o); setDupAddingLabel(false); setDupNewLabelText('') }}
              className="text-sm bg-white dark:bg-neutral-800 border border-gray-300 dark:border-neutral-600 rounded-md px-2 py-1.5 text-gray-700 dark:text-gray-300 focus:outline-none focus:border-teal cursor-pointer flex items-center gap-1 w-full"
            >
              <svg className="h-6 w-6 flex-shrink-0" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                <path d="M746.5 575.9L579.2 743.6l-173-173.5-53.3-112.4 108.3-108.6 112.2 53.4z" fill="#FBBA22" />
                <path d="M579.4 389.9l-112.2-53.4c-5.3-2.5-11.6-1.4-15.8 2.7L435 355.7c-85.5-108.1-150.2-83.1-152.9-82-5 2-8.4 6.7-8.8 12.1-4.6 72.2 38.2 118.1 86.8 145l-17 17c-4.2 4.2-5.3 10.5-2.7 15.8L393.7 576c0.7 1.4 1.6 2.8 2.7 3.9l173.1 173.5c5.4 5.4 14.2 5.4 19.7 0l167.3-167.6c2.6-2.6 4.1-6.2 4.1-9.9s-1.5-7.2-4.1-9.9L583.3 392.6c-1.2-1.1-2.5-2-3.9-2.7z m-278.7-91.5c17.3-0.6 58.8 5.9 114 76.6 0.1 0.2 0.3 0.3 0.5 0.5l-34.7 34.8c-38.8-19.1-78.8-53-79.8-111.9z m426.1 277.5L579.2 723.8 417.7 562l-48-101.4 17-17c14 5.8 27.9 10.1 40.7 13.1 1.1 4.7 3.5 9.3 7.2 13a27.22 27.22 0 0 0 38.6 0c10.7-10.7 10.7-28 0-38.7-10.3-10.3-26.6-10.6-37.3-1.1-7.5-1.8-17.1-4.4-27.6-8l55.8-55.9 101.2 48 161.5 161.9z" className="fill-gray-800 dark:fill-gray-200" />
              </svg>
              {dupLabel || <span className="text-gray-400">None</span>}
              <svg className={`h-3 w-3 ml-auto ${dupLabelDropdownOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
            {dupLabelDropdownAnim.mounted && (
              <div className={`absolute left-0 mt-1 min-w-[140px] w-full rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 shadow-lg dark:shadow-black/40 z-50 overflow-hidden ${dupLabelDropdownAnim.menuClassName}`}>
                {labels.map(l => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => { setDupLabel(l); setDupLabelDropdownOpen(false) }}
                    className={`w-full text-left px-3 py-1.5 text-sm ${
                      dupLabel === l ? 'bg-teal/10 text-teal font-semibold' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-neutral-800'
                    }`}
                  >
                    {l}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { setDupLabel(''); setDupLabelDropdownOpen(false) }}
                  className={`w-full text-left px-3 py-1.5 text-sm ${
                    !dupLabel ? 'bg-teal/10 text-teal font-semibold' : 'text-gray-400 hover:bg-gray-50 dark:hover:bg-neutral-800'
                  }`}
                >
                  None
                </button>
                <button
                  type="button"
                  onClick={() => { setDupLabelDropdownOpen(false); setDupAddingLabel(true) }}
                  className="w-full text-left px-3 py-1.5 text-sm text-teal hover:bg-gray-50 dark:hover:bg-neutral-800 border-t border-gray-200 dark:border-neutral-600"
                >
                  + Add label
                </button>
              </div>
            )}
            {dupAddLabelAnim.mounted && (
              <div
                ref={dupAddLabelPopoverRef}
                className={`absolute left-0 top-full mt-1 z-50 bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-600 shadow-lg dark:shadow-black/40 p-2 w-[200px] ${dupAddLabelAnim.menuClassName}`}
              >
                <input
                  ref={dupAddLabelInputRef}
                  type="text"
                  value={dupNewLabelText}
                  onChange={(e) => setDupNewLabelText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); handleDupAddLabelDone() }
                    if (e.key === 'Escape') { setDupAddingLabel(false); setDupNewLabelText('') }
                  }}
                  placeholder="Label name..."
                  className="w-full text-center text-lg border border-teal rounded-lg px-2 py-1 mb-2 focus:outline-none focus:ring-2 focus:ring-teal/20 bg-white dark:bg-neutral-800 text-gray-800 dark:text-gray-200"
                  autoFocus
                />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setDupAddingLabel(false); setDupNewLabelText('') }}
                    className="flex-1 px-1 py-1 text-xs text-white rounded bg-gray-400 hover:bg-gray-500"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleDupAddLabelDone()}
                    className="flex-1 px-1 py-1 text-xs text-white rounded bg-teal hover:opacity-80"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={closeDuplicateModal}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleDuplicateConfirm()}
            disabled={duplicating || !dupName.trim()}
            className="px-4 py-2 text-sm text-white rounded-lg bg-cyan hover:opacity-80 disabled:opacity-50"
          >
            {duplicating ? 'Duplicating...' : 'OK'}
          </button>
        </div>
      </div>
    </Modal>

  </>
  )
}
