/**
 * In-memory drag snap diagnostics for DragSnapDebugModal.
 * Cleared via the modal Clear control.
 */

import type { Transform } from '@dnd-kit/utilities'

type DragDebugSurface = 'page' | 'home_modal'

export type DragSnapReason = 'drag_cancel' | 'isDragging_false_while_pointer_down' | 'transform_reset'

export type DragSnapSnapshot = {
  at: string
  reason: DragSnapReason
  itemId: string
  surface: DragDebugSurface
  pointer: { x: number; y: number; buttons: number } | null
  scrollAncestors: Array<{
    tag: string
    className: string
    scrollTop: number
    scrollLeft: number
    scrollHeight: number
    clientHeight: number
  }>
  dnd: {
    lastEvent: string | null
    activeId: string | null
    overId: string | null
    delta: { x: number; y: number } | null
    transform: { x: number; y: number; scaleX: number; scaleY: number } | null
  }
  hitTest: { elementTag: string; elementClass: string } | null
  itemsCount: number
  activeRect: {
    top: number
    left: number
    width: number
    height: number
    bottom: number
    right: number
  } | null
  viewport: { innerWidth: number; innerHeight: number; scrollY: number; scrollX: number }
}

const LOG_CAP = 20
const lines: string[] = []
const listeners = new Set<() => void>()

let lastSnap: DragSnapSnapshot | null = null

type DragDebugSession = {
  lastEvent: string | null
  activeId: string | null
  overId: string | null
  delta: { x: number; y: number } | null
}

let session: DragDebugSession = {
  lastEvent: null,
  activeId: null,
  overId: null,
  delta: null,
}

export const dragDebugPointerRef: { current: { x: number; y: number; buttons: number } | null } = {
  current: null,
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

function serializeRect(rect: DOMRect | null): DragSnapSnapshot['activeRect'] {
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

export function collectScrollAncestors(from: Element | null): DragSnapSnapshot['scrollAncestors'] {
  const out: DragSnapSnapshot['scrollAncestors'] = []
  let el = from
  while (el) {
    const style = getComputedStyle(el)
    const scrollable =
      /(auto|scroll)/.test(style.overflowY) ||
      /(auto|scroll)/.test(style.overflowX) ||
      /(auto|scroll)/.test(style.overflow)
    if (scrollable) {
      out.push({
        tag: el.tagName,
        className: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
        scrollTop: el.scrollTop,
        scrollLeft: el.scrollLeft,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      })
    }
    el = el.parentElement
  }
  return out
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

export function resetDragDebugSession(): void {
  session = {
    lastEvent: null,
    activeId: null,
    overId: null,
    delta: null,
  }
}

export function updateDragDebugSession(partial: Partial<DragDebugSession>): void {
  session = { ...session, ...partial }
}

export function recordDragSnap(args: {
  reason: DragSnapReason
  itemId: string
  surface: DragDebugSurface
  itemsCount: number
  transform?: Transform | null
}): void {
  const ptr = dragDebugPointerRef.current
  const node = findSortableNode(args.itemId)
  const snapshot: DragSnapSnapshot = {
    at: new Date().toISOString(),
    reason: args.reason,
    itemId: args.itemId,
    surface: args.surface,
    pointer: ptr ? { ...ptr } : null,
    scrollAncestors: collectScrollAncestors(node),
    dnd: {
      lastEvent: session.lastEvent,
      activeId: session.activeId,
      overId: session.overId,
      delta: session.delta ? { ...session.delta } : null,
      transform: serializeTransform(args.transform),
    },
    hitTest: ptr ? hitTestAtPointer(ptr.x, ptr.y) : null,
    itemsCount: args.itemsCount,
    activeRect: serializeRect(node?.getBoundingClientRect() ?? null),
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
