'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { isLikelyListId, LIST_QUERY_PARAM, stripListQueryFromHref } from '@/lib/navigation/listQuery'
import { useActiveListUiStore } from '@/stores/activeListUiStore'
import { useAuth } from '@/providers/AuthProvider'
import { ListsView } from '@/components/lists/ListsView'
import { ThemedImage } from '@/components/ui/ThemedImage'
import { ProfileModal } from '@/components/profile/ProfileModal'
import { ListDetailHomeOverlay } from '@/components/lists/ListDetailHomeOverlay'

import { Suspense, useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { log, perfLog } from '@/lib/startupPerfLog'
import { useTheme } from 'next-themes'
import dynamic from 'next/dynamic'
import type { Step } from 'react-joyride'
import { clearPendingInviteToken, setPendingInviteToken } from '@/lib/invite'
import { resetTutorial } from '@/components/ui/TutorialTour'
import { db } from '@/lib/db'
import { enqueueSyncQueueRecord, userQueueParent } from '@/lib/data/syncQueue'
import { isoNow, syncFieldsForLocalInsert } from '@/lib/data/base_sync_fields'
import { normalizeServerSyncableFields } from '@/lib/data/serverDexieParity'
import { useToast } from '@/components/ui/Toast'
import { getCachedLabelFilter, setCachedLabelFilter } from '@/lib/cache'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { OfflineIcon } from '@/components/icons/OfflineIcon'
import { useMenuOpenAnimation } from '@/hooks/useMenuOpenAnimation'
import { useHasMounted } from '@/hooks/useHasMounted'
import { useShallow } from 'zustand/react/shallow'

const AuthModal = dynamic(() => import('@/components/auth/AuthModal').then(mod => mod.AuthModal), {
  ssr: false,
})
const Modal = dynamic(() => import('@/components/ui/Modal').then(mod => mod.Modal), {
  ssr: false,
})
const ServerQueueModal = dynamic(() => import('@/components/home/ServerQueueModal').then(mod => mod.ServerQueueModal), {
  ssr: false,
})

// All home tour steps - list steps only shown when lists exist
const homeTourSteps: Step[] = [
  {
    target: '[data-tour="home-profile-menu"]',
    content: 'App settings',
    disableBeacon: true,
  },
  {
    target: '[data-tour="home-label-filter"]',
    content: 'Show lists by labels (open list menu to edit its label)',
  },
  {
    target: '[data-tour="create-list"]',
    content: 'Create a new list.',
  },
  {
    target: '[data-tour="list-card"]',
    content: 'Click list to view and manage items',
  },
  {
    target: '[data-tour="list-drag-handle"]',
    content: 'Drag to re-arrange lists.',
    spotlightPadding: 2,
  },
  // List-specific steps - only shown when list targets exist
  {
    target: '[data-tour="list-archive"]',
    content: 'Use ▼/▲ to archive/restore a list.',
    spotlightPadding: 2,
  },
  {
    target: '[data-tour="list-menu"]',
    content: 'List menu options',
    spotlightPadding: 2,
  },
]

function browserPathSearchHash(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

function HomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, profile, loading, bootstrapUserId, profileFetchPhase, updateProfile } = useAuth()
  const {
    offlineAssetsReady,
    online,
    internetReachable,
    isOffline,
  } = useConnectivity()
  const [showAuthModal, setShowAuthModal] = useState(false)
  const inviteToken = searchParams.get('invite')
  const { activeListId, setActiveListId } = useActiveListUiStore(
    useShallow((s) => ({ activeListId: s.activeListId, setActiveListId: s.setActiveListId })),
  )
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [showServerQueue, setShowServerQueue] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')
  const [submittingFeedback, setSubmittingFeedback] = useState(false)
  const { success, error: showError } = useToast()
  const { resolvedTheme, setTheme } = useTheme()
  const hasMounted = useHasMounted()
  const [themeMounted, setThemeMounted] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const [selectedLabel, setSelectedLabel] = useState('Any')
  const labelSyncedRef = useRef(false)
  const [labelDropdownOpen, setLabelDropdownOpen] = useState(false)
  const [availableLabels, setAvailableLabels] = useState<string[]>([])
  const labelDropdownRef = useRef<HTMLDivElement>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [preCreateFilter, setPreCreateFilter] = useState<string | null>(null)
  const [localLabels, setLocalLabels] = useState<string[]>([])
  const [addingLabel, setAddingLabel] = useState(false)
  const [newLabelText, setNewLabelText] = useState('')
  const [labelManagerOpen, setLabelManagerOpen] = useState(false)
  const [isOfflineActionsDisabled, setIsOfflineActionsDisabled] = useState(false)
  const addLabelInputRef = useRef<HTMLInputElement>(null)
  const addLabelPopoverRef = useRef<HTMLDivElement>(null)

  const profileMenuAnim = useMenuOpenAnimation(profileMenuOpen)
  const labelDropdownAnim = useMenuOpenAnimation(labelDropdownOpen)
  const addLabelHomeAnim = useMenuOpenAnimation(addingLabel && !labelDropdownOpen)

  useLayoutEffect(() => {
    perfLog('main page mounted', { route: 'home' })
  }, [])

  const homeGatePrevRef = useRef<string>('')
  useEffect(() => {
    const profileLoading = profileFetchPhase === 'loading'
    const authReady = !loading
    const effectiveUserId = user?.id ?? (loading ? bootstrapUserId : null)
    const shouldRenderListsView = !!effectiveUserId
    let reasonIfNot = ''
    if (!shouldRenderListsView) {
      if (loading && !bootstrapUserId) reasonIfNot = 'auth.loading_no_bootstrapUserId'
      else if (!user && !loading) reasonIfNot = '!user_session_resolved'
      else reasonIfNot = 'unknown'
    } else if (!user && effectiveUserId) {
      reasonIfNot = 'lists_via_dexie_user_id_ready'
    } else {
      reasonIfNot = 'user_ok'
    }

    const snapshot = JSON.stringify({
      loading,
      hasUser: !!user,
      userId: user?.id ?? null,
      effectiveUserId,
      bootstrapUserId,
      profileLoading,
      hasProfile: !!profile,
      profileFetchPhase,
      authReady,
      profileReady: !!profile,
      offlineAssetsReady,
      shouldRenderListsView,
      reasonIfNot,
    })
    if (snapshot === homeGatePrevRef.current) return
    homeGatePrevRef.current = snapshot
    perfLog('HomeContent gate', JSON.parse(snapshot) as Record<string, unknown>)
  }, [
    loading,
    user,
    profile,
    bootstrapUserId,
    profileFetchPhase,
    offlineAssetsReady,
  ])

  useEffect(() => {
    setThemeMounted(true)
  }, [])

  useEffect(() => {
    const cachedLabel = getCachedLabelFilter()
    if (cachedLabel !== null) {
      setSelectedLabel(cachedLabel)
      return
    }
    if (profile?.label_filter) {
      setSelectedLabel(profile.label_filter)
    }
  // Intentionally run once after mount to avoid SSR/client init drift.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (profile && !labelSyncedRef.current) {
      labelSyncedRef.current = true
      const serverLabel = profile.label_filter ?? 'Any'
      const cacheUserId = user?.id ?? bootstrapUserId ?? undefined
      const cachedRaw = getCachedLabelFilter(cacheUserId)
      const cached =
        cachedRaw !== null && cachedRaw !== undefined && cachedRaw !== '' ? cachedRaw : null
      const effective = cached ?? serverLabel
      setSelectedLabel(effective)
      setCachedLabelFilter(effective, cacheUserId)
      if (user && effective !== serverLabel && !isOfflineActionsDisabled) {
        void updateProfile({ label_filter: effective })
      }
    }
  }, [profile, user, bootstrapUserId, isOfflineActionsDisabled, updateProfile])

  useEffect(() => {
    if (isCreating) {
      setPreCreateFilter(selectedLabel)
      if (selectedLabel === 'Any') {
        setSelectedLabel('')
      }
    } else if (preCreateFilter !== null) {
      setSelectedLabel(preCreateFilter)
      setPreCreateFilter(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreating])

  useEffect(() => {
    if (!inviteToken) return
    setPendingInviteToken(inviteToken)
  }, [inviteToken])

  useEffect(() => {
    const sheet = searchParams.get('sheet')
    if (sheet && user) {
      setShowImport(true)
      const url = new URL(window.location.href)
      url.searchParams.delete('sheet')
      const search = url.searchParams.toString()
      router.replace(`${url.pathname}${search ? `?${search}` : ''}`)
    }
  }, [searchParams, user, router])

  useEffect(() => {
    if (!loading && !user && inviteToken) {
      setShowAuthModal(true)
    }
  }, [loading, user, inviteToken])

  useEffect(() => {
    if (!profileMenuOpen) return
    const close = (e: MouseEvent) => {
      const el = profileMenuRef.current
      if (el && !el.contains(e.target as Node)) setProfileMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [profileMenuOpen])

  useEffect(() => {
    if (!profileMenuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProfileMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [profileMenuOpen])

  useEffect(() => {
    if (!labelDropdownOpen) return
    const close = (e: MouseEvent) => {
      if (labelDropdownRef.current && !labelDropdownRef.current.contains(e.target as Node)) {
        e.preventDefault()
        e.stopPropagation()
        document.addEventListener('click', (ce) => { ce.preventDefault(); ce.stopPropagation() }, { capture: true, once: true })
        setLabelDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', close, true)
    return () => document.removeEventListener('mousedown', close, true)
  }, [labelDropdownOpen])

  // Focus add-label input when it opens
  useEffect(() => {
    if (addingLabel && addLabelInputRef.current) {
      addLabelInputRef.current.focus()
    }
  }, [addingLabel])

  // Outside-click: cancel add-label popover
  useEffect(() => {
    if (!addingLabel || labelDropdownOpen) return
    const handleMouseDown = (e: MouseEvent) => {
      if (addLabelPopoverRef.current && !addLabelPopoverRef.current.contains(e.target as Node)) {
        e.preventDefault()
        e.stopPropagation()
        document.addEventListener('click', (ce) => { ce.preventDefault(); ce.stopPropagation() }, { capture: true, once: true })
        setAddingLabel(false)
        setNewLabelText('')
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true)
    return () => document.removeEventListener('mousedown', handleMouseDown, true)
  })

  const handleAddLabelDone = () => {
    const trimmed = newLabelText.trim()
    if (trimmed && trimmed.toLowerCase() !== 'any') {
      handleSelectLabel(trimmed)
      if (!availableLabels.includes(trimmed)) {
        setLocalLabels(prev => prev.includes(trimmed) ? prev : [...prev, trimmed])
      }
    }
    setAddingLabel(false)
    setNewLabelText('')
  }

  

  const handleSelectLabel = useCallback(
    (label: string) => {
      const cacheUserId = user?.id ?? bootstrapUserId ?? undefined
      setSelectedLabel(label)
      setCachedLabelFilter(label, cacheUserId)
      if (user && !isOfflineActionsDisabled) {
        void updateProfile({ label_filter: label })
      }
    },
    [bootstrapUserId, isOfflineActionsDisabled, updateProfile, user],
  )

  const handleLabelsChange = useCallback((labels: string[]) => {
    setAvailableLabels(labels)
  }, [])

  useEffect(() => {
    if (!isOffline) return
    setShowImport(false)
  }, [isOffline])

  const handleOfflineActionsDisabledChange = useCallback((offline: boolean) => {
    setIsOfflineActionsDisabled(offline)
  }, [])

  // Auto-cleanup local labels that now exist on the server
  useEffect(() => {
    setLocalLabels(prev => prev.filter(l => !availableLabels.includes(l)))
  }, [availableLabels])

  const allLabels = [...availableLabels, ...localLabels.filter(l => !availableLabels.includes(l))]

  useEffect(() => {
    if (availableLabels.length === 0) return
    if (selectedLabel !== 'Any' && selectedLabel !== '' && !allLabels.includes(selectedLabel)) {
      setSelectedLabel('Any')
    }
  }, [availableLabels, localLabels, selectedLabel])

  const clearInviteState = useCallback(() => {
    handleSelectLabel('Any')
    clearPendingInviteToken()

    if (typeof window === 'undefined') return

    const url = new URL(window.location.href)
    url.searchParams.delete('invite')
    const search = url.searchParams.toString()
    router.replace(`${url.pathname}${search ? `?${search}` : ''}${url.hash}`)
  }, [handleSelectLabel, router])

  /** Legacy `/?list=<uuid>` opens the modal then strips the param so the shell stays on `/`. */
  useEffect(() => {
    const raw = searchParams.get(LIST_QUERY_PARAM)
    if (!isLikelyListId(raw)) return
    setActiveListId(raw)
    router.replace(stripListQueryFromHref(searchParams))
  }, [router, searchParams, setActiveListId])

  const closeListModal = useCallback(() => {
    setActiveListId(null)
  }, [setActiveListId])

  /** System / browser Back after `pushState` to `/list/[id]`: clear modal so the user stays in-app on `/`. */
  useEffect(() => {
    if (!activeListId) return

    const onPopState = () => {
      const openId = useActiveListUiStore.getState().activeListId
      if (!openId) return
      const listPath = `/list/${openId}`
      if (browserPathSearchHash() !== listPath) {
        useActiveListUiStore.getState().setActiveListId(null)
      }
    }

    window.addEventListener('popstate', onPopState, true)
    return () => window.removeEventListener('popstate', onPopState, true)
  }, [activeListId])

  const effectiveUserId = user?.id ?? bootstrapUserId
  const showListsShell = !!effectiveUserId
  const homeGateLogPrevRef = useRef<string>('')
  useEffect(() => {
    const payload = {
      shouldRender: showListsShell,
      online,
      internetReachable: internetReachable === true,
      authReady: !loading,
    }
    const snapshot = JSON.stringify(payload)
    if (snapshot === homeGateLogPrevRef.current) return
    homeGateLogPrevRef.current = snapshot
    log.info('GATE', 'HomeContent', payload)
  }, [internetReachable, loading, online, showListsShell])

  if (!hasMounted || (loading && !effectiveUserId)) {
    return (
      <div className="bg-white dark:bg-neutral-800 rounded-none sm:rounded-xl shadow-none sm:shadow-lg dark:shadow-black/40 p-8 w-full sm:min-w-[300px] min-h-screen sm:min-h-0 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal"></div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-neutral-800 rounded-none sm:rounded-xl shadow-none sm:shadow-lg dark:shadow-black/40 w-full sm:w-[450px] max-w-4xl min-h-screen sm:min-h-0 px-4 pb-4 pt-6 sm:p-8 relative">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-4">
        {/* Auth button - top left */}
        {user ? (
          <div className="relative flex items-center gap-1.5" ref={profileMenuRef} data-tour="home-profile-menu">
            {isOffline ? <OfflineIcon className="h-6 w-6 shrink-0" aria-hidden /> : null}
            <button
              type="button"
              onClick={() => setProfileMenuOpen(o => !o)}
              className="h-8 flex items-center rounded-lg hover:opacity-80"
              aria-label="Account menu"
              aria-expanded={profileMenuOpen}
              aria-haspopup="menu"
              title={user.email}
            >
              <ThemedImage src="/profile.png" alt="" width={32} height={32} className="w-8 h-8" />
            </button>
            {profileMenuAnim.mounted && (
              <div
                className={`absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-neutral-600 dark:bg-neutral-900 dark:shadow-black/40 ${profileMenuAnim.menuClassName}`}
                role="menu"
              >
                <button
                  type="button"
                  className="w-full text-left block px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-neutral-800"
                  role="menuitem"
                  onClick={() => { setProfileMenuOpen(false); setShowProfile(true) }}
                >
                  Profile settings
                </button>
                <button
                  type="button"
                  className="w-full text-left block px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-neutral-800"
                  role="menuitem"
                  onClick={() => {
                    const prev: 'light' | 'dark' =
                      themeMounted && resolvedTheme === 'dark' ? 'dark' : 'light'
                    const next: 'light' | 'dark' = prev === 'dark' ? 'light' : 'dark'
                    setProfileMenuOpen(false)
                    setTheme(next)
                    void updateProfile({ theme: next }).then(({ error: themeErr }) => {
                      if (themeErr) {
                        setTheme(prev)
                        showError(themeErr.message || 'Could not save theme')
                      }
                    })
                  }}
                >
                  {themeMounted && resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
                </button>
                <button
                  type="button"
                  disabled={isOffline}
                  className={`w-full text-left block px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-neutral-800 ${
                    isOffline
                      ? 'cursor-not-allowed text-gray-400 opacity-50 dark:text-gray-500'
                      : 'text-gray-900 dark:text-gray-100'
                  }`}
                  role="menuitem"
                  onClick={() => {
                    if (isOffline) return
                    setProfileMenuOpen(false)
                    setShowImport(true)
                  }}
                  title={isOffline ? 'Requires an internet connection' : undefined}
                >
                  Import from Google Sheet
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-neutral-800"
                  onClick={() => {
                    setProfileMenuOpen(false)
                    resetTutorial('home')
                    resetTutorial('list')
                    window.location.reload()
                  }}
                >
                  Replay tutorial
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-neutral-800"
                  onClick={() => {
                    setProfileMenuOpen(false)
                    setShowFeedback(true)
                  }}
                >
                  User feedback
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-neutral-800"
                  onClick={() => {
                    setProfileMenuOpen(false)
                    setShowServerQueue(true)
                  }}
                >
                  Server queue
                </button>
              </div>
            )}
          </div>
        ) : loading && bootstrapUserId ? (
          <div
            className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-gray-200 dark:bg-neutral-600"
            title="Restoring session…"
            aria-label="Restoring session"
          />
        ) : (
          <button
            onClick={() => setShowAuthModal(true)}
            className="h-8 flex items-center text-sm text-teal font-medium hover:bg-teal-light px-2 py-1 rounded"
            aria-label="Sign in"
          >
            Sign in
          </button>
        )}
        
        {showListsShell ? (
            <div ref={labelDropdownRef} data-tour="home-label-filter" className="flex items-center gap-1.5">
            {isCreating && <span className="text-red-500 text-sm font-medium whitespace-nowrap">Set label</span>}
            <div className="relative">
              <button
                type="button"
                onClick={() => { setLabelDropdownOpen(o => !o); setAddingLabel(false); setNewLabelText('') }}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-sm font-medium bg-white dark:bg-neutral-900 ${
                  isCreating ? 'text-red-500 border border-red-500' : 'text-teal border border-teal'
                }`}
              >
                <svg className="h-8 w-8 flex-shrink-0 -my-1.5" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                  <path d="M746.5 575.9L579.2 743.6l-173-173.5-53.3-112.4 108.3-108.6 112.2 53.4z" fill="#FBBA22" />
                  <path d="M579.4 389.9l-112.2-53.4c-5.3-2.5-11.6-1.4-15.8 2.7L435 355.7c-85.5-108.1-150.2-83.1-152.9-82-5 2-8.4 6.7-8.8 12.1-4.6 72.2 38.2 118.1 86.8 145l-17 17c-4.2 4.2-5.3 10.5-2.7 15.8L393.7 576c0.7 1.4 1.6 2.8 2.7 3.9l173.1 173.5c5.4 5.4 14.2 5.4 19.7 0l167.3-167.6c2.6-2.6 4.1-6.2 4.1-9.9s-1.5-7.2-4.1-9.9L583.3 392.6c-1.2-1.1-2.5-2-3.9-2.7z m-278.7-91.5c17.3-0.6 58.8 5.9 114 76.6 0.1 0.2 0.3 0.3 0.5 0.5l-34.7 34.8c-38.8-19.1-78.8-53-79.8-111.9z m426.1 277.5L579.2 723.8 417.7 562l-48-101.4 17-17c14 5.8 27.9 10.1 40.7 13.1 1.1 4.7 3.5 9.3 7.2 13a27.22 27.22 0 0 0 38.6 0c10.7-10.7 10.7-28 0-38.7-10.3-10.3-26.6-10.6-37.3-1.1-7.5-1.8-17.1-4.4-27.6-8l55.8-55.9 101.2 48 161.5 161.9z" className="fill-gray-800 dark:fill-gray-200" />
                </svg>
                {selectedLabel === '' ? <span className="text-gray-400">None</span> : selectedLabel}
                <svg className={`h-3 w-3 ${labelDropdownOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>

              {labelDropdownAnim.mounted && (
                <div
                  className={`absolute right-0 z-50 mt-1 min-w-[160px] overflow-hidden rounded-lg border bg-white shadow-lg dark:bg-neutral-900 dark:shadow-black/40 ${labelDropdownAnim.menuClassName} ${
                    isCreating ? 'border-red-500' : 'border-teal'
                  }`}
                >
                  {!isCreating && (
                    <button
                      type="button"
                      onClick={() => { handleSelectLabel('Any'); setLabelDropdownOpen(false) }}
                      className={`w-full text-left px-4 py-2 text-sm ${
                        selectedLabel === 'Any' ? 'bg-teal/10 text-teal font-semibold' : 'text-teal hover:bg-gray-50 dark:hover:bg-neutral-800'
                      }`}
                    >
                      Any
                    </button>
                  )}
                  {allLabels.map(l => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => { handleSelectLabel(l); setLabelDropdownOpen(false) }}
                      className={`w-full text-left px-4 py-2 text-sm ${
                        selectedLabel === l ? 'bg-teal/10 text-teal font-semibold' : 'text-teal hover:bg-gray-50 dark:hover:bg-neutral-800'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => { handleSelectLabel(''); setLabelDropdownOpen(false) }}
                    className={`w-full text-left px-4 py-2 text-sm ${
                      selectedLabel === '' ? 'bg-teal/10 text-teal font-semibold' : 'text-gray-400 hover:bg-gray-50 dark:hover:bg-neutral-800'
                    }`}
                  >
                    None
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLabelDropdownOpen(false); setAddingLabel(true) }}
                    className="w-full text-left px-4 py-2 text-sm text-teal hover:bg-gray-50 dark:hover:bg-neutral-800 border-t border-gray-200 dark:border-neutral-600"
                  >
                    + Add label
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLabelDropdownOpen(false)
                      setAddingLabel(false)
                      setNewLabelText('')
                      if (isOfflineActionsDisabled) {
                        return
                      }
                      setLabelManagerOpen(true)
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-teal hover:bg-gray-50 dark:hover:bg-neutral-800 border-t border-gray-200 dark:border-neutral-600"
                  >
                    Label manager
                  </button>
                </div>
              )}
              {addLabelHomeAnim.mounted && (
                <div
                  ref={addLabelPopoverRef}
                  className={`absolute right-0 top-full z-50 mt-1 w-[200px] rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-neutral-600 dark:bg-neutral-900 dark:shadow-black/40 ${addLabelHomeAnim.menuClassName}`}
                >
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
                    className="w-full text-center text-lg border border-teal rounded-lg px-2 py-1 mb-2 focus:outline-none focus:ring-2 focus:ring-teal/20 bg-white dark:bg-neutral-800 text-gray-800 dark:text-gray-200"
                    autoFocus
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setAddingLabel(false); setNewLabelText('') }}
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
          </div>
        ) : (
          <div />
        )}
      </div>

      {/* Header */}
      <header className="flex items-center justify-center mb-6 sm:mb-8">
        <ThemedImage
          src="/logo.png"
          alt="MyFamiList"
          width={256}
          height={64}
          className="h-12 w-40 sm:h-16 sm:w-52 shrink-0"
          priority
        />
      </header>

      {/* Main content */}
      {showListsShell ? (
        <>
          <ListsView 
            viewMode="all" 
            homeTourSteps={homeTourSteps}
            showTutorial={!showAuthModal} 
            inviteToken={inviteToken}
            onInviteHandled={clearInviteState}
            selectedLabel={selectedLabel}
            onLabelsChange={handleLabelsChange}
            onSelectLabel={handleSelectLabel}
            onCreatingChange={setIsCreating}
            preCreateFilter={preCreateFilter}
            localLabels={localLabels}
            showImport={showImport}
            onCloseImport={() => setShowImport(false)}
            onAddLocalLabel={(label) => setLocalLabels(prev => prev.includes(label) ? prev : [...prev, label])}
            labelManagerOpen={labelManagerOpen}
            onCloseLabelManager={() => setLabelManagerOpen(false)}
            onOfflineActionsDisabledChange={handleOfflineActionsDisabledChange}
          />
        </>
      ) : (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <p>{inviteToken ? 'Sign in to join the shared list' : 'Sign in to view and manage your lists'}</p>
        </div>
      )}

      {/* Auth modal */}
      {showAuthModal && !user ? (
        <AuthModal
          isOpen
          onClose={() => setShowAuthModal(false)}
        />
      ) : null}

      <ProfileModal
        isOpen={showProfile}
        onClose={() => setShowProfile(false)}
      />

      {activeListId ? (
        <ListDetailHomeOverlay key={activeListId} listId={activeListId} onClose={closeListModal} />
      ) : null}

      <Modal
        isOpen={showFeedback}
        onClose={() => { setShowFeedback(false); setFeedbackText('') }}
        title="User Feedback"
        size="sm"
        hideClose
      >
        <textarea
          value={feedbackText}
          onChange={(e) => setFeedbackText(e.target.value)}
          placeholder="Share your suggestions or feedback..."
          className="w-full min-h-[120px] px-3 py-2 text-sm border border-gray-300 dark:border-neutral-600 rounded-lg focus:outline-none focus:border-teal bg-white dark:bg-neutral-800 text-gray-800 dark:text-gray-200 resize-y"
          maxLength={2000}
        />
        <div className="flex justify-end gap-2 mt-3">
          <button
            type="button"
            onClick={() => { setShowFeedback(false); setFeedbackText('') }}
            className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!feedbackText.trim() || submittingFeedback}
            onClick={async () => {
              if (!feedbackText.trim() || !user) return
              setSubmittingFeedback(true)
              try {
                const id = crypto.randomUUID()
                const t = isoNow()
                const sync = syncFieldsForLocalInsert({ client_created_at: t })
                const base = {
                  id,
                  user_id: user.id,
                  email: user.email ?? '',
                  message: feedbackText.trim(),
                  ...sync,
                }
                const normalized = normalizeServerSyncableFields(base as Record<string, unknown>)
                await db.transaction('rw', db.feedback, db.lists, db.sync_queue, db.list_users, async () => {
                  await db.feedback.put({ ...base, ...normalized } as never)
                  await enqueueSyncQueueRecord({
                    entity: 'feedback',
                    entity_id: id,
                    kind: 'create',
                    payload: {
                      id,
                      user_id: user.id,
                      email: base.email,
                      message: base.message,
                      client_created_at: sync.client_created_at,
                    },
                    ...userQueueParent(user.id),
                    status: 'queued',
                  })
                })
                success('Thank you for your feedback!')
                setFeedbackText('')
                setShowFeedback(false)
              } catch {
                showError('Failed to submit feedback')
              } finally {
                setSubmittingFeedback(false)
              }
            }}
            className="px-4 py-1.5 text-sm font-medium text-white bg-teal rounded-lg hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submittingFeedback ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </Modal>

      <ServerQueueModal isOpen={showServerQueue} onClose={() => setShowServerQueue(false)} />
    </div>
  )
}

function HomeFallback() {
  return (
    <div className="bg-white dark:bg-neutral-800 rounded-none sm:rounded-xl shadow-none sm:shadow-lg dark:shadow-black/40 p-8 w-full sm:min-w-[300px] min-h-screen sm:min-h-0 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal"></div>
    </div>
  )
}

export default function Home() {
  return (
    <Suspense fallback={<HomeFallback />}>
      <HomeContent />
    </Suspense>
  )
}
