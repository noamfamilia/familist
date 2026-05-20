/**
 * Static audit: places where the home catalog can appear empty after sign-out.
 * Logged once per sign-out debug session (see logHomeCatalogEmptyPathsAudit).
 */
export const HOME_CATALOG_EMPTY_PATHS_AUDIT = [
  {
    file: 'src/hooks/useLists.ts',
    condition: 'loading = userId && lists.length===0 && listsCatalogStatus==="loading" && !error',
    canEmptyAfterSignOutWithStoreFull:
      'YES if hook lists[] is stale/empty while Zustand has rows — UI shows Spinner (ListsView) even though store has 2 lists',
  },
  {
    file: 'src/components/lists/ListsView.tsx',
    condition: 'if (loading) return <Spinner />',
    canEmptyAfterSignOutWithStoreFull:
      'YES — same as useLists.loading; blocks all cards when true',
  },
  {
    file: 'src/components/lists/ListsView.tsx',
    condition: 'filteredLists = lists.filter(viewMode, searchText, selectedLabel, isCreating)',
    canEmptyAfterSignOutWithStoreFull:
      'YES if label filter (selectedLabel !== Any) or search text hides all; lists.length can still be 2',
  },
  {
    file: 'src/components/lists/ListsView.tsx',
    condition: 'activeLists = filteredLists where !userArchived',
    canEmptyAfterSignOutWithStoreFull:
      'YES if all lists userArchived; empty cards but lists.length > 0',
  },
  {
    file: 'src/components/lists/ListsView.tsx',
    condition: 'lists.length === 0 empty-state message',
    canEmptyAfterSignOutWithStoreFull:
      'Only if hook lists.length is 0 — not if filters zeroed visible cards only',
  },
  {
    file: 'src/app/page.tsx',
    condition: '!showListsShell (!effectiveUserId) — ListsView not mounted',
    canEmptyAfterSignOutWithStoreFull:
      'Unlikely after sign-out if guestId/bootstrap set; would show shell placeholder not ListsView',
  },
  {
    file: 'src/app/page.tsx',
    condition: 'hasMounted || (loading && !effectiveUserId) full-page spinner',
    canEmptyAfterSignOutWithStoreFull:
      'Unlikely when guest effectiveUserId exists; auth loading gate not useLists loading',
  },
  {
    file: 'src/hooks/useLists.ts',
    condition: 'useListsCatalogStore useShallow(s => s.lists) — React subscription',
    canEmptyAfterSignOutWithStoreFull:
      'YES if component render uses [] while getState() has 2 — subscription/render desync hypothesis',
  },
  {
    file: 'src/stores/listsCatalogStore.ts',
    condition: 'applyL2BridgePayload / second bootstrap clears lists',
    canEmptyAfterSignOutWithStoreFull:
      'Store would show empty in snapshots too — ruled out if delayed snapshots stay at 2',
  },
] as const

import { signOutCatalogDebugLog } from '@/lib/debug/signOutCatalogDebug'

export function logHomeCatalogEmptyPathsAudit(): void {
  signOutCatalogDebugLog('audit', 'home catalog empty-paths (static)', {
    paths: HOME_CATALOG_EMPTY_PATHS_AUDIT,
  })
}
