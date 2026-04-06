import { normalizeItemCategory } from '@/lib/supabase/types'

/** One row ready for `import_list_items` RPC */
export type SheetImportItemRow = {
  text: string
  sort_order: number
  category: number
  archived: boolean
  comment: string | null
}

export type ParseSheetCsvResult =
  | { ok: true; rows: SheetImportItemRow[] }
  | { ok: false; error: string }

function normalizeHeader(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Minimal CSV line parser (handles double-quoted fields with commas). */
export function splitCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let i = 0
  let inQuotes = false

  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
      rows.push(row)
    }
    row = []
  }

  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === ',') {
      pushField()
      i++
      continue
    }
    if (c === '\r') {
      i++
      continue
    }
    if (c === '\n') {
      pushField()
      pushRow()
      i++
      continue
    }
    field += c
    i++
  }
  pushField()
  if (row.length > 0) pushRow()
  return rows
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

function matchHeader(cell: string, canonical: string, maxDistance = 2): boolean {
  const n = normalizeHeader(cell)
  if (n === canonical) return true
  if (canonical === 'category' && levenshtein(n, 'category') <= maxDistance) return true
  return false
}

function columnIndex(headers: string[], predicate: (h: string) => boolean): number {
  return headers.findIndex(predicate)
}

function parseArchivedCell(raw: string | undefined): boolean {
  if (raw === undefined) return false
  const v = raw.trim().toLowerCase()
  return v === 'x' || v === 'yes' || v === 'true' || v === '1'
}

/**
 * Parse exported Google Sheet CSV. Expects a header row with Items (required);
 * archived / comments / category optional with defaults per product spec.
 */
export function parseSheetCsv(csvText: string): ParseSheetCsvResult {
  const trimmed = csvText.trim()
  if (!trimmed) {
    return { ok: false, error: 'Sheet is empty.' }
  }

  const table = splitCsvRows(trimmed)
  if (table.length < 2) {
    return { ok: false, error: 'Need a header row and at least one data row.' }
  }

  const headerCells = table[0].map(c => c.trim())
  const itemsIdx = columnIndex(headerCells, h => {
    const n = normalizeHeader(h)
    return n === 'items' || n === 'item'
  })
  if (itemsIdx === -1) {
    return { ok: false, error: 'No "Items" column found in the first row.' }
  }

  const archivedIdx = columnIndex(headerCells, h => matchHeader(h, 'archived', 0))
  const commentsIdx = columnIndex(headerCells, h => {
    const n = normalizeHeader(h)
    return n === 'comments' || n === 'comment'
  })
  const categoryIdx = columnIndex(headerCells, h => matchHeader(h, 'category'))

  const rows: SheetImportItemRow[] = []
  let sortOrder = 0

  for (let r = 1; r < table.length; r++) {
    const line = table[r]
    const itemText = (line[itemsIdx] ?? '').trim()
    if (!itemText) continue

    const archived =
      archivedIdx === -1 ? false : parseArchivedCell(line[archivedIdx])
    const commentRaw =
      commentsIdx === -1 ? '' : (line[commentsIdx] ?? '').trim()
    const comment = commentRaw === '' ? null : commentRaw

    let category = 1
    if (categoryIdx !== -1) {
      const catCell = (line[categoryIdx] ?? '').trim()
      category = catCell === '' ? 1 : normalizeItemCategory(catCell)
    }

    rows.push({
      text: itemText,
      sort_order: sortOrder,
      category,
      archived,
      comment,
    })
    sortOrder++
  }

  if (rows.length === 0) {
    return { ok: false, error: 'No items found (all rows were empty in the Items column).' }
  }

  return { ok: true, rows }
}

/** Pick a list name: API title if unique, else Import / Import 2 / … */
export function resolveImportListName(apiTitle: string | null | undefined, existingNames: string[]): string {
  const taken = new Set(existingNames.map(n => n.trim().toLowerCase()).filter(Boolean))
  const free = (name: string) => !taken.has(name.trim().toLowerCase())

  const primary = apiTitle?.trim()
  if (primary && free(primary)) return primary

  if (free('Import')) return 'Import'
  for (let i = 2; i < 10_000; i++) {
    const n = `Import ${i}`
    if (free(n)) return n
  }
  return `Import ${Date.now()}`
}
