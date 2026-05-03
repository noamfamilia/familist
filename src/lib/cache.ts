import type { ItemWithState, List, ListWithRole, MemberWithCreator } from '@/lib/supabase/types'
import { appendListDetailCacheDiagnostic } from '@/lib/offlineNavDiagnostics'

const MAX_CACHED_LISTS = 10
const CACHE_KEY_ACTIVE_USER = 'active_cache_user'
const CACHE_KEY_LISTS = 'cached_lists'
const CACHE_KEY_RECENT = 'recent_lists'

interface CachedLists {
  lists: ListWithRole[]
  cachedAt: number
}

/** Bump when on-disk shape changes; older entries still pass if structure is valid. */
export const LIST_DETAIL_CACHE_SCHEMA_VERSION = 1

export interface CachedListData {
  list: List
  items: ItemWithState[]
  members: MemberWithCreator[]
  cachedAt: number
  /** Written by setCachedList; absent on legacy caches. */
  cacheSchemaVersion?: number
}

export type ListDetailCacheBreakdown = {
  requestedListId: string
  passedUserId: string | null
  activeCacheUserId: string | null
  scopedUserId: string | null
  keyUsesExplicitPassedUser: boolean
  cacheKey: string | null
  rawExists: boolean
  rawLengthChars: number | null
  parseOk: boolean
  parseErrorSnippet: string | null
  rootIsObject: boolean
  schemaVersion: number | null
  schemaVersionOk: boolean
  listIsObject: boolean
  listIdInPayload: string | null
  listIdMatchesRequested: boolean
  itemsIsArray: boolean
  itemCount: number | null
  membersIsArray: boolean
  memberCount: number | null
  cachedAt: number | null
  cachedAtIsNumber: boolean
  prefsNote: string
  finalOk: boolean
  finalReason: string
}

export type ListDetailCacheValidation = {
  ok: boolean
  reason: string
  breakdown: ListDetailCacheBreakdown
  /** Populated when ok is true (sufficient offline list-detail payload). */
  data?: CachedListData
}

function finalizeBreakdown(b: Partial<ListDetailCacheBreakdown> & { requestedListId: string }): ListDetailCacheBreakdown {
  return {
    requestedListId: b.requestedListId,
    passedUserId: b.passedUserId ?? null,
    activeCacheUserId: b.activeCacheUserId ?? null,
    scopedUserId: b.scopedUserId ?? null,
    keyUsesExplicitPassedUser: b.keyUsesExplicitPassedUser ?? false,
    cacheKey: b.cacheKey ?? null,
    rawExists: b.rawExists ?? false,
    rawLengthChars: b.rawLengthChars ?? null,
    parseOk: b.parseOk ?? false,
    parseErrorSnippet: b.parseErrorSnippet ?? null,
    rootIsObject: b.rootIsObject ?? false,
    schemaVersion: b.schemaVersion ?? null,
    schemaVersionOk: b.schemaVersionOk ?? false,
    listIsObject: b.listIsObject ?? false,
    listIdInPayload: b.listIdInPayload ?? null,
    listIdMatchesRequested: b.listIdMatchesRequested ?? false,
    itemsIsArray: b.itemsIsArray ?? false,
    itemCount: b.itemCount ?? null,
    membersIsArray: b.membersIsArray ?? false,
    memberCount: b.memberCount ?? null,
    cachedAt: b.cachedAt ?? null,
    cachedAtIsNumber: b.cachedAtIsNumber ?? false,
    prefsNote: b.prefsNote ?? 'list prefs in separate keys; defaults if missing',
    finalOk: b.finalOk ?? false,
    finalReason: b.finalReason ?? 'unset',
  }
}

/**
 * Validates the list-detail offline blob (`cached_list_<user>_<listId>`), not the home summary (`cached_lists_*`).
 * Home list summaries never satisfy this check by design.
 */
export function validateListDetailOfflineCache(listId: string, userId?: string): ListDetailCacheValidation {
  const requestedListId = listId
  const passedUserId = userId ?? null
  const activeCacheUserId = typeof window === 'undefined' ? null : getActiveCacheUserId()
  const scopedUserId = resolveUserId(userId)
  const keyUsesExplicitPassedUser = typeof userId === 'string' && userId.length > 0
  const prefsNote = 'prefs not in blob; separate keys list_<user>_<listId>_prefs (defaults apply)'

  if (typeof window === 'undefined' || !scopedUserId) {
    const reason = typeof window === 'undefined' ? 'no_window' : 'no_user_scope'
    return {
      ok: false,
      reason,
      breakdown: finalizeBreakdown({
        requestedListId,
        passedUserId,
        activeCacheUserId,
        scopedUserId,
        keyUsesExplicitPassedUser,
        cacheKey: null,
        finalOk: false,
        finalReason: reason,
        prefsNote,
      }),
    }
  }

  const cacheKey = getCacheKey(scopedUserId, listId)
  let raw: string | null = null
  try {
    raw = localStorage.getItem(cacheKey)
  } catch {
    raw = null
  }
  const rawExists = raw != null && raw.length > 0
  const rawLengthChars = raw == null ? null : raw.length

  if (!rawExists) {
    const reason = 'no_raw_entry'
    return {
      ok: false,
      reason,
      breakdown: finalizeBreakdown({
        requestedListId,
        passedUserId,
        activeCacheUserId,
        scopedUserId,
        keyUsesExplicitPassedUser,
        cacheKey,
        rawExists: false,
        rawLengthChars,
        finalOk: false,
        finalReason: reason,
        prefsNote,
      }),
    }
  }

  let parsed: unknown
  let parseOk = false
  let parseErrorSnippet: string | null = null
  try {
    parsed = JSON.parse(raw!)
    parseOk = true
  } catch (e) {
    parseErrorSnippet = e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120)
    const reason = 'json_parse_failed'
    return {
      ok: false,
      reason,
      breakdown: finalizeBreakdown({
        requestedListId,
        passedUserId,
        activeCacheUserId,
        scopedUserId,
        keyUsesExplicitPassedUser,
        cacheKey,
        rawExists: true,
        rawLengthChars,
        parseOk: false,
        parseErrorSnippet,
        finalOk: false,
        finalReason: reason,
        prefsNote,
      }),
    }
  }

  const rootIsObject = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
  if (!rootIsObject) {
    const reason = 'root_not_plain_object'
    return {
      ok: false,
      reason,
      breakdown: finalizeBreakdown({
        requestedListId,
        passedUserId,
        activeCacheUserId,
        scopedUserId,
        keyUsesExplicitPassedUser,
        cacheKey,
        rawExists: true,
        rawLengthChars,
        parseOk: true,
        rootIsObject: false,
        finalOk: false,
        finalReason: reason,
        prefsNote,
      }),
    }
  }

  const root = parsed as Record<string, unknown>
  const schemaVersionRaw = root.cacheSchemaVersion
  const schemaVersion =
    typeof schemaVersionRaw === 'number' && Number.isFinite(schemaVersionRaw) ? schemaVersionRaw : null
  const schemaVersionOk = schemaVersion == null || schemaVersion === LIST_DETAIL_CACHE_SCHEMA_VERSION

  const listRaw = root.list
  const listIsObject =
    listRaw !== null && typeof listRaw === 'object' && !Array.isArray(listRaw)
  const listIdInPayload =
    listIsObject && typeof (listRaw as { id?: unknown }).id === 'string'
      ? ((listRaw as { id: string }).id)
      : null
  const listIdMatchesRequested = listIdInPayload === requestedListId

  const itemsRaw = root.items
  const itemsIsArray = Array.isArray(itemsRaw)
  const itemCount = itemsIsArray ? (itemsRaw as unknown[]).length : null

  const membersRaw = root.members
  const membersIsArray = Array.isArray(membersRaw)
  const memberCount = membersIsArray ? (membersRaw as unknown[]).length : null

  const cat = root.cachedAt
  const cachedAt = typeof cat === 'number' && Number.isFinite(cat) ? cat : null
  const cachedAtIsNumber = cachedAt != null

  let failureReason = ''
  if (!schemaVersionOk) failureReason = 'schema_version_mismatch'
  else if (!listIsObject) failureReason = 'missing_or_invalid_list'
  else if (!listIdInPayload) failureReason = 'list_missing_id'
  else if (!listIdMatchesRequested) failureReason = 'list_id_mismatch'
  else if (!itemsIsArray) failureReason = 'items_not_array'
  else if (!membersIsArray) failureReason = 'members_not_array'

  const structureOk = !failureReason
  const finalOk = structureOk
  const finalReason = finalOk
    ? (cachedAtIsNumber ? 'valid' : 'valid_legacy_no_cachedAt')
    : failureReason

  const breakdown = finalizeBreakdown({
    requestedListId,
    passedUserId,
    activeCacheUserId,
    scopedUserId,
    keyUsesExplicitPassedUser,
    cacheKey,
    rawExists: true,
    rawLengthChars,
    parseOk: true,
    rootIsObject: true,
    schemaVersion,
    schemaVersionOk,
    listIsObject,
    listIdInPayload,
    listIdMatchesRequested,
    itemsIsArray,
    itemCount,
    membersIsArray,
    memberCount,
    cachedAt,
    cachedAtIsNumber,
    finalOk,
    finalReason,
    prefsNote,
  })

  if (!finalOk) {
    return { ok: false, reason: finalReason, breakdown }
  }

  const data: CachedListData = {
    list: listRaw as List,
    items: itemsRaw as ItemWithState[],
    members: membersRaw as MemberWithCreator[],
    cachedAt: cachedAt ?? 0,
    cacheSchemaVersion: schemaVersion ?? undefined,
  }
  return { ok: true, reason: finalReason, breakdown, data }
}

/** Append a multi-line cache validation report to the diagnostics panel (when sink is registered). */
export function logListDetailCacheValidation(listId: string, userId?: string, label = '[list-detail-cache]'): void {
  const { ok, reason, breakdown } = validateListDetailOfflineCache(listId, userId)
  const lines = [
    `${label}`,
    `requestedListId=${breakdown.requestedListId}`,
    `cacheKey=${breakdown.cacheKey ?? '(null)'}`,
    `passedUserId=${breakdown.passedUserId ?? 'null'} activeCacheUserId=${breakdown.activeCacheUserId ?? 'null'} scopedUserId=${breakdown.scopedUserId ?? 'null'} keyUsesExplicitPassedUser=${breakdown.keyUsesExplicitPassedUser ? 1 : 0}`,
    `rawExists=${breakdown.rawExists ? 1 : 0} rawLengthChars=${breakdown.rawLengthChars ?? 'n/a'}`,
    `parseOk=${breakdown.parseOk ? 1 : 0} parseError=${breakdown.parseErrorSnippet ?? 'none'}`,
    `rootIsObject=${breakdown.rootIsObject ? 1 : 0}`,
    `schemaVersion=${breakdown.schemaVersion ?? 'absent'} schemaVersionOk=${breakdown.schemaVersionOk ? 1 : 0}`,
    `listIsObject=${breakdown.listIsObject ? 1 : 0} listIdInPayload=${breakdown.listIdInPayload ?? 'null'} listIdMatchesRequested=${breakdown.listIdMatchesRequested ? 1 : 0}`,
    `itemsIsArray=${breakdown.itemsIsArray ? 1 : 0} itemCount=${breakdown.itemCount ?? 'n/a'}`,
    `membersIsArray=${breakdown.membersIsArray ? 1 : 0} memberCount=${breakdown.memberCount ?? 'n/a'}`,
    `cachedAt=${breakdown.cachedAt ?? 'absent'} cachedAtIsNumber=${breakdown.cachedAtIsNumber ? 1 : 0}`,
    `prefsNote=${breakdown.prefsNote}`,
    `cachedListDataExists=${ok ? 1 : 0} finalReason=${reason}`,
  ]
  appendListDetailCacheDiagnostic(lines.join('\n'))
}

function getListsKey(userId: string) {
  return `${CACHE_KEY_LISTS}_${userId}`
}

function getRecentKey(userId: string) {
  return `${CACHE_KEY_RECENT}_${userId}`
}

function getCacheKey(userId: string, listId: string) {
  return `cached_list_${userId}_${listId}`
}

export function getActiveCacheUserId() {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(CACHE_KEY_ACTIVE_USER)
  } catch {
    return null
  }
}

export function setActiveCacheUserId(userId: string) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(CACHE_KEY_ACTIVE_USER, userId)
  } catch {
    // Ignore errors
  }
}

export function clearActiveCacheUserId() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(CACHE_KEY_ACTIVE_USER)
  } catch {
    // Ignore errors
  }
}

function resolveUserId(userId?: string) {
  return userId || getActiveCacheUserId()
}

export function getCachedLists(userId?: string): CachedLists | null {
  const scopedUserId = resolveUserId(userId)
  if (!scopedUserId) return null
  if (typeof window === 'undefined') return null
  try {
    const cached = localStorage.getItem(getListsKey(scopedUserId))
    return cached ? JSON.parse(cached) : null
  } catch {
    return null
  }
}

export function setCachedLists(userId: string | undefined, lists: ListWithRole[]) {
  const scopedUserId = resolveUserId(userId)
  if (!scopedUserId) return
  if (typeof window === 'undefined') return
  try {
    const data: CachedLists = {
      lists,
      cachedAt: Date.now()
    }
    localStorage.setItem(getListsKey(scopedUserId), JSON.stringify(data))
  } catch {
    // Storage full or other error - ignore
  }
}

export function getCachedList(userId: string | undefined, listId: string): CachedListData | null {
  const v = validateListDetailOfflineCache(listId, userId)
  return v.ok ? (v.data ?? null) : null
}

/** True only when list-detail blob is valid JSON with list/items/members sufficient for offline list page. */
export function cachedListDataExists(listId: string, userId?: string): boolean {
  return validateListDetailOfflineCache(listId, userId).ok
}

export function setCachedList(userId: string | undefined, listId: string, data: Omit<CachedListData, 'cachedAt'>) {
  const scopedUserId = resolveUserId(userId)
  if (!scopedUserId) return
  if (typeof window === 'undefined') return
  try {
    const cacheData: CachedListData = {
      ...data,
      cachedAt: Date.now(),
      cacheSchemaVersion: LIST_DETAIL_CACHE_SCHEMA_VERSION,
    }
    localStorage.setItem(getCacheKey(scopedUserId, listId), JSON.stringify(cacheData))
    updateRecentLists(scopedUserId, listId)
  } catch {
    // Storage full or other error - ignore
  }
}

export function removeCachedList(userId: string | undefined, listId: string) {
  const scopedUserId = resolveUserId(userId)
  if (!scopedUserId) return
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(getCacheKey(scopedUserId, listId))
    // Also remove from recent lists
    const recent = getRecentLists(scopedUserId)
    const updated = recent.filter(id => id !== listId)
    localStorage.setItem(getRecentKey(scopedUserId), JSON.stringify(updated))
  } catch {
    // Ignore errors
  }
}

const CACHE_KEY_LABEL_FILTER = 'label_filter'

function getLabelFilterKey(userId: string) {
  return `${CACHE_KEY_LABEL_FILTER}_${userId}`
}

export function getCachedLabelFilter(userId?: string): string | null {
  const scopedUserId = resolveUserId(userId)
  if (!scopedUserId) return null
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(getLabelFilterKey(scopedUserId))
  } catch {
    return null
  }
}

export function setCachedLabelFilter(label: string, userId?: string) {
  const scopedUserId = resolveUserId(userId)
  if (!scopedUserId) return
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(getLabelFilterKey(scopedUserId), label)
  } catch {
    // Ignore errors
  }
}

function getRecentLists(userId: string): string[] {
  try {
    const cached = localStorage.getItem(getRecentKey(userId))
    return cached ? JSON.parse(cached) : []
  } catch {
    return []
  }
}

function updateRecentLists(userId: string, listId: string) {
  try {
    let recent = getRecentLists(userId)
    
    // Remove if already exists (will be added to front)
    recent = recent.filter(id => id !== listId)
    
    // Add to front
    recent.unshift(listId)
    
    // If over limit, evict oldest
    if (recent.length > MAX_CACHED_LISTS) {
      const evicted = recent.pop()
      if (evicted) {
        localStorage.removeItem(getCacheKey(userId, evicted))
      }
    }
    
    localStorage.setItem(getRecentKey(userId), JSON.stringify(recent))
  } catch {
    // Ignore errors
  }
}
