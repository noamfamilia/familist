/** Query param used on `/` to open list detail in a full-screen modal (no `/list/[id]` route transition). */
export const LIST_QUERY_PARAM = 'list' as const

/** Build `/?list=<id>&…` preserving other query keys (e.g. `invite`). */
export function buildListOpenHref(listId: string, existingSearch?: string): string {
  const next = new URLSearchParams(existingSearch ?? (typeof window !== 'undefined' ? window.location.search : ''))
  next.set(LIST_QUERY_PARAM, listId)
  const q = next.toString()
  return `/?${q}`
}

/** Remove `list` from the current search string; returns `/` or `/?…` without `list`. */
export function stripListQueryFromHref(searchParams: URLSearchParams): string {
  const next = new URLSearchParams(searchParams.toString())
  next.delete(LIST_QUERY_PARAM)
  const q = next.toString()
  return q ? `/?${q}` : '/'
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isLikelyListId(raw: string | null): raw is string {
  return !!raw && UUID_RE.test(raw.trim())
}
