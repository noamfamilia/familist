'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ITEM_CATEGORY_STYLES } from '@/lib/categoryStyles'
import { ITEM_CATEGORIES } from '@/lib/supabase/types'
import type { CategoryNames } from '@/lib/supabase/types'

interface CategoryNamesModalProps {
  isOpen: boolean
  onClose: () => void
  categoryNames: CategoryNames
  onSave: (names: CategoryNames) => Promise<{ error: unknown }>
}

export function CategoryNamesModal({ isOpen, onClose, categoryNames, onSave }: CategoryNamesModalProps) {
  const [names, setNames] = useState<CategoryNames>({ ...categoryNames })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    await onSave(names)
    setSaving(false)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Category Names" size="sm">
      <div className="space-y-3">
        {ITEM_CATEGORIES.map(c => (
          <div
            key={c}
            className={`flex items-center rounded-lg px-3 py-2.5 ${ITEM_CATEGORY_STYLES[c].swatch}`}
          >
            <input
              type="text"
              value={names[String(c)] ?? ''}
              onChange={e => setNames(prev => ({ ...prev, [String(c)]: e.target.value }))}
              placeholder="<empty>"
              className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-gray-400/70"
              maxLength={30}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-end mt-5">
        <Button type="button" onClick={handleSave} loading={saving}>
          Save
        </Button>
      </div>
    </Modal>
  )
}
