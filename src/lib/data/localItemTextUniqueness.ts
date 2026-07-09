import { db } from '@/lib/db'
import { isTombstoned } from '@/lib/data/base_sync_fields'

/** Match server `resolve_unique_item_text_for_list` comparison (trim + case-insensitive; cap length). */
export function normalizeItemTextForUniqueness(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 2000)
}

function shortenForMessage(s: string, max = 72): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

/**
 * True when another non–soft-deleted item in this list already uses the same display text
 * (case-insensitive trim). Soft-deleted rows (`deleted_at` set) do not count.
 */
export type SingleAddTextClassification =
  | { kind: 'create' }
  | { kind: 'unarchive'; itemId: string }
  | { kind: 'duplicate_active'; itemId: string }

/** Single add: archived exact match → unarchive; active exact match → ignore; else create. */
export async function classifySingleAddText(
  listId: string,
  displayText: string,
): Promise<SingleAddTextClassification> {
  const trimmed = displayText.trim()
  if (!trimmed) return { kind: 'create' }

  const target = normalizeItemTextForUniqueness(trimmed)
  const rows = await db.items.where('list_id').equals(listId).toArray()
  let archivedMatchId: string | null = null

  for (const row of rows) {
    if (isTombstoned(row.deleted_at)) continue
    if (normalizeItemTextForUniqueness(String(row.text ?? '')) !== target) continue
    if (row.archived) {
      if (!archivedMatchId) archivedMatchId = row.id
      continue
    }
    return { kind: 'duplicate_active', itemId: row.id }
  }

  if (archivedMatchId) return { kind: 'unarchive', itemId: archivedMatchId }
  return { kind: 'create' }
}

export type BulkAddLinePlan = {
  /** Unique new lines to create (first occurrence order). */
  toCreate: string[]
  /** Archived items to restore (first match per unique line). */
  toUnarchiveIds: string[]
}

/**
 * Bulk add plan: per unique line (first occurrence), create / unarchive / ignore active.
 * Duplicate lines within the batch are collapsed to the first occurrence.
 */
export async function classifyBulkAddLines(
  listId: string,
  trimmedNonemptyLines: string[],
): Promise<BulkAddLinePlan> {
  const rows = await db.items.where('list_id').equals(listId).toArray()
  const activeByNorm = new Map<string, string>()
  const archivedByNorm = new Map<string, string>()
  for (const row of rows) {
    if (isTombstoned(row.deleted_at)) continue
    const n = normalizeItemTextForUniqueness(String(row.text ?? ''))
    if (!n) continue
    if (row.archived) {
      if (!archivedByNorm.has(n)) archivedByNorm.set(n, row.id)
    } else if (!activeByNorm.has(n)) {
      activeByNorm.set(n, row.id)
    }
  }

  const seen = new Set<string>()
  const toCreate: string[] = []
  const toUnarchiveIds: string[] = []

  for (const line of trimmedNonemptyLines) {
    const n = normalizeItemTextForUniqueness(line)
    if (!n || seen.has(n)) continue
    seen.add(n)
    if (activeByNorm.has(n)) continue
    const archivedId = archivedByNorm.get(n)
    if (archivedId) {
      toUnarchiveIds.push(archivedId)
      continue
    }
    toCreate.push(line.trim())
  }

  return { toCreate, toUnarchiveIds }
}

/** UI: exact normalized name match against in-memory list rows (active or archived). */
export function inMemoryItemsHaveExactNormalizedText(
  items: { text?: string | null; deleted_at?: string | null }[],
  displayText: string,
): boolean {
  const target = normalizeItemTextForUniqueness(displayText)
  if (!target) return false
  for (const row of items) {
    if (isTombstoned(row.deleted_at)) continue
    if (normalizeItemTextForUniqueness(String(row.text ?? '')) === target) return true
  }
  return false
}

export async function listHasActiveItemWithNormalizedText(
  listId: string,
  displayText: string,
  excludeItemId?: string,
): Promise<boolean> {
  const target = normalizeItemTextForUniqueness(displayText)
  if (!target) return false
  const rows = await db.items.where('list_id').equals(listId).toArray()
  for (const row of rows) {
    if (isTombstoned(row.deleted_at)) continue
    if (excludeItemId && row.id === excludeItemId) continue
    if (normalizeItemTextForUniqueness(String(row.text ?? '')) === target) return true
  }
  return false
}

export async function validateSingleNewItemTextUniqueness(
  listId: string,
  displayText: string,
  excludeItemId?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const trimmed = displayText.trim()
  if (!trimmed) return { ok: true }
  if (await listHasActiveItemWithNormalizedText(listId, trimmed, excludeItemId)) {
    return {
      ok: false,
      message: `An item named “${shortenForMessage(trimmed)}” already exists in this list.`,
    }
  }
  return { ok: true }
}

/** Google Sheet import: duplicate non-empty item texts in the same import fail entirely. */
export function validateImportSheetRowTextsUnique(rows: unknown): { ok: true } | { ok: false; message: string } {
  if (rows == null) return { ok: true }
  if (!Array.isArray(rows)) return { ok: true }

  const seen = new Set<string>()
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const textRaw = (raw as { text?: unknown }).text
    const text = typeof textRaw === 'string' ? textRaw : String(textRaw ?? '')
    const trimmed = text.trim()
    if (!trimmed) continue
    const n = normalizeItemTextForUniqueness(trimmed)
    if (seen.has(n)) {
      return {
        ok: false,
        message: `This import contains duplicate items (“${shortenForMessage(trimmed)}”). Remove duplicates in the sheet and try again.`,
      }
    }
    seen.add(n)
  }
  return { ok: true }
}

/** UI: restore draft / show toast for Dexie uniqueness failures (not connectivity). */
export function isLocalItemTextUniquenessFailure(message: string | undefined): boolean {
  if (!message) return false
  return (
    message.startsWith('An item named') ||
    message.startsWith('This import contains duplicate')
  )
}
