'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import type { ListWithRole } from '@/lib/supabase/types'

const UNLABELED_KEY = '__unlabeled__'

type TriValue = boolean | 'indeterminate'

function TriCheckbox({
  value,
  ariaLabel,
}: {
  value: TriValue
  ariaLabel: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.indeterminate = value === 'indeterminate'
  }, [value])

  const checked = value === true

  return (
    <input
      ref={ref}
      type="checkbox"
      className="h-4 w-4 rounded border-gray-400 bg-white text-white accent-gray-500 focus:ring-gray-400/80 focus:ring-offset-0 pointer-events-none dark:border-gray-500 dark:bg-neutral-800 dark:accent-gray-500"
      checked={checked}
      readOnly
      aria-label={ariaLabel}
    />
  )
}

export interface LabelManagerModalProps {
  isOpen: boolean
  onClose: () => void
  lists: ListWithRole[]
  /** DB-derived labels (sorted), for local-only registration on close */
  availableLabels: string[]
  /** merged labels for destination picker (DB + local), sorted */
  mergedLabels: string[]
  /** Single user action: applies many label updates under one mutation lock */
  applyListLabelsBatch: (changes: Array<{ listId: string; label: string }>) => Promise<{ error: Error | null }>
  onAddLocalLabel: (label: string) => void
  onError: (message: string) => void
}

export function LabelManagerModal({
  isOpen,
  onClose,
  lists,
  availableLabels,
  mergedLabels,
  applyListLabelsBatch,
  onAddLocalLabel,
  onError,
}: LabelManagerModalProps) {
  const [scopeSelected, setScopeSelected] = useState<Set<string>>(new Set())
  const [listSearch, setListSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [destDropdownOpen, setDestDropdownOpen] = useState(false)
  const [destination, setDestination] = useState<'unset' | { kind: 'none' } | { kind: 'label'; name: string }>('unset')
  const [addingDestLabel, setAddingDestLabel] = useState(false)
  const [newDestLabelText, setNewDestLabelText] = useState('')
  const destDropdownRef = useRef<HTMLDivElement>(null)
  const addDestPopoverRef = useRef<HTMLDivElement>(null)
  const addDestInputRef = useRef<HTMLInputElement>(null)
  const [applying, setApplying] = useState(false)
  const [sessionCreatedLabels, setSessionCreatedLabels] = useState<string[]>([])
  const prevModalOpenRef = useRef(false)
  const scopeRows = useMemo(() => {
    const unlabeledCount = lists.filter(l => !l.label?.trim()).length
    const labelCounts = new Map<string, number>()
    for (const l of lists) {
      const lab = l.label?.trim()
      if (lab) labelCounts.set(lab, (labelCounts.get(lab) ?? 0) + 1)
    }
    const sortedNames = Array.from(labelCounts.keys()).sort((a, b) => a.localeCompare(b))
    return { unlabeledCount, sortedNames, labelCounts }
  }, [lists])

  const scopeKeysList = useMemo(() => {
    const keys: { key: string; display: string; count: number }[] = []
    if (scopeRows.unlabeledCount > 0) {
      keys.push({ key: UNLABELED_KEY, display: 'Unlabeled', count: scopeRows.unlabeledCount })
    }
    for (const name of scopeRows.sortedNames) {
      keys.push({ key: name, display: name, count: scopeRows.labelCounts.get(name) ?? 0 })
    }
    return keys
  }, [scopeRows])

  const scopedLists = useMemo(() => {
    return lists
      .filter(list => {
        const empty = !list.label?.trim()
        if (empty) return scopeSelected.has(UNLABELED_KEY)
        return scopeSelected.has(list.label!.trim())
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [lists, scopeSelected])

  const searchLower = listSearch.trim().toLowerCase()
  const visibleLists = useMemo(() => {
    if (!searchLower) return scopedLists
    return scopedLists.filter(l => l.name.toLowerCase().includes(searchLower))
  }, [scopedLists, searchLower])

  const hiddenSelectedCount = useMemo(() => {
    if (!searchLower) return 0
    let n = 0
    for (const id of Array.from(selectedIds)) {
      const list = scopedLists.find(l => l.id === id)
      if (list && !list.name.toLowerCase().includes(searchLower)) n++
    }
    return n
  }, [selectedIds, scopedLists, searchLower])

  const scopeSelectAllValue: TriValue = useMemo(() => {
    if (scopeKeysList.length === 0) return false
    let on = 0
    for (const row of scopeKeysList) {
      if (scopeSelected.has(row.key)) on++
    }
    if (on === 0) return false
    if (on === scopeKeysList.length) return true
    return 'indeterminate'
  }, [scopeKeysList, scopeSelected])

  const listSelectAllValue: TriValue = useMemo(() => {
    if (visibleLists.length === 0) return false
    let on = 0
    for (const l of visibleLists) {
      if (selectedIds.has(l.id)) on++
    }
    if (on === 0) return false
    if (on === visibleLists.length) return true
    return 'indeterminate'
  }, [visibleLists, selectedIds])

  useEffect(() => {
    if (!isOpen) {
      prevModalOpenRef.current = false
      return
    }
    if (prevModalOpenRef.current) return
    prevModalOpenRef.current = true

    setScopeSelected(new Set())
    setListSearch('')
    setSelectedIds(new Set())
    setDestination('unset')
    setDestDropdownOpen(false)
    setAddingDestLabel(false)
    setNewDestLabelText('')
    setSessionCreatedLabels([])
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) setApplying(false)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    setSelectedIds(new Set())
  }, [isOpen, scopeSelected])

  const toggleScopeKey = (key: string) => {
    setScopeSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleScopeSelectAll = () => {
    if (scopeKeysList.length === 0) return
    if (scopeSelectAllValue === true) {
      setScopeSelected(new Set())
    } else {
      setScopeSelected(new Set(scopeKeysList.map(r => r.key)))
    }
  }

  const toggleListId = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleVisibleSelectAll = () => {
    if (visibleLists.length === 0) return
    if (listSelectAllValue === true) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        for (const l of visibleLists) next.delete(l.id)
        return next
      })
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev)
        for (const l of visibleLists) next.add(l.id)
        return next
      })
    }
  }

  const targetLabelString = useMemo(() => {
    if (destination === 'unset') return null
    if (destination.kind === 'none') return ''
    return destination.name
  }, [destination])

  const wouldChangeCount = useMemo(() => {
    if (targetLabelString === null) return 0
    let n = 0
    for (const id of Array.from(selectedIds)) {
      const list = lists.find(l => l.id === id)
      if (!list) continue
      const cur = (list.label ?? '').trim()
      const next = targetLabelString ?? ''
      if (cur !== next) n++
    }
    return n
  }, [selectedIds, lists, targetLabelString])

  const summaryText = useMemo(() => {
    if (selectedIds.size === 0) return 'Select at least one list'
    if (destination === 'unset') return 'Choose destination label'
    if (wouldChangeCount === 0) return 'No change to apply'
    if (destination.kind === 'none') {
      return `${wouldChangeCount} list${wouldChangeCount === 1 ? '' : 's'} will have their label cleared`
    }
    return `${wouldChangeCount} list${wouldChangeCount === 1 ? '' : 's'} will be changed to "${destination.name}"`
  }, [selectedIds.size, destination, wouldChangeCount])

  const canApply =
    !applying &&
    selectedIds.size > 0 &&
    destination !== 'unset' &&
    wouldChangeCount > 0

  const flushSessionLocals = useCallback(() => {
    for (const lab of sessionCreatedLabels) {
      if (!availableLabels.includes(lab)) onAddLocalLabel(lab)
    }
  }, [sessionCreatedLabels, availableLabels, onAddLocalLabel])

  const handleModalClose = () => {
    flushSessionLocals()
    onClose()
  }

  /** When every list that had label L was in this batch and lists move to a different label, keep L as a local-only name (zero lists). */
  const registerVacatedLabelsAsLocal = useCallback(
    (listsSnapshot: ListWithRole[], selected: Set<string>, nextLabel: string) => {
      const labelsOnSelected = new Set<string>()
      for (const id of selected) {
        const list = listsSnapshot.find(l => l.id === id)
        const lab = (list?.label ?? '').trim()
        if (lab) labelsOnSelected.add(lab)
      }
      for (const L of labelsOnSelected) {
        if (L === nextLabel) continue
        const idsWithL = listsSnapshot
          .filter(l => (l.label ?? '').trim() === L)
          .map(l => l.id)
        if (idsWithL.length === 0) continue
        if (!idsWithL.every(id => selected.has(id))) continue
        onAddLocalLabel(L)
      }
    },
    [onAddLocalLabel]
  )

  const handleAddDestLabelDone = () => {
    const trimmed = newDestLabelText.trim()
    if (trimmed && trimmed.toLowerCase() !== 'any') {
      setDestination({ kind: 'label', name: trimmed })
      setSessionCreatedLabels(prev => (prev.includes(trimmed) ? prev : [...prev, trimmed]))
      if (!availableLabels.includes(trimmed)) {
        onAddLocalLabel(trimmed)
      }
    }
    setAddingDestLabel(false)
    setNewDestLabelText('')
    setDestDropdownOpen(false)
  }

  const handleAddDestLabelCancel = () => {
    setAddingDestLabel(false)
    setNewDestLabelText('')
  }

  useEffect(() => {
    if (addingDestLabel && addDestInputRef.current) addDestInputRef.current.focus()
  }, [addingDestLabel])

  useEffect(() => {
    if (!destDropdownOpen && !addingDestLabel) return
    const close = (e: MouseEvent) => {
      const t = e.target as Node
      if (destDropdownRef.current?.contains(t)) return
      if (addDestPopoverRef.current?.contains(t)) return
      setDestDropdownOpen(false)
      setAddingDestLabel(false)
      setNewDestLabelText('')
    }
    document.addEventListener('mousedown', close, true)
    return () => document.removeEventListener('mousedown', close, true)
  }, [destDropdownOpen, addingDestLabel])

  const handleApply = async (closeAfter: boolean) => {
    if (!canApply || targetLabelString === null) return
    const listsSnapshot = lists
    const next = targetLabelString
    setApplying(true)
    try {
      const changes: Array<{ listId: string; label: string }> = []
      for (const id of Array.from(selectedIds)) {
        const list = lists.find(l => l.id === id)
        if (!list) continue
        const cur = (list.label ?? '').trim()
        if (cur === next) continue
        changes.push({ listId: id, label: next })
      }
      if (changes.length > 0) {
        const { error } = await applyListLabelsBatch(changes)
        if (error) {
          const detail = error.message?.trim() || 'Unknown error'
          onError(`Could not update labels: ${detail}`)
          setApplying(false)
          return
        }
      }
      registerVacatedLabelsAsLocal(listsSnapshot, selectedIds, next)
      if (closeAfter) {
        handleModalClose()
      } else {
        setApplying(false)
        setScopeSelected(new Set())
        setSelectedIds(new Set())
        setListSearch('')
        setDestination('unset')
        setDestDropdownOpen(false)
        setAddingDestLabel(false)
        setNewDestLabelText('')
      }
    } catch (e) {
      setApplying(false)
      const detail = e instanceof Error ? e.message : String(e)
      onError(`Could not finish updating labels: ${detail}`)
    }
  }

  const destButtonLabel =
    destination === 'unset'
      ? 'Choose label…'
      : destination.kind === 'none'
        ? 'No label'
        : destination.name

  const selectAllShownLabel = searchLower ? '(select all shown)' : '(select all)'

  const sortedMergedLabels = useMemo(
    () => [...mergedLabels].sort((a, b) => a.localeCompare(b)),
    [mergedLabels]
  )

  if (!isOpen) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (applying) return
        handleModalClose()
      }}
      title="Label manager"
      size="lg"
      contentClassName="!max-w-lg max-sm:!max-w-none"
      fullScreenMobile
    >
      <div className="relative min-h-[200px] text-left" aria-busy={applying}>
        <div className="space-y-6" {...(applying ? { inert: true } : {})}>
        {/* 1. Filter by labels */}
        <section>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">Filter lists by labels</h3>
          {scopeKeysList.length === 0 ? (
            <p className="text-sm text-gray-500">No labels yet. Create lists or add labels on a list first.</p>
          ) : (
            <div className="rounded-lg border border-gray-200 dark:border-neutral-600 divide-y divide-gray-200 dark:divide-neutral-600">
              <button
                type="button"
                onClick={toggleScopeSelectAll}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-neutral-800/50"
              >
                <TriCheckbox value={scopeSelectAllValue} ariaLabel="Select all label filters" />
                <span>(select all)</span>
              </button>
              {scopeKeysList.map(row => (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => toggleScopeKey(row.key)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-neutral-800/50"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-teal/60 bg-white text-white accent-teal focus:ring-teal/60 focus:ring-offset-0 pointer-events-none dark:bg-neutral-800"
                    checked={scopeSelected.has(row.key)}
                    readOnly
                    aria-hidden
                  />
                  <span>
                    {row.display} ({row.count})
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* 2. Select lists */}
        <section>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">Select lists to update</h3>
          <input
            type="search"
            value={listSearch}
            onChange={e => setListSearch(e.target.value)}
            placeholder="Search list…"
            className="w-full mb-2 px-3 py-2 text-sm border border-gray-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-teal/20"
          />
          {scopedLists.length === 0 ? (
            <p className="text-sm text-gray-500">No lists match the label filter above.</p>
          ) : (
            <div className="rounded-lg border border-gray-200 dark:border-neutral-600 divide-y divide-gray-200 dark:divide-neutral-600">
              <button
                type="button"
                onClick={toggleVisibleSelectAll}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-neutral-800/50"
              >
                <TriCheckbox value={listSelectAllValue} ariaLabel={selectAllShownLabel} />
                <span>{selectAllShownLabel}</span>
              </button>
              {visibleLists.map(list => (
                <button
                  key={list.id}
                  type="button"
                  onClick={() => toggleListId(list.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-neutral-800/50"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-teal/60 bg-white text-white accent-teal focus:ring-teal/60 focus:ring-offset-0 pointer-events-none dark:bg-neutral-800"
                    checked={selectedIds.has(list.id)}
                    readOnly
                    aria-hidden
                  />
                  <span className="truncate">{list.name}</span>
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            {selectedIds.size} lists selected
            {hiddenSelectedCount > 0 ? ` (${hiddenSelectedCount} hidden by search)` : ''}
          </p>
        </section>

        {/* 3. Destination */}
        <section>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">Set label for selected lists</h3>
          <div className="relative" ref={destDropdownRef}>
            <button
              type="button"
              onClick={() => {
                if (addingDestLabel) return
                setDestDropdownOpen(o => !o)
              }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm border border-gray-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-gray-800 dark:text-gray-200"
            >
              <span className={destination === 'unset' ? 'text-gray-400' : ''}>{destButtonLabel}</span>
              <svg className={`h-4 w-4 flex-shrink-0 ${destDropdownOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            {destDropdownOpen && (
              <div className="absolute left-0 right-0 bottom-full mb-1 z-[60] rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 shadow-lg">
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-neutral-800"
                  onClick={() => {
                    setDestination({ kind: 'none' })
                    setDestDropdownOpen(false)
                  }}
                >
                  No label
                </button>
                {sortedMergedLabels.map(l => (
                  <button
                    key={l}
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-neutral-800"
                    onClick={() => {
                      setDestination({ kind: 'label', name: l })
                      setDestDropdownOpen(false)
                    }}
                  >
                    {l}
                  </button>
                ))}
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-sm text-teal border-t border-gray-200 dark:border-neutral-600 hover:bg-gray-50 dark:hover:bg-neutral-800"
                  onClick={() => {
                    setDestDropdownOpen(false)
                    setAddingDestLabel(true)
                  }}
                >
                  + Create new label
                </button>
              </div>
            )}
            {addingDestLabel && !destDropdownOpen && (
              <div
                ref={addDestPopoverRef}
                className="absolute left-0 right-0 bottom-full mb-1 z-[60] bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-600 shadow-lg p-2 w-full max-w-[200px]"
              >
                <input
                  ref={addDestInputRef}
                  type="text"
                  value={newDestLabelText}
                  onChange={e => setNewDestLabelText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddDestLabelDone()
                    }
                    if (e.key === 'Escape') handleAddDestLabelCancel()
                  }}
                  placeholder="Label name..."
                  className="w-full text-center text-lg border border-teal rounded-lg px-2 py-1 mb-2 focus:outline-none focus:ring-2 focus:ring-teal/20 bg-white dark:bg-neutral-800 text-gray-800 dark:text-gray-200"
                />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={handleAddDestLabelCancel}
                    className="flex-1 px-1 py-1 text-xs text-white rounded bg-gray-400 hover:bg-gray-500"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={handleAddDestLabelDone}
                    className="flex-1 px-1 py-1 text-xs text-white rounded bg-teal hover:opacity-80"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-3 min-h-[1.25rem]">{summaryText}</p>
        </section>

        <div className="flex justify-end gap-2 pt-2 min-h-[2.5rem] items-center flex-wrap">
          <button
            type="button"
            onClick={handleModalClose}
            disabled={applying}
            className={`px-4 py-2 text-sm font-medium rounded-lg min-w-[4.5rem] disabled:cursor-default ${
              applying
                ? 'cursor-not-allowed text-white/75 bg-gray-400/50 dark:bg-gray-500/50'
                : 'text-white bg-gray-400 hover:bg-gray-500 dark:bg-gray-500 dark:hover:bg-gray-600'
            }`}
          >
            Close
          </button>
          <button
            type="button"
            disabled={!canApply || applying}
            aria-busy={applying}
            onClick={() => {
              if (!canApply || applying) return
              void handleApply(false)
            }}
            className={`inline-flex min-h-[2.5rem] min-w-[4.5rem] items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
              canApply && !applying
                ? 'text-white bg-teal hover:opacity-80'
                : 'text-white/75 bg-teal/35 cursor-not-allowed'
            }`}
          >
            {applying ? (
              <>
                <span className="sr-only">Applying label changes</span>
                <span aria-hidden="true" className="inline-flex shrink-0">
                  <Spinner size="sm" className="h-5 w-5 border-2 border-white border-t-transparent" />
                </span>
              </>
            ) : (
              'Apply'
            )}
          </button>
        </div>
        </div>
      </div>
    </Modal>
  )
}
