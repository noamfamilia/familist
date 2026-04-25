interface QtyProgressBarIconVerticalProps {
  className?: string
  /** When set, SVG height in px (width fills); scales the bar with the cell. */
  trackHeightPx?: number
  /** 0–1: sum of assigned members’ quantities divided by Qty target */
  ratio: number
}

/** 3× prior 12-wide bar for a thicker strip */
const VB_W = 36
const VB_H = 100
const INSET = 3
const GAP = 2
const LARGE_H = 30
/** Bottom sliver for (0, ⅓); bottom-aligned with INSET from frame bottom */
const SMALL_H = 10

/** Inner bottom (y + h for rects anchored to bottom inset) */
const Y_INNER_BOTTOM = VB_H - INSET
const Y_SMALL = Y_INNER_BOTTOM - SMALL_H
const Y_BOTTOM_LARGE = Y_INNER_BOTTOM - LARGE_H
const Y_MID_LARGE = Y_BOTTOM_LARGE - GAP - LARGE_H
const Y_TOP_LARGE = Y_MID_LARGE - GAP - LARGE_H

/** Per-tier teal opacity (fixed by cell position, not by how many tiers are lit) */
const topLit = 'fill-current text-teal opacity-80'
const midLit = 'fill-current text-teal opacity-60'
const bottomLit = 'fill-current text-teal opacity-40'
const smallLitClass = 'fill-current text-teal opacity-40'
const zeroCoral = 'fill-current text-coral opacity-60'

/** Rounded “pill” caps for vertical segments (viewBox units) */
const FRAME_RX = 6
const SEG_RX = 4

/**
 * Vertical track: 3 large steps (≥⅓, ≥⅔, 100%) + 10px bottom cell for (0, ⅓).
 * Bottom large shares the column with the small sliver; when ≥⅓ the large is drawn on top and hides the small.
 * Opacity is fixed per row: top 80%, middle 60%, bottom large & teal small 40%, coral zero small 60%.
 */
export function QtyProgressBarIconVertical({ className, trackHeightPx, ratio }: QtyProgressBarIconVerticalProps) {
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0
  const zeroFill = r === 0
  const smallLit = r > 0 && r < 1 / 3

  /** Full-bleed column: no horizontal gutter inside the SVG */
  const cellW = VB_W
  const x = 0

  const topOn = r >= 1
  const mid1On = r >= 2 / 3
  const mid2On = r >= 1 / 3

  const trackMuted = 'fill-gray-50 dark:fill-neutral-600/80'

  return (
    <svg
      className={className}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      style={trackHeightPx != null ? { height: trackHeightPx, width: '100%', display: 'block' } : undefined}
    >
      <rect
        x="0"
        y="0"
        width={VB_W}
        height={VB_H}
        rx={FRAME_RX}
        ry={FRAME_RX}
        className="fill-gray-100 dark:fill-neutral-700/90"
      />
      <rect
        x={x}
        y={Y_TOP_LARGE}
        width={cellW}
        height={LARGE_H}
        rx={SEG_RX}
        ry={SEG_RX}
        className={topOn ? topLit : trackMuted}
      />
      <rect
        x={x}
        y={Y_MID_LARGE}
        width={cellW}
        height={LARGE_H}
        rx={SEG_RX}
        ry={SEG_RX}
        className={mid1On ? midLit : trackMuted}
      />
      {!mid2On && (
        <rect
          x={x}
          y={Y_BOTTOM_LARGE}
          width={cellW}
          height={LARGE_H}
          rx={SEG_RX}
          ry={SEG_RX}
          className={trackMuted}
        />
      )}
      {zeroFill && !mid2On && (
        <rect
          x={x}
          y={Y_SMALL}
          width={cellW}
          height={SMALL_H}
          rx={SEG_RX}
          ry={SEG_RX}
          className={zeroCoral}
        />
      )}
      {smallLit && !mid2On && (
        <rect
          x={x}
          y={Y_SMALL}
          width={cellW}
          height={SMALL_H}
          rx={SEG_RX}
          ry={SEG_RX}
          className={smallLitClass}
        />
      )}
      {mid2On && (
        <rect
          x={x}
          y={Y_BOTTOM_LARGE}
          width={cellW}
          height={LARGE_H}
          rx={SEG_RX}
          ry={SEG_RX}
          className={bottomLit}
        />
      )}
    </svg>
  )
}
