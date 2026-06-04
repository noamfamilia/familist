/**
 * In-memory drag snap diagnostics for DragSnapDebugModal.
 * Cleared via the modal Clear control.
 */

import type { ClientRect } from '@dnd-kit/core'
import type { Transform } from '@dnd-kit/utilities'

type DragDebugSurface = 'page' | 'home_modal'

export type DragSnapReason = 'drag_cancel' | 'isDragging_false_while_pointer_down' | 'transform_reset'

type SerializedRect = {
  top: number
  left: number
  width: number
  height: number
  bottom: number
  right: number
}

export type DragSnapSnapshot = {
  at: string
  reason: DragSnapReason
  itemId: string
  surface: DragDebugSurface
  pointer: { x: number; y: number; buttons: number } | null
  pointerMeta: {
    pointerType: string | null
    activatorEventType: string | null
    pointerInsideActiveRect: boolean | null
    pointerOffsetFromActiveCenter: { x: number; y: number } | null
  }
  scrollAncestors: Array<{
    tag: string
    className: string
    scrollTop: number
    scrollLeft: number
    scrollHeight: number
    clientHeight: number
    scrollTopAtDragStart: number
    scrollLeftAtDragStart: number
    scrollTopDelta: number
    scrollLeftDelta: number
  }>
  scrollEventsDuringDrag: Array<{
    msSinceDragStart: number
    ancestorIndex: number
    scrollTop: number
    scrollTopDelta: number
  }>
  timing: {
    msSinceDragStart: number | null
    moveEventCount: number
  }
  indices: {
    activeIndex: number | null
    overIndex: number | null
  }
  items: {
    countAtStart: number
    countAtSnap: number
    idsHashAtStart: string
    idsHashAtSnap: string
    idsChangedDuringDrag: boolean
  }
  dnd: {
    lastEvent: string | null
    activeId: string | null
    overId: string | null
    delta: { x: number; y: number } | null
    transform: { x: number; y: number; scaleX: number; scaleY: number } | null
    activeTranslatedRect: SerializedRect | null
    overRect: SerializedRect | null
  }
  hitTest: { elementTag: string; elementClass: string } | null
  stickyHeaderRect: SerializedRect | null
  activeRect: SerializedRect | null
  environment: {
    isMaxSm: boolean
    bodyOverflow: string
    visualViewportHeight: number | null
  }
  debugModalAlreadyOpen: boolean
  viewport: { innerWidth: number; innerHeight: number; scrollY: number; scrollX: number }
}

const LOG_CAP = 20
const SCROLL_EVENT_CAP = 30
const lines: string[] = []
const listeners = new Set<() => void>()

let lastSnap: DragSnapSnapshot | null = null
let dragDebugModalIsOpen = false

type ScrollBaseline = { scrollTop: number; scrollLeft: number }

type DragDebugSession = {
  lastEvent: string | null
  activeId: string | null
  overId: string | null
  delta: { x: number; y: number } | null
  dragStartPerf: number | null
  moveEventCount: number
  activeIndex: number | null
  overIndex: number | null
  surface: DragDebugSurface | null
  itemsIdsAtStart: string[]
  itemsCountAtStart: number
  pointerType: string | null
  activatorEventType: string | null
  scrollBaseline: ScrollBaseline[]
  scrollEventsDuringDrag: DragSnapSnapshot['scrollEventsDuringDrag']
  activeTranslatedRect: SerializedRect | null
  overRect: SerializedRect | null
}

let session: DragDebugSession = emptySession()

let scrollWatchElements: Element[] = []
const scrollUnsubscribers: Array<() => void> = []

export const dragDebugPointerRef: { current: { x: number; y: number; buttons: number } | null } = {
  current: null,
}

function emptySession(): DragDebugSession {
  return {
    lastEvent: null,
    activeId: null,
    overId: null,
    delta: null,
    dragStartPerf: null,
    moveEventCount: 0,
    activeIndex: null,
    overIndex: null,
    surface: null,
    itemsIdsAtStart: [],
    itemsCountAtStart: 0,
    pointerType: null,
    activatorEventType: null,
    scrollBaseline: [],
    scrollEventsDuringDrag: [],
    activeTranslatedRect: null,
    overRect: null,
  }
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  }
}

function serializeRect(rect: DOMRect | ClientRect | null | undefined): SerializedRect | null {
  if (!rect) return null
  return {
    top: Math.round(rect.top),
    left: Math.round(rect.left),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    bottom: Math.round(rect.bottom),
    right: Math.round(rect.right),
  }
}

function serializeTransform(transform: Transform | null | undefined): DragSnapSnapshot['dnd']['transform'] {
  if (!transform) return null
  return {
    x: transform.x,
    y: transform.y,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
  }
}

function hashItemIds(ids: string[]): string {
  if (ids.length === 0) return '0:'
  const head = ids[0]?.slice(0, 8) ?? ''
  const tail = ids[ids.length - 1]?.slice(0, 8) ?? ''
  return `${ids.length}:${head}..${tail}`
}

function isScrollable(el: Element): boolean {
  const style = getComputedStyle(el)
  return (
    /(auto|scroll)/.test(style.overflowY) ||
    /(auto|scroll)/.test(style.overflowX) ||
    /(auto|scroll)/.test(style.overflow)
  )
}

function collectScrollableElements(from: Element | null): Element[] {
  const out: Element[] = []
  let el = from
  while (el) {
    if (isScrollable(el)) out.push(el)
    el = el.parentElement
  }
  return out
}

export function collectScrollAncestors(from: Element | null): DragSnapSnapshot['scrollAncestors'] {
  return collectScrollableElements(from).map((el, index) => {
    const baseline = session.scrollBaseline[index] ?? { scrollTop: el.scrollTop, scrollLeft: el.scrollLeft }
    return {
      tag: el.tagName,
      className: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
      scrollTop: el.scrollTop,
      scrollLeft: el.scrollLeft,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollTopAtDragStart: baseline.scrollTop,
      scrollLeftAtDragStart: baseline.scrollLeft,
      scrollTopDelta: el.scrollTop - baseline.scrollTop,
      scrollLeftDelta: el.scrollLeft - baseline.scrollLeft,
    }
  })
}

function hitTestAtPointer(x: number, y: number): DragSnapSnapshot['hitTest'] {
  const el = document.elementFromPoint(x, y)
  if (!el) return null
  return {
    elementTag: el.tagName,
    elementClass: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
  }
}

function findSortableNode(itemId: string): Element | null {
  return document.querySelector(`[data-sortable-id="${CSS.escape(itemId)}"]`)
}

function pointerMetaFor(activeRect: SerializedRect | null): DragSnapSnapshot['pointerMeta'] {
  const ptr = dragDebugPointerRef.current
  if (!ptr || !activeRect) {
    return {
      pointerType: session.pointerType,
      activatorEventType: session.activatorEventType,
      pointerInsideActiveRect: null,
      pointerOffsetFromActiveCenter: null,
    }
  }
  const centerX = activeRect.left + activeRect.width / 2
  const centerY = activeRect.top + activeRect.height / 2
  const inside =
    ptr.x >= activeRect.left &&
    ptr.x <= activeRect.right &&
    ptr.y >= activeRect.top &&
    ptr.y <= activeRect.bottom
  return {
    pointerType: session.pointerType,
    activatorEventType: session.activatorEventType,
    pointerInsideActiveRect: inside,
    pointerOffsetFromActiveCenter: {
      x: Math.round(ptr.x - centerX),
      y: Math.round(ptr.y - centerY),
    },
  }
}

function detachScrollWatchers(): void {
  for (const unsub of scrollUnsubscribers) unsub()
  scrollUnsubscribers.length = 0
  scrollWatchElements = []
}

function attachScrollWatchers(from: Element | null): void {
  detachScrollWatchers()
  scrollWatchElements = collectScrollableElements(from)
  session.scrollBaseline = scrollWatchElements.map((el) => ({
    scrollTop: el.scrollTop,
    scrollLeft: el.scrollLeft,
  }))
  session.scrollEventsDuringDrag = []

  scrollWatchElements.forEach((el, ancestorIndex) => {
    const baseline = session.scrollBaseline[ancestorIndex]
    const onScroll = () => {
      const msSinceDragStart =
        session.dragStartPerf == null ? 0 : Math.round(performance.now() - session.dragStartPerf)
      session.scrollEventsDuringDrag.push({
        msSinceDragStart,
        ancestorIndex,
        scrollTop: el.scrollTop,
        scrollTopDelta: el.scrollTop - baseline.scrollTop,
      })
      if (session.scrollEventsDuringDrag.length > SCROLL_EVENT_CAP) {
        session.scrollEventsDuringDrag.shift()
      }
    }
    el.addEventListener('scroll', onScroll, { capture: true, passive: true })
    scrollUnsubscribers.push(() => el.removeEventListener('scroll', onScroll, { capture: true }))
  })
}

export function setDragDebugModalIsOpen(open: boolean): void {
  dragDebugModalIsOpen = open
}

export function resetDragDebugSession(): void {
  detachScrollWatchers()
  session = emptySession()
}

export function endDragDebugSession(): void {
  detachScrollWatchers()
}

export function updateDragDebugSession(partial: Partial<DragDebugSession>): void {
  session = { ...session, ...partial }
}

export function beginDragDebugSession(args: {
  itemId: string
  surface: DragDebugSurface
  activeIndex: number
  activeItemIds: string[]
  activatorEvent?: Event | null
}): void {
  resetDragDebugSession()
  const activator = args.activatorEvent
  session = {
    ...session,
    lastEvent: 'start',
    activeId: args.itemId,
    overId: null,
    delta: null,
    dragStartPerf: typeof performance !== 'undefined' ? performance.now() : null,
    moveEventCount: 0,
    activeIndex: args.activeIndex,
    overIndex: null,
    surface: args.surface,
    itemsIdsAtStart: [...args.activeItemIds],
    itemsCountAtStart: args.activeItemIds.length,
    pointerType:
      activator && 'pointerType' in activator
        ? String((activator as PointerEvent).pointerType)
        : null,
    activatorEventType: activator?.type ?? null,
  }
  attachScrollWatchers(findSortableNode(args.itemId))
}

export function trackDragDebugMove(args: {
  overId: string | null
  overIndex: number | null
  delta: { x: number; y: number }
  activeTranslatedRect?: ClientRect | null
  overRect?: ClientRect | null
}): void {
  session = {
    ...session,
    lastEvent: 'move',
    moveEventCount: session.moveEventCount + 1,
    overId: args.overId,
    overIndex: args.overIndex,
    delta: args.delta,
    activeTranslatedRect: serializeRect(args.activeTranslatedRect),
    overRect: serializeRect(args.overRect),
  }
}

export function recordDragSnap(args: {
  reason: DragSnapReason
  itemId: string
  surface: DragDebugSurface
  itemsCount: number
  activeItemIds: string[]
  transform?: Transform | null
  activeIndex?: number | null
  overIndex?: number | null
  activeTranslatedRect?: ClientRect | null
  overRect?: ClientRect | null
}): void {
  const ptr = dragDebugPointerRef.current
  const node = findSortableNode(args.itemId)
  const activeRect = serializeRect(node?.getBoundingClientRect() ?? null)
  const idsHashAtSnap = hashItemIds(args.activeItemIds)
  const idsHashAtStart = hashItemIds(session.itemsIdsAtStart)
  const msSinceDragStart =
    session.dragStartPerf == null ? null : Math.round(performance.now() - session.dragStartPerf)

  if (args.activeTranslatedRect != null) {
    session.activeTranslatedRect = serializeRect(args.activeTranslatedRect)
  }
  if (args.overRect != null) {
    session.overRect = serializeRect(args.overRect)
  }

  const stickyEl = document.querySelector('[data-drag-debug-sticky-header]')

  const snapshot: DragSnapSnapshot = {
    at: new Date().toISOString(),
    reason: args.reason,
    itemId: args.itemId,
    surface: args.surface,
    pointer: ptr ? { ...ptr } : null,
    pointerMeta: pointerMetaFor(activeRect),
    scrollAncestors: collectScrollAncestors(node),
    scrollEventsDuringDrag: [...session.scrollEventsDuringDrag],
    timing: {
      msSinceDragStart,
      moveEventCount: session.moveEventCount,
    },
    indices: {
      activeIndex: args.activeIndex ?? session.activeIndex,
      overIndex: args.overIndex ?? session.overIndex,
    },
    items: {
      countAtStart: session.itemsCountAtStart,
      countAtSnap: args.itemsCount,
      idsHashAtStart,
      idsHashAtSnap,
      idsChangedDuringDrag: idsHashAtStart !== idsHashAtSnap,
    },
    dnd: {
      lastEvent: session.lastEvent,
      activeId: session.activeId,
      overId: session.overId,
      delta: session.delta ? { ...session.delta } : null,
      transform: serializeTransform(args.transform),
      activeTranslatedRect: session.activeTranslatedRect,
      overRect: session.overRect,
    },
    hitTest: ptr ? hitTestAtPointer(ptr.x, ptr.y) : null,
    stickyHeaderRect: serializeRect(stickyEl?.getBoundingClientRect() ?? null),
    activeRect,
    environment: {
      isMaxSm: typeof window !== 'undefined' ? window.matchMedia('(max-width: 639px)').matches : false,
      bodyOverflow:
        typeof document !== 'undefined' ? getComputedStyle(document.body).overflow : '',
      visualViewportHeight:
        typeof window !== 'undefined' && window.visualViewport
          ? Math.round(window.visualViewport.height)
          : null,
    },
    debugModalAlreadyOpen: dragDebugModalIsOpen,
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollY: window.scrollY,
      scrollX: window.scrollX,
    },
  }

  lastSnap = snapshot
  lines.push(JSON.stringify(snapshot, null, 2))
  while (lines.length > LOG_CAP) lines.shift()
  notify()
}

export function getLastDragSnap(): DragSnapSnapshot | null {
  return lastSnap
}

export function getDragSnapDebugLines(): readonly string[] {
  return lines
}

export function clearDragSnapDebugLog(): void {
  lines.length = 0
  lastSnap = null
  resetDragDebugSession()
  notify()
}

export function subscribeDragSnapDebug(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const DRAG_SNAP_DEBUG_TITLE = 'Drag snap debug'

export function formatDragSnapDebugModalCopy(
  last: DragSnapSnapshot | null,
  logLines: readonly string[],
): string {
  const header = [DRAG_SNAP_DEBUG_TITLE]
  if (last) {
    header.push('', 'Last snap:', JSON.stringify(last, null, 2))
  } else {
    header.push('', 'No snap captured yet this session.')
  }
  if (logLines.length > 0) {
    header.push('', 'Event log:', ...logLines)
  }
  return header.join('\n')
}
