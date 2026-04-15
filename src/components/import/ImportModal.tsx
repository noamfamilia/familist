'use client'

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/providers/AuthProvider'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { parseSheetCsv, resolveImportListName } from '@/lib/sheetImport/parseSheetCsv'
import type { Json } from '@/lib/supabase/types'

interface ImportModalProps {
  isOpen: boolean
  onClose: () => void
  labels: string[]
  currentFilter?: string
  onSelectLabel?: (label: string) => void
  onAddLocalLabel?: (label: string) => void
  importList?: (name: string, label?: string, categoryNames?: string, rows?: Json) => Promise<{ data?: unknown; error: Error | null }>
  existingLists?: { role: string; name: string }[]
}

export function ImportModal({ isOpen, onClose, labels, currentFilter = 'Any', onSelectLabel, onAddLocalLabel, importList, existingLists }: ImportModalProps) {
  const { user } = useAuth()
  const [sheetUrl, setSheetUrl] = useState('')
  const [nameOverride, setNameOverride] = useState('')
  const [selectedLabel, setSelectedLabel] = useState('')
  const [labelDropdownOpen, setLabelDropdownOpen] = useState(false)
  const [addingLabel, setAddingLabel] = useState(false)
  const [newLabelText, setNewLabelText] = useState('')
  const labelDropdownRef = useRef<HTMLDivElement>(null)
  const addLabelInputRef = useRef<HTMLInputElement>(null)
  const addLabelPopoverRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) {
      setSheetUrl('')
      setNameOverride('')
      setSelectedLabel('')
      setLabelDropdownOpen(false)
      setAddingLabel(false)
      setNewLabelText('')
      setError('')
      setBusy(false)
    }
  }, [isOpen])

  useEffect(() => {
    if (!labelDropdownOpen) return
    const handleMouseDown = (e: MouseEvent) => {
      if (labelDropdownRef.current && !labelDropdownRef.current.contains(e.target as Node)) {
        e.preventDefault()
        e.stopPropagation()
        setLabelDropdownOpen(false)
        document.addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault() }, { capture: true, once: true })
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true)
    return () => document.removeEventListener('mousedown', handleMouseDown, true)
  }, [labelDropdownOpen])

  useEffect(() => {
    if (addingLabel && addLabelInputRef.current) {
      addLabelInputRef.current.focus()
    }
  }, [addingLabel])

  useEffect(() => {
    if (!addingLabel || labelDropdownOpen) return
    const handleMouseDown = (e: MouseEvent) => {
      if (addLabelPopoverRef.current && !addLabelPopoverRef.current.contains(e.target as Node)) {
        e.preventDefault()
        e.stopPropagation()
        handleAddLabelDone()
        document.addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault() }, { capture: true, once: true })
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true)
    return () => document.removeEventListener('mousedown', handleMouseDown, true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addingLabel, labelDropdownOpen, newLabelText])

  const handleAddLabelDone = () => {
    const trimmed = newLabelText.trim()
    if (trimmed) {
      setSelectedLabel(trimmed)
      onAddLocalLabel?.(trimmed)
    }
    setAddingLabel(false)
    setNewLabelText('')
  }

  const ownedListNames = (existingLists || []).filter(l => l.role === 'owner').map(l => l.name)

  const runImport = async () => {
    setError('')
    const url = sheetUrl.trim()
    if (!url) {
      setError('Paste your Google Sheet link.')
      return
    }
    if (!user) {
      setError('Sign in to import.')
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/sheet-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const payload = (await res.json()) as { csv?: string; title?: string | null; error?: string }
      if (!res.ok) {
        setError(payload.error || 'Could not download the sheet.')
        return
      }
      const csv = payload.csv
      if (typeof csv !== 'string') {
        setError('Unexpected response from server.')
        return
      }

      const parsed = parseSheetCsv(csv)
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }

      const override = nameOverride.trim()
      const listName = override || resolveImportListName(payload.title ?? null, ownedListNames)

      const categoryNamesJson = Object.values(parsed.categoryNames).some(v => v)
        ? JSON.stringify(
            Object.fromEntries(Object.entries(parsed.categoryNames).filter(([, v]) => v))
          )
        : undefined

      if (!importList) {
        setError('Import not available. Please try again.')
        return
      }
      const { error: importErr } = await importList(
        listName,
        selectedLabel || undefined,
        categoryNamesJson,
        parsed.rows as unknown as Json,
      )
      if (importErr) {
        setError(importErr.message || 'Import failed.')
        return
      }

      const isSpecificLabel = selectedLabel && selectedLabel !== ''
      const filterAfterImport = isSpecificLabel
        ? selectedLabel
        : (currentFilter !== 'Any' && currentFilter !== '' ? 'Any' : currentFilter)
      onSelectLabel?.(filterAfterImport ?? 'Any')
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Import from Google Sheet" contentClassName="!overflow-visible" hideClose>
      <div className="space-y-5">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          First row must include an <strong>Items</strong> column. Optional:{' '}
          <strong>comments</strong>, <strong>category</strong> (names). Share the sheet so anyone with the link can view.
        </p>

        <div className="space-y-2">
          <label htmlFor="sheet-url" className="text-sm font-medium text-gray-700 dark:text-gray-200">
            Sheet URL
          </label>
          <textarea
            id="sheet-url"
            value={sheetUrl}
            onChange={e => setSheetUrl(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal focus:border-transparent"
            placeholder="https://docs.google.com/spreadsheets/d/…"
            disabled={busy}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="list-name-override" className="text-sm font-medium text-gray-700 dark:text-gray-200">
            List name (optional)
          </label>
          <Input
            id="list-name-override"
            value={nameOverride}
            onChange={e => setNameOverride(e.target.value)}
            placeholder="Uses sheet title or Import / Import 2… if empty"
            disabled={busy}
          />
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Label</span>
          <div className="relative" ref={labelDropdownRef}>
            <button
              type="button"
              onClick={() => { setLabelDropdownOpen(o => !o); setAddingLabel(false); setNewLabelText('') }}
              disabled={busy}
              className="text-sm bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-md px-2 py-1.5 text-gray-700 dark:text-gray-300 focus:outline-none focus:border-teal cursor-pointer flex items-center gap-1 w-full"
            >
              <svg className="h-6 w-6 flex-shrink-0" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                <path d="M746.5 575.9L579.2 743.6l-173-173.5-53.3-112.4 108.3-108.6 112.2 53.4z" fill="#FBBA22" />
                <path d="M579.4 389.9l-112.2-53.4c-5.3-2.5-11.6-1.4-15.8 2.7L435 355.7c-85.5-108.1-150.2-83.1-152.9-82-5 2-8.4 6.7-8.8 12.1-4.6 72.2 38.2 118.1 86.8 145l-17 17c-4.2 4.2-5.3 10.5-2.7 15.8L393.7 576c0.7 1.4 1.6 2.8 2.7 3.9l173.1 173.5c5.4 5.4 14.2 5.4 19.7 0l167.3-167.6c2.6-2.6 4.1-6.2 4.1-9.9s-1.5-7.2-4.1-9.9L583.3 392.6c-1.2-1.1-2.5-2-3.9-2.7z m-278.7-91.5c17.3-0.6 58.8 5.9 114 76.6 0.1 0.2 0.3 0.3 0.5 0.5l-34.7 34.8c-38.8-19.1-78.8-53-79.8-111.9z m426.1 277.5L579.2 723.8 417.7 562l-48-101.4 17-17c14 5.8 27.9 10.1 40.7 13.1 1.1 4.7 3.5 9.3 7.2 13a27.22 27.22 0 0 0 38.6 0c10.7-10.7 10.7-28 0-38.7-10.3-10.3-26.6-10.6-37.3-1.1-7.5-1.8-17.1-4.4-27.6-8l55.8-55.9 101.2 48 161.5 161.9z" className="fill-gray-800 dark:fill-gray-200" />
              </svg>
              {selectedLabel || <span className="text-gray-400">None</span>}
              <svg className={`h-3 w-3 ml-auto transition-transform ${labelDropdownOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
            {labelDropdownOpen && (
              <div className="absolute left-0 mt-1 min-w-[140px] w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg dark:shadow-slate-900/50 z-50 overflow-hidden">
                {labels.map(l => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => { setSelectedLabel(l); setLabelDropdownOpen(false) }}
                    className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                      selectedLabel === l ? 'bg-teal/10 text-teal font-semibold' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    {l}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { setSelectedLabel(''); setLabelDropdownOpen(false) }}
                  className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                    !selectedLabel ? 'bg-teal/10 text-teal font-semibold' : 'text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-700'
                  }`}
                >
                  None
                </button>
                <button
                  type="button"
                  onClick={() => { setLabelDropdownOpen(false); setAddingLabel(true) }}
                  className="w-full text-left px-3 py-1.5 text-sm text-teal hover:bg-gray-50 dark:hover:bg-slate-700 border-t border-gray-200 dark:border-slate-600"
                >
                  + Add label
                </button>
              </div>
            )}
            {addingLabel && !labelDropdownOpen && (
              <div
                ref={addLabelPopoverRef}
                className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-600 shadow-lg p-2 min-w-[160px]"
              >
                <div className="relative">
                  <input
                    ref={addLabelInputRef}
                    type="text"
                    value={newLabelText}
                    onChange={(e) => setNewLabelText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleAddLabelDone() }
                      if (e.key === 'Escape') { setAddingLabel(false); setNewLabelText('') }
                    }}
                    placeholder="Label name..."
                    className="w-full px-3 py-1.5 pr-8 text-sm border border-gray-300 dark:border-slate-600 rounded-lg focus:outline-none focus:border-teal bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200"
                  />
                  <button
                    type="button"
                    onClick={() => setNewLabelText('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {error && <div className="bg-red-50 dark:bg-red-900/30 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 rounded-lg"
          >
            Cancel
          </button>
          <Button type="button" className="bg-red-500 hover:bg-red-600" loading={busy} onClick={() => void runImport()}>
            Import
          </Button>
        </div>
      </div>
    </Modal>
  )
}
