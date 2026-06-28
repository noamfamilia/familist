export const FLOATING_RENAME_POPOVER_WIDTH_PX = 200
export const FLOATING_POPOVER_EDGE_GUARD_PX = 12

/** Clamp a fixed popover's `left` so a `popoverWidth` box stays within the viewport. */
export function clampFloatingPopoverLeft(
  anchorRect: DOMRect,
  popoverWidth = FLOATING_RENAME_POPOVER_WIDTH_PX,
  edgeGuard = FLOATING_POPOVER_EDGE_GUARD_PX,
): number {
  const vw = window.innerWidth
  let left = anchorRect.left
  if (left + popoverWidth + edgeGuard > vw) {
    left = anchorRect.right - popoverWidth
  }
  return Math.max(edgeGuard, Math.min(left, vw - popoverWidth - edgeGuard))
}
