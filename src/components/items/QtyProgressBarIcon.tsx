interface QtyProgressBarIconProps {
  className?: string
  /** 0–1: sum of assigned members’ quantities divided by Qty target */
  ratio: number
}

/** Inner slot from Noun frame path (6.356 … 93.644). */
const INNER_LEFT = 6.356
const INNER_WIDTH = 87.288
const CELL_COUNT = 5
/** Horizontal padding inside the inner opening (cell ↔ SVG frame). */
const CELL_INSET = 5
/** Gap between adjacent cells (viewBox units). */
const CELL_GAP = 3.25
const CELL_Y = 44.55
const CELL_H = 11.2

/**
 * Noun-style segmented bar: frame path + five equal cells spanning the inner width.
 * Filled cell count steps with `ratio` (rounded).
 */
export function QtyProgressBarIcon({ className, ratio }: QtyProgressBarIconProps) {
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0
  const filled = Math.min(CELL_COUNT, Math.max(0, Math.round(CELL_COUNT * r)))
  const usableW = INNER_WIDTH - 2 * CELL_INSET - (CELL_COUNT - 1) * CELL_GAP
  const cellW = usableW / CELL_COUNT

  return (
    <svg
      className={className}
      viewBox="4 39 92 22"
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5,41.692v16.615h90V41.692H5z M93.644,56.951H6.356V43.048h87.288V56.951z"
        className="fill-primary/45 dark:fill-gray-500"
      />
      {Array.from({ length: CELL_COUNT }, (_, i) => (
        <rect
          key={i}
          x={INNER_LEFT + CELL_INSET + i * (cellW + CELL_GAP)}
          y={CELL_Y}
          width={cellW}
          height={CELL_H}
          className={
            i < filled
              ? 'fill-primary/45 dark:fill-gray-500'
              : 'fill-gray-50 dark:fill-slate-600/80'
          }
        />
      ))}
    </svg>
  )
}
