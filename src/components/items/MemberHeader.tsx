'use client'

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { useAuth } from '@/providers/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { shouldShowConnectivityRelatedMutationToast } from '@/lib/mutationToastPolicy'
import type { CategoryNames, Member, MemberWithCreator } from '@/lib/supabase/types'
import { GearIcon } from '@/components/icons/GearIcon'
import { FilterIcon } from '@/components/icons/FilterIcon'
import { AddIcon } from '@/components/icons/AddIcon'
import { FontSizeIcon } from '@/components/icons/FontSizeIcon'
import {
  ITEM_NAME_FONT_MAX,
  ITEM_NAME_FONT_MIN,
  ITEM_NAME_FONT_DEFAULT,
} from '@/lib/itemNameFontStep'
import { ITEM_TEXT_WIDTH_MIN } from '@/lib/itemTextWidthFit'
import { useMenuOpenAnimation } from '@/hooks/useMenuOpenAnimation'

const CategoryNamesModal = dynamic(() => import('@/components/lists/CategoryNamesModal').then(mod => mod.CategoryNamesModal), {
  ssr: false,
})

const ConfirmModal = dynamic(() => import('@/components/ui/ConfirmModal').then(mod => mod.ConfirmModal), {
  ssr: false,
})

const Modal = dynamic(() => import('@/components/ui/Modal').then(mod => mod.Modal), {
  ssr: false,
})

function isFontSizePlusKey(e: KeyboardEvent): boolean {
  return e.key === '+' || e.code === 'NumpadAdd' || (e.key === '=' && e.shiftKey)
}

function isFontSizeMinusKey(e: KeyboardEvent): boolean {
  return e.key === '-' || e.code === 'NumpadSubtract'
}

interface MemberHeaderProps {
  members: MemberWithCreator[]
  allMembers: MemberWithCreator[]
  hideDone: Record<string, boolean>
  hideNotRelevant: Record<string, boolean>
  onToggleHideDone: (memberId: string) => void
  onToggleHideNotRelevant: (memberId: string) => void
  onAddMember: (name: string, creatorNickname?: string) => Promise<{ error?: { message?: string } | null }>
  onUpdateMember: (memberId: string, updates: Partial<MemberWithCreator>) => Promise<{ error?: { message: string } | null }>
  onDeleteMember: (memberId: string) => Promise<{ error?: { message: string } | null }>
  onOwnMember?: (memberId: string, creatorNickname?: string) => Promise<{ error?: { message: string } | null; newMemberId?: string }>
  listId: string
  showAddMember?: boolean
  itemTextWidth?: number
  itemTextWidthMode?: 'auto' | 'manual'
  onWidthChange?: (delta: number) => void
  onWidthModeToggle?: () => void
  itemNameFontStep?: number
  onItemNameFontStepChange?: (step: number) => void
  showActionsMenu?: boolean
  actionsMenuLoading?: boolean
  hasArchivedItems?: boolean
  onCategorySortClick?: () => void | Promise<void>
  onExpandAll?: () => void
  onCollapseAll?: () => void
  onDeleteAllArchived?: () => void
  onRestoreAllArchived?: () => void
  isOwner?: boolean
  categoryNames?: CategoryNames
  categoryOrder?: number[]
  onSaveCategorySettings?: (names: CategoryNames, order: number[]) => Promise<{ error: unknown }>
  hasTargetMember?: boolean
  onCreateTargets?: () => void
  /** When `'none'`, the sum row is hidden and "Sum items" may be shown in the gear menu. */
  sumScope?: 'none' | 'all' | 'active' | 'archived'
  onEnableSumItems?: () => void
  /** Offline / recovering: add-member control is dimmed and disabled. */
  isOfflineActionsDisabled?: boolean
}

export function MemberHeader({
  members,
  allMembers,
  hideDone,
  hideNotRelevant,
  onToggleHideDone,
  onToggleHideNotRelevant,
  onAddMember,
  onUpdateMember,
  onDeleteMember,
  onOwnMember,
  listId,
  showAddMember = true,
  itemTextWidth = 80,
  itemTextWidthMode = 'auto',
  onWidthChange,
  onWidthModeToggle,
  itemNameFontStep = ITEM_NAME_FONT_DEFAULT,
  onItemNameFontStepChange,
  showActionsMenu = false,
  actionsMenuLoading = false,
  hasArchivedItems = false,
  onCategorySortClick,
  onExpandAll,
  onCollapseAll,
  onDeleteAllArchived,
  onRestoreAllArchived,
  isOwner = false,
  categoryNames,
  categoryOrder,
  onSaveCategorySettings,
  hasTargetMember = false,
  onCreateTargets,
  sumScope = 'none',
  onEnableSumItems,
  isOfflineActionsDisabled = false,
}: MemberHeaderProps) {
  const { user, profile } = useAuth()
  const { error: showError } = useToast()

  const suggestedName = useMemo(() => {
    const base = profile?.nickname?.trim()
    if (!base) return ''
    const names = new Set(allMembers.map(m => m.name))
    if (!names.has(base)) return base
    let i = 2
    while (names.has(`${base}${i}`)) i++
    return `${base}${i}`
  }, [profile?.nickname, allMembers])

  const [isAdding, setIsAdding] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [actionsMenuPos, setActionsMenuPos] = useState<{ top: number; right: number } | null>(null)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const actionsMenuRef = useRef<HTMLDivElement>(null)
  const actionsButtonRef = useRef<HTMLButtonElement>(null)

  const closeActions = () => {
    setActionsOpen(false)
    setActionsMenuPos(null)
  }

  const handleToggleActions = () => {
    if (actionsOpen) {
      closeActions()
    } else {
      if (actionsButtonRef.current) {
        const rect = actionsButtonRef.current.getBoundingClientRect()
        setActionsMenuPos({
          top: rect.bottom + 4,
          right: window.innerWidth - rect.right,
        })
      }
      setActionsOpen(true)
    }
  }

  useEffect(() => {
    if (!actionsOpen) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeActions()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [actionsOpen])

  const [newMemberName, setNewMemberName] = useState('')
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; memberId: string | null; memberName: string }>({
    open: false,
    memberId: null,
    memberName: '',
  })
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [ownConfirm, setOwnConfirm] = useState<{ open: boolean; memberId: string | null; memberName: string }>({
    open: false,
    memberId: null,
    memberName: '',
  })
  const [ownLoading, setOwnLoading] = useState(false)

  const closeMemberMenu = useCallback(() => {
    setOpenMenuId(null)
    setMemberMenuPos(null)
  }, [])

  const handleAddMember = async () => {
    if (isOfflineActionsDisabled) return
    const fallbackName = suggestedName
    const nameToAdd = newMemberName.trim() || fallbackName
    if (!nameToAdd) {
      setNewMemberName('')
      setIsAdding(false)
      return
    }
    
    const nameExists = members.some(m => !m.is_target && m.name.toLowerCase() === nameToAdd.toLowerCase())
    if (nameExists) {
      showError(`Member "${nameToAdd}" already exists`)
      return
    }
    
    setNewMemberName('')
    setIsAdding(false)
    const { error } = await onAddMember(nameToAdd, profile?.nickname || undefined)
    if (error) {
      setNewMemberName(nameToAdd)
      setIsAdding(true)
      if (shouldShowConnectivityRelatedMutationToast(error.message)) {
        showError(error.message || 'Failed to add member')
      }
      return
    }
  }

  const handleCancelAddMember = () => {
    setNewMemberName('')
    setIsAdding(false)
    setAddMemberPopoverPos(null)
  }

  useEffect(() => {
    if (!isOfflineActionsDisabled) return
    if (isAdding) handleCancelAddMember()
  }, [isOfflineActionsDisabled, isAdding])

  const handleCancelEdit = useCallback(() => {
    let clearedId: string | null = null
    setEditingMemberId(prev => {
      clearedId = prev
      return null
    })
    setEditName('')
    setRenamePopoverPos(null)
    if (clearedId != null) {
      setOpenMenuId(prev => (prev === clearedId ? null : prev))
    }
  }, [])

  const handleStartEdit = (member: Member) => {
    closeMemberMenu()
    setEditingMemberId(member.id)
    setEditName(member.name)
    requestAnimationFrame(() => {
      const chipEl = chipRefsMap.current.get(member.id)
      if (!chipEl) return
      const EDGE_GUARD = 12
      const chipRect = chipEl.getBoundingClientRect()
      const top = chipRect.bottom + 4
      const vw = window.innerWidth
      if (chipRect.left + RENAME_WIDTH + EDGE_GUARD <= vw && chipRect.left >= EDGE_GUARD) {
        setRenamePopoverPos({ top, left: chipRect.left })
      } else {
        const centerLeft = chipRect.left + chipRect.width / 2 - RENAME_WIDTH / 2
        if (centerLeft >= EDGE_GUARD && centerLeft + RENAME_WIDTH + EDGE_GUARD <= vw) {
          setRenamePopoverPos({ top, left: centerLeft })
        } else {
          setRenamePopoverPos({ top, left: Math.max(EDGE_GUARD, Math.min(chipRect.left, vw - RENAME_WIDTH - EDGE_GUARD)) })
        }
      }
    })
  }

  const handleSaveEdit = () => {
    if (!editingMemberId || !editName.trim()) {
      handleCancelEdit()
      return
    }
    const memberId = editingMemberId
    const trimmedName = editName.trim()

    const nameExists = members.some(
      m => !m.is_target && m.id !== memberId && m.name.toLowerCase() === trimmedName.toLowerCase(),
    )
    if (nameExists) {
      showError(`Member "${trimmedName}" already exists`)
      const originalMember = members.find(m => m.id === memberId)
      setEditName(originalMember?.name || '')
      return
    }

    handleCancelEdit()
    void onUpdateMember(memberId, { name: trimmedName }).then(({ error }) => {
      if (error && shouldShowConnectivityRelatedMutationToast(error.message)) {
        showError(error.message || 'Failed to update member')
      }
    })
  }

  const handleDeleteClick = (member: Member) => {
    closeMemberMenu()
    setDeleteConfirm({ open: true, memberId: member.id, memberName: member.name })
  }

  const handleConfirmDelete = async () => {
    if (!deleteConfirm.memberId) return
    
    setDeleteLoading(true)
    const { error } = await onDeleteMember(deleteConfirm.memberId)
    setDeleteLoading(false)
    
    if (error && shouldShowConnectivityRelatedMutationToast(error.message)) {
      showError(error.message || 'Failed to delete member')
    }
    setDeleteConfirm({ open: false, memberId: null, memberName: '' })
  }

  const handleTogglePublic = async (member: MemberWithCreator) => {
    closeMemberMenu()
    const { error } = await onUpdateMember(member.id, { is_public: !member.is_public })
    if (error && shouldShowConnectivityRelatedMutationToast(error.message)) {
      showError(error.message || 'Failed to update member')
    }
  }

  const handleOwnClick = (member: MemberWithCreator) => {
    closeMemberMenu()
    setOwnConfirm({ open: true, memberId: member.id, memberName: member.name })
  }

  const handleConfirmOwn = async () => {
    if (!ownConfirm.memberId || !onOwnMember) return
    setOwnLoading(true)
    const { error, newMemberId } = await onOwnMember(ownConfirm.memberId, profile?.nickname || undefined)
    setOwnLoading(false)
    if (error && shouldShowConnectivityRelatedMutationToast(error.message)) {
      showError(error.message || 'Failed to take ownership')
    }
    setOwnConfirm({ open: false, memberId: null, memberName: '' })
  }

  const openMember = openMenuId ? members.find(m => m.id === openMenuId) : null
  const lastOpenMemberRef = useRef(openMember)
  if (openMember) lastOpenMemberRef.current = openMember
  const memberMenuDisplayMember = openMember ?? lastOpenMemberRef.current

  const memberMenuRef = useRef<HTMLDivElement>(null)
  const headerCardRef = useRef<HTMLDivElement>(null)
  const chipRefsMap = useRef<Map<string, HTMLDivElement>>(new Map())
  const [memberMenuPos, setMemberMenuPos] = useState<{ top: number; left?: number; right?: number } | null>(null)
  const [renamePopoverPos, setRenamePopoverPos] = useState<{ top: number; left: number } | null>(null)
  const [addMemberPopoverPos, setAddMemberPopoverPos] = useState<{ top: number; left: number } | null>(null)
  const renamePopoverRef = useRef<HTMLDivElement>(null)
  const addMemberPopoverRef = useRef<HTMLDivElement>(null)
  const addMemberContainerRef = useRef<HTMLDivElement>(null)
  const itemNameFontBtnRef = useRef<HTMLButtonElement>(null)
  const itemNameFontPopoverRef = useRef<HTMLDivElement>(null)
  const [itemNameFontOpen, setItemNameFontOpen] = useState(false)
  const [itemNameFontPos, setItemNameFontPos] = useState<{ top: number; left: number } | null>(null)

  const renamePopoverPosStableRef = useRef(renamePopoverPos)
  if (renamePopoverPos) renamePopoverPosStableRef.current = renamePopoverPos
  const renameMemberMenuAnim = useMenuOpenAnimation(!!editingMemberId && !!renamePopoverPos)

  const addMemberPopoverPosStableRef = useRef(addMemberPopoverPos)
  if (addMemberPopoverPos) addMemberPopoverPosStableRef.current = addMemberPopoverPos
  const addMemberMenuAnim = useMenuOpenAnimation(isAdding && !!addMemberPopoverPos)

  const actionsMenuPosStableRef = useRef(actionsMenuPos)
  if (actionsMenuPos) actionsMenuPosStableRef.current = actionsMenuPos
  const actionsMenuAnim = useMenuOpenAnimation(actionsOpen && !!actionsMenuPos)

  const memberMenuPosStableRef = useRef(memberMenuPos)
  if (memberMenuPos) memberMenuPosStableRef.current = memberMenuPos
  const memberFloatingMenuAnim = useMenuOpenAnimation(!!openMenuId && !!memberMenuPos && !editingMemberId)

  const itemNameFontPosStableRef = useRef(itemNameFontPos)
  if (itemNameFontPos) itemNameFontPosStableRef.current = itemNameFontPos
  const itemNameFontMenuAnim = useMenuOpenAnimation(itemNameFontOpen && !!itemNameFontPos)

  const MENU_WIDTH = 224 // w-56
  const RENAME_WIDTH = 160

  const computeMenuPos = useCallback((chipEl: HTMLDivElement) => {
    const EDGE_GUARD = 12
    const chipRect = chipEl.getBoundingClientRect()
    const top = chipRect.bottom + 4
    const vw = window.innerWidth

    // Prefer left-aligned with chip
    if (chipRect.left + MENU_WIDTH + EDGE_GUARD <= vw && chipRect.left >= EDGE_GUARD) {
      setMemberMenuPos({ top, left: chipRect.left })
    // Then try centering under chip
    } else {
      const centerLeft = chipRect.left + chipRect.width / 2 - MENU_WIDTH / 2
      if (centerLeft >= EDGE_GUARD && centerLeft + MENU_WIDTH + EDGE_GUARD <= vw) {
        setMemberMenuPos({ top, left: centerLeft })
      // Then right-aligned with chip
      } else if (chipRect.right - MENU_WIDTH >= EDGE_GUARD) {
        setMemberMenuPos({ top, right: vw - chipRect.right })
      // Fallback: clamp to screen edges
      } else {
        const clampedLeft = Math.max(EDGE_GUARD, Math.min(chipRect.left, vw - MENU_WIDTH - EDGE_GUARD))
        setMemberMenuPos({ top, left: clampedLeft })
      }
    }
  }, [])

  const handleChipClick = useCallback((memberId: string) => {
    if (openMenuId === memberId) {
      closeMemberMenu()
      return
    }
    setEditingMemberId(null)
    setEditName('')
    setOpenMenuId(memberId)
    const chipEl = chipRefsMap.current.get(memberId)
    if (chipEl) computeMenuPos(chipEl)
  }, [openMenuId, computeMenuPos, closeMemberMenu])

  const handleItemNameFontButtonClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!onItemNameFontStepChange) return
      if (itemNameFontOpen) {
        setItemNameFontOpen(false)
        setItemNameFontPos(null)
        return
      }
      requestAnimationFrame(() => {
        const el = itemNameFontBtnRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const vw = window.innerWidth
        const popoverWidth = 220
        const left = Math.min(Math.max(8, r.left), vw - popoverWidth - 8)
        setItemNameFontPos({ top: r.bottom + 6, left })
        setItemNameFontOpen(true)
      })
    },
    [itemNameFontOpen, onItemNameFontStepChange],
  )

  const handleFontBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (!onItemNameFontStepChange) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const ratio = rect.width <= 0 ? 0 : Math.min(1, Math.max(0, x / rect.width))
    const step = Math.round(ratio * ITEM_NAME_FONT_MAX)
    onItemNameFontStepChange(step)
  }

  // Escape to close member menu / rename / add member
  useEffect(() => {
    if (!openMenuId && !isAdding) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingMemberId) {
          handleCancelEdit()
        } else if (isAdding) {
          handleCancelAddMember()
        } else {
          closeMemberMenu()
        }
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [openMenuId, closeMemberMenu, editingMemberId, isAdding, handleCancelEdit])

  // Block mouseup/click after we intercepted a mousedown outside header
  const blockNextClickRef = useRef(false)

  useEffect(() => {
    const blockEvent = (e: MouseEvent) => {
      if (blockNextClickRef.current) {
        e.preventDefault()
        e.stopPropagation()
        if (e.type === 'click') blockNextClickRef.current = false
      }
    }
    document.addEventListener('mouseup', blockEvent, true)
    document.addEventListener('click', blockEvent, true)
    return () => {
      document.removeEventListener('mouseup', blockEvent, true)
      document.removeEventListener('click', blockEvent, true)
    }
  }, [])

  // Unified outside-click: clicks inside header area are allowed, clicks outside close popups and are blocked
  useEffect(() => {
    const anyOpen = !!openMenuId || isAdding || actionsOpen || itemNameFontOpen
    if (!anyOpen) return

    const isInsideFloating = (target: Node) => {
      const fontFloating =
        itemNameFontOpen &&
        (itemNameFontPopoverRef.current?.contains(target) || itemNameFontBtnRef.current?.contains(target))
      return (
        fontFloating ||
        memberMenuRef.current?.contains(target) ||
        actionsMenuRef.current?.contains(target) ||
        renamePopoverRef.current?.contains(target) ||
        addMemberPopoverRef.current?.contains(target)
      )
    }

    const closeAll = () => {
      if (editingMemberId) handleCancelEdit()
      else if (isAdding) handleCancelAddMember()
      else if (openMenuId) { closeMemberMenu(); setEditingMemberId(null); setEditName('') }
      else if (actionsOpen) closeActions()
    }

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node

      if (itemNameFontOpen) {
        if (itemNameFontPopoverRef.current?.contains(target) || itemNameFontBtnRef.current?.contains(target)) {
          return
        }
        e.preventDefault()
        e.stopPropagation()
        blockNextClickRef.current = true
        setItemNameFontOpen(false)
        setItemNameFontPos(null)
        return
      }

      // Inside floating menus — let through entirely
      if (isInsideFloating(target)) return

      // Always block the click from reaching other elements when closing an editor
      e.preventDefault()
      e.stopPropagation()
      blockNextClickRef.current = true
      closeAll()
    }

    document.addEventListener('mousedown', handleMouseDown, true)
    return () => document.removeEventListener('mousedown', handleMouseDown, true)
  }, [openMenuId, isAdding, actionsOpen, itemNameFontOpen, editingMemberId, closeMemberMenu, handleCancelEdit])

  useEffect(() => {
    if (!itemNameFontOpen || !onItemNameFontStepChange) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (isFontSizePlusKey(e)) {
        e.preventDefault()
        onItemNameFontStepChange(Math.min(ITEM_NAME_FONT_MAX, itemNameFontStep + 1))
        return
      }
      if (isFontSizeMinusKey(e)) {
        e.preventDefault()
        onItemNameFontStepChange(Math.max(ITEM_NAME_FONT_MIN, itemNameFontStep - 1))
        return
      }
      e.preventDefault()
      setItemNameFontOpen(false)
      setItemNameFontPos(null)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [itemNameFontOpen, itemNameFontStep, onItemNameFontStepChange])

  useEffect(() => {
    if (!itemNameFontOpen) return
    const id = requestAnimationFrame(() => itemNameFontPopoverRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [itemNameFontOpen])

  // With member chips, keep the name column aligned with item rows. With none, only the ◀ Auto ▶ band is needed.
  const headerItemNameSlotWidthPx = members.length > 0 ? itemTextWidth : ITEM_TEXT_WIDTH_MIN

  return (
    <div className={members.length > 0 ? 'mb-3 min-w-full w-max' : 'mb-3 block min-w-full w-max'}>
      {/* Header card container */}
      <div ref={headerCardRef} className="bg-gray-50 dark:bg-neutral-900 rounded-lg">
        {/* Header row - matching item card styling */}
        <div className="relative flex items-center gap-0.5 pl-2 pr-1 py-1 whitespace-nowrap">
          <div className="flex h-[40px] w-5 flex-shrink-0 items-center justify-center">
            {onItemNameFontStepChange && (
              <button
                ref={itemNameFontBtnRef}
                type="button"
                onClick={handleItemNameFontButtonClick}
                className="flex h-8 w-8 items-center justify-center rounded p-0 text-teal touch-manipulation hover:opacity-80"
                aria-label="Item name font size"
                aria-expanded={itemNameFontOpen}
              >
                <FontSizeIcon className="h-5 w-5" />
              </button>
            )}
          </div>
          <div className="relative h-[40px] flex-shrink-0" style={{ width: headerItemNameSlotWidthPx }}>
            <div
              className="absolute inset-y-0 left-0 box-border flex w-[80px] shrink-0 items-center justify-between pl-2.5"
              data-tour="item-text-width"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onWidthChange?.(-20)
                }}
                disabled={itemTextWidth <= 80}
                className={`h-[32px] flex items-center touch-manipulation disabled:opacity-30 text-sm ${
                  itemTextWidthMode === 'manual' ? 'text-teal' : 'text-gray-400 dark:text-gray-500 hover:text-teal'
                }`}
                aria-label="Narrow item name column"
              >
                ◀
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onWidthModeToggle?.()
                }}
                className={`text-[11px] font-medium leading-none touch-manipulation select-none ${
                  itemTextWidthMode === 'auto' ? 'text-teal' : 'text-gray-400 dark:text-gray-500 hover:text-teal'
                }`}
              >
                Auto
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onWidthChange?.(20)
                }}
                className={`h-[32px] flex items-center touch-manipulation disabled:opacity-30 text-sm ${
                  itemTextWidthMode === 'manual' ? 'text-teal' : 'text-gray-400 dark:text-gray-500 hover:text-teal'
                }`}
                aria-label="Widen item name column"
              >
                ▶
              </button>
            </div>
          </div>
          
          {/* Members section */}
          <div className="flex items-center ml-2.5 flex-shrink-0 gap-2.5">
            {members.map(member => {
              const isMenuOpen = openMenuId === member.id
              const isRenaming = editingMemberId === member.id
              const isMemberOwner = member.created_by === user?.id
              const canEdit = isMemberOwner || member.is_public
              
              return (
                <div key={member.id} className="relative">
                  <div
                    ref={(el) => { if (el) chipRefsMap.current.set(member.id, el); else chipRefsMap.current.delete(member.id) }}
                    className={`relative flex items-center justify-center px-2 py-1 rounded-lg border w-[90px] h-[40px] ${
                      isMenuOpen
                        ? 'bg-cyan border-cyan text-white'
                        : 'bg-white dark:bg-neutral-900 border-gray-200 dark:border-neutral-600'
                    } ${!canEdit && !isMenuOpen ? 'opacity-50' : ''} ${!isRenaming ? 'cursor-pointer' : ''}`}
                    data-tour="member-chip"
                    onClick={() => {
                      if (!isRenaming) handleChipClick(member.id)
                    }}
                  >
                    {hideDone[member.id] && hideNotRelevant[member.id] && (
                      <FilterIcon className={`flex-shrink-0 ${isMenuOpen ? 'text-white' : 'text-cyan'}`} />
                    )}
                    <span className="text-lg truncate flex-1 text-center">
                      {member.name}
                    </span>
                  </div>
                  {/* Rename popover */}
                  {renameMemberMenuAnim.mounted && (renamePopoverPos ?? renamePopoverPosStableRef.current) && (
                    <div
                      ref={renamePopoverRef}
                      className={`fixed z-50 w-[200px] rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-neutral-600 dark:bg-neutral-900 dark:shadow-black/40 ${renameMemberMenuAnim.menuClassName}`}
                      style={{
                        top: (renamePopoverPos ?? renamePopoverPosStableRef.current)!.top,
                        left: (renamePopoverPos ?? renamePopoverPosStableRef.current)!.left,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleSaveEdit()
                          if (e.key === 'Escape') handleCancelEdit()
                        }}
                        className="w-full text-center text-lg border border-teal rounded-lg px-2 py-1 mb-2 focus:outline-none focus:ring-2 focus:ring-teal/20 bg-white dark:bg-neutral-800 text-gray-800 dark:text-gray-200"
                        autoFocus
                      />
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleCancelEdit()}
                          className="flex-1 px-1 py-1 text-xs text-white rounded bg-gray-400 hover:bg-gray-500"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => void handleSaveEdit()}
                          className="flex-1 px-1 py-1 text-xs text-white rounded bg-teal hover:opacity-80"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Gear menu + Add task - aligned to right edge matching item card trailing section */}
          <div className="flex-shrink-0 flex items-center ml-auto pl-2.5 gap-2">
          {showAddMember && (
            <div ref={addMemberContainerRef} className="relative flex-shrink-0">
              <button
                type="button"
                disabled={isOfflineActionsDisabled}
                onClick={() => {
                  if (isOfflineActionsDisabled) return
                  if (isAdding) {
                    handleCancelAddMember()
                  } else {
                    setIsAdding(true)
                    requestAnimationFrame(() => {
                      const el = addMemberContainerRef.current
                      if (!el) return
                      const rect = el.getBoundingClientRect()
                      const EDGE_GUARD = 12
                      const vw = window.innerWidth
                      const popoverWidth = 200
                      let left = rect.left
                      if (left + popoverWidth + EDGE_GUARD > vw) {
                        left = Math.max(EDGE_GUARD, vw - popoverWidth - EDGE_GUARD)
                      }
                      setAddMemberPopoverPos({ top: rect.bottom + 4, left })
                    })
                  }
                }}
                className={`flex items-center justify-center rounded-lg w-[40px] h-[40px] touch-manipulation bg-teal text-white ${isOfflineActionsDisabled ? 'cursor-not-allowed opacity-40' : 'hover:opacity-80'}`}
                data-tour="add-member"
                aria-label="Add task"
                title={isOfflineActionsDisabled ? 'Unavailable while offline or reconnecting' : undefined}
              >
                <AddIcon className="w-[30px] h-[30px]" />
              </button>
              {addMemberMenuAnim.mounted && (addMemberPopoverPos ?? addMemberPopoverPosStableRef.current) && (
                <div
                  ref={addMemberPopoverRef}
                  className={`fixed z-50 w-[200px] rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-neutral-600 dark:bg-neutral-900 dark:shadow-black/40 ${addMemberMenuAnim.menuClassName}`}
                  style={{
                    top: (addMemberPopoverPos ?? addMemberPopoverPosStableRef.current)!.top,
                    left: (addMemberPopoverPos ?? addMemberPopoverPosStableRef.current)!.left,
                  }}
                >
                  <input
                    type="text"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleAddMember()
                      if (e.key === 'Escape') handleCancelAddMember()
                    }}
                    placeholder={suggestedName || 'Name'}
                    className="w-full text-center text-lg border border-teal rounded-lg px-2 py-1 mb-2 focus:outline-none focus:ring-2 focus:ring-teal/20 bg-white dark:bg-neutral-800 text-gray-800 dark:text-gray-200"
                    autoFocus
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleCancelAddMember()}
                      className="flex-1 px-1 py-1 text-xs text-white rounded bg-gray-400 hover:bg-gray-500"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void handleAddMember()}
                      className="flex-1 px-1 py-1 text-xs text-white rounded bg-teal hover:opacity-80"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {showActionsMenu && (
            <div className="relative">
              <button
                ref={actionsButtonRef}
                type="button"
                data-tour="category-sort"
                disabled={actionsMenuLoading}
                onClick={handleToggleActions}
                className="flex items-center justify-center rounded-lg w-[40px] h-[40px] touch-manipulation bg-cyan text-white hover:opacity-80 disabled:opacity-50 disabled:pointer-events-none"
                aria-label="List actions"
                aria-expanded={actionsOpen}
                aria-haspopup="menu"
              >
                <GearIcon className="w-[30px] h-[30px]" />
              </button>
              {actionsMenuAnim.mounted && (actionsMenuPos ?? actionsMenuPosStableRef.current) && (
                <div
                  ref={actionsMenuRef}
                  className={`fixed z-50 flex w-48 flex-col rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-neutral-600 dark:bg-neutral-900 dark:shadow-black/40 ${actionsMenuAnim.menuClassName}`}
                  role="menu"
                  style={{
                    top: (actionsMenuPos ?? actionsMenuPosStableRef.current)!.top,
                    right: (actionsMenuPos ?? actionsMenuPosStableRef.current)!.right,
                  }}
                >
                  {onSaveCategorySettings && (
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-neutral-800"
                      onClick={() => {
                        closeActions()
                        setShowCategoryModal(true)
                      }}
                    >
                      Set categories
                    </button>
                  )}
                  {onCategorySortClick && (
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-neutral-800"
                      onClick={() => {
                        closeActions()
                        void onCategorySortClick()
                      }}
                    >
                      Sort by category
                    </button>
                  )}
                  {(onSaveCategorySettings || onCategorySortClick) && (
                    <div className="my-1 h-px bg-gray-200 dark:bg-neutral-700" role="separator" />
                  )}
                  {onExpandAll && (
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-neutral-800"
                      onClick={() => {
                        closeActions()
                        onExpandAll()
                      }}
                    >
                      Expand all items
                    </button>
                  )}
                  {onCollapseAll && (
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-neutral-800"
                      onClick={() => {
                        closeActions()
                        onCollapseAll()
                      }}
                    >
                      Collapse all items
                    </button>
                  )}
                  {hasArchivedItems && (onRestoreAllArchived || onDeleteAllArchived) && (
                    <div className="my-1 h-px bg-gray-200 dark:bg-neutral-700" role="separator" />
                  )}
                  {hasArchivedItems && onRestoreAllArchived && (
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-neutral-800"
                      onClick={() => {
                        closeActions()
                        onRestoreAllArchived()
                      }}
                    >
                      Restore all archived
                    </button>
                  )}
                  {hasArchivedItems && onDeleteAllArchived && (
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-neutral-800"
                      onClick={() => {
                        closeActions()
                        onDeleteAllArchived()
                      }}
                    >
                      Delete all archived
                    </button>
                  )}
                  {onCreateTargets && !hasTargetMember && (
                    <>
                      <div className="my-1 h-px bg-gray-200 dark:bg-neutral-700" role="separator" />
                      <button
                        type="button"
                        role="menuitem"
                        disabled={isOfflineActionsDisabled}
                        className={`w-full text-left px-4 py-2.5 text-sm ${isOfflineActionsDisabled ? 'cursor-not-allowed text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-neutral-800'}`}
                        onClick={() => {
                          if (isOfflineActionsDisabled) return
                          closeActions()
                          onCreateTargets()
                        }}
                      >
                        Add Qty goals
                      </button>
                    </>
                  )}
                  {onEnableSumItems && sumScope === 'none' && (
                    <>
                      {!(onCreateTargets && !hasTargetMember) && (
                        <div className="my-1 h-px bg-gray-200 dark:bg-neutral-700" role="separator" />
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-neutral-800"
                        onClick={() => {
                          closeActions()
                          onEnableSumItems()
                        }}
                      >
                        Sum items
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          </div>
        </div>

      </div>

      {/* Floating member dropdown menu */}
      {memberFloatingMenuAnim.mounted &&
        (memberMenuPos ?? memberMenuPosStableRef.current) &&
        memberMenuDisplayMember && (
        <div
          ref={memberMenuRef}
          className={`fixed z-50 flex w-64 flex-col rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-neutral-600 dark:bg-neutral-900 dark:shadow-black/40 ${memberFloatingMenuAnim.menuClassName}`}
          role="menu"
          style={{
            top: (memberMenuPos ?? memberMenuPosStableRef.current)!.top,
            left: (memberMenuPos ?? memberMenuPosStableRef.current)!.left,
            right: (memberMenuPos ?? memberMenuPosStableRef.current)!.right,
          }}
        >
          {memberMenuDisplayMember.created_by === user?.id ? (
            <>
              <button
                type="button"
                role="menuitem"
                className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-neutral-800 flex items-center gap-2"
                onClick={() => handleStartEdit(memberMenuDisplayMember)}
              >
                Task: {memberMenuDisplayMember.name}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0 opacity-40">
                  <path fillRule="evenodd" clipRule="evenodd" d="M8.56078 20.2501L20.5608 8.25011L15.7501 3.43945L3.75012 15.4395V20.2501H8.56078ZM15.7501 5.56077L18.4395 8.25011L16.5001 10.1895L13.8108 7.50013L15.7501 5.56077ZM12.7501 8.56079L15.4395 11.2501L7.93946 18.7501H5.25012L5.25012 16.0608L12.7501 8.56079Z"/>
                </svg>
              </button>
              <hr className="border-gray-200 dark:border-neutral-600 mx-2" />
              <button
                type="button"
                role="menuitem"
                className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-neutral-800"
                onClick={() => void handleTogglePublic(memberMenuDisplayMember)}
              >
                Owner: {memberMenuDisplayMember.creator?.nickname || 'Unknown'}
                <br />
                <span className={`text-xs ${memberMenuDisplayMember.is_public ? 'text-cyan' : 'text-gray-400'}`}>
                  {memberMenuDisplayMember.is_public ? <>{'Other users can grab ownership.'}<br />{'Click to reclaim!'}</> : 'Click to transfer ownership'}
                </span>
              </button>
              {!memberMenuDisplayMember.is_target && (
                <>
                  <hr className="border-gray-200 dark:border-neutral-600 mx-2" />
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-neutral-800"
                    onClick={() => {
                      closeMemberMenu()
                      const isShowingAll = !hideDone[memberMenuDisplayMember.id] || !hideNotRelevant[memberMenuDisplayMember.id]
                      if (isShowingAll) {
                        if (!hideDone[memberMenuDisplayMember.id]) onToggleHideDone(memberMenuDisplayMember.id)
                        if (!hideNotRelevant[memberMenuDisplayMember.id]) onToggleHideNotRelevant(memberMenuDisplayMember.id)
                      } else {
                        if (hideDone[memberMenuDisplayMember.id]) onToggleHideDone(memberMenuDisplayMember.id)
                        if (hideNotRelevant[memberMenuDisplayMember.id]) onToggleHideNotRelevant(memberMenuDisplayMember.id)
                      }
                    }}
                  >
                    {hideDone[memberMenuDisplayMember.id] && hideNotRelevant[memberMenuDisplayMember.id]
                      ? 'Show all items'
                      : 'Show uncompleted items'}
                  </button>
                </>
              )}
              <hr className="border-gray-200 dark:border-neutral-600 mx-2" />
              <button
                type="button"
                role="menuitem"
                className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-gray-50 dark:hover:bg-neutral-800"
                onClick={() => handleDeleteClick(memberMenuDisplayMember)}
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <div className="px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 cursor-default">
                Task: {memberMenuDisplayMember.name}
              </div>
              <hr className="border-gray-200 dark:border-neutral-600 mx-2" />
              {memberMenuDisplayMember.is_public ? (
                <button
                  type="button"
                  role="menuitem"
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-neutral-800"
                  onClick={() => handleOwnClick(memberMenuDisplayMember)}
                >
                  Owner: {memberMenuDisplayMember.creator?.nickname || 'Unknown'}
                  <br />
                  <span className="text-xs text-cyan">Click to grab ownership!</span>
                </button>
              ) : (
                <div className="px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 cursor-default">
                  Owner: {memberMenuDisplayMember.creator?.nickname || 'Unknown'}
                </div>
              )}
              {!memberMenuDisplayMember.is_target && (
                <>
                  <hr className="border-gray-200 dark:border-neutral-600 mx-2" />
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-neutral-800"
                    onClick={() => {
                      closeMemberMenu()
                      const isShowingAll = !hideDone[memberMenuDisplayMember.id] || !hideNotRelevant[memberMenuDisplayMember.id]
                      if (isShowingAll) {
                        if (!hideDone[memberMenuDisplayMember.id]) onToggleHideDone(memberMenuDisplayMember.id)
                        if (!hideNotRelevant[memberMenuDisplayMember.id]) onToggleHideNotRelevant(memberMenuDisplayMember.id)
                      } else {
                        if (hideDone[memberMenuDisplayMember.id]) onToggleHideDone(memberMenuDisplayMember.id)
                        if (hideNotRelevant[memberMenuDisplayMember.id]) onToggleHideNotRelevant(memberMenuDisplayMember.id)
                      }
                    }}
                  >
                    {hideDone[memberMenuDisplayMember.id] && hideNotRelevant[memberMenuDisplayMember.id]
                      ? 'Show all items'
                      : 'Show uncompleted items'}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, memberId: null, memberName: '' })}
        onConfirm={handleConfirmDelete}
        title="Delete Member"
        message={`Delete "${deleteConfirm.memberName}"? Their quantities and done states will be removed from all items.`}
        confirmText="Delete"
        variant="danger"
        loading={deleteLoading}
      />

      <Modal
        isOpen={ownConfirm.open}
        onClose={() => setOwnConfirm({ open: false, memberId: null, memberName: '' })}
        size="xs"
        hideClose
        title="Take ownership"
      >
        <div>
          <p className="text-gray-600 dark:text-gray-300 text-center mb-6">
            Take ownership of<br />{ownConfirm.memberName}?
          </p>
          <div className="flex justify-center gap-6 mb-1">
            <button
              type="button"
              onClick={() => setOwnConfirm({ open: false, memberId: null, memberName: '' })}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmOwn()}
              disabled={ownLoading}
              className="px-4 py-2 text-sm text-white rounded-lg bg-cyan hover:opacity-80 disabled:opacity-50"
            >
              {ownLoading ? 'Taking...' : 'OK'}
            </button>
          </div>
        </div>
      </Modal>

      {itemNameFontMenuAnim.mounted &&
        (itemNameFontPos ?? itemNameFontPosStableRef.current) &&
        onItemNameFontStepChange &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={itemNameFontPopoverRef}
            tabIndex={-1}
            role="dialog"
            aria-label="Item name font size"
            className={`fixed z-[10000] w-[220px] rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-neutral-600 dark:bg-neutral-900 dark:shadow-black/40 ${itemNameFontMenuAnim.menuClassName}`}
            style={{
              top: (itemNameFontPos ?? itemNameFontPosStableRef.current)!.top,
              left: (itemNameFontPos ?? itemNameFontPosStableRef.current)!.left,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded text-lg font-semibold text-teal touch-manipulation hover:bg-teal/10"
                aria-label="Smaller text"
                onClick={(e) => {
                  e.stopPropagation()
                  onItemNameFontStepChange(Math.max(ITEM_NAME_FONT_MIN, itemNameFontStep - 1))
                }}
              >
                −
              </button>
              <div
                role="slider"
                aria-valuemin={ITEM_NAME_FONT_MIN}
                aria-valuemax={ITEM_NAME_FONT_MAX}
                aria-valuenow={itemNameFontStep}
                aria-label="Font size"
                className="relative h-2.5 min-w-[100px] flex-1 cursor-pointer rounded-full border border-gray-300 bg-gray-50 dark:border-neutral-500 dark:bg-neutral-900"
                onClick={handleFontBarClick}
              >
                <div
                  className="pointer-events-none absolute left-0 top-0 h-full rounded-full bg-teal"
                  style={{ width: `${(itemNameFontStep / ITEM_NAME_FONT_MAX) * 100}%` }}
                />
              </div>
              <button
                type="button"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded text-lg font-semibold text-teal touch-manipulation hover:bg-teal/10"
                aria-label="Larger text"
                onClick={(e) => {
                  e.stopPropagation()
                  onItemNameFontStepChange(Math.min(ITEM_NAME_FONT_MAX, itemNameFontStep + 1))
                }}
              >
                +
              </button>
            </div>
          </div>,
          document.body,
        )}

      {onSaveCategorySettings && categoryNames && (
        <CategoryNamesModal
          isOpen={showCategoryModal}
          onClose={() => setShowCategoryModal(false)}
          categoryNames={categoryNames}
          categoryOrder={categoryOrder || [1, 2, 3, 4, 5, 6]}
          onSave={async (names, order) => onSaveCategorySettings(names, order)}
        />
      )}
    </div>
  )
}
