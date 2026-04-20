interface QtyProgressBarIconProps {
  className?: string
  /** 0–1: sum of assigned members’ quantities divided by Qty target */
  ratio: number
}

/** Inner slot from Noun frame path (6.356 … 93.644). */
const INNER_LEFT = 6.356
const INNER_WIDTH = 87.288
const CELL_COUNT = 5
const CELL_WIDTH = INNER_WIDTH / CELL_COUNT
const CELL_Y = 44.369
const CELL_H = 11.565

/**
 * Noun-style segmented bar: frame path + five equal cells spanning the inner width.
 * Filled cell count steps with `ratio` (rounded).
 */
export function QtyProgressBarIcon({ className, ratio }: QtyProgressBarIconProps) {
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0
  const filled = Math.min(CELL_COUNT, Math.max(0, Math.round(CELL_COUNT * r)))

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
        className="fill-gray-200 dark:fill-slate-600"
      />
      {Array.from({ length: CELL_COUNT }, (_, i) => (
        <rect
          key={i}
          x={INNER_LEFT + i * CELL_WIDTH}
          y={CELL_Y}
          width={CELL_WIDTH}
          height={CELL_H}
          className={
            i < filled
              ? 'fill-primary dark:fill-gray-200'
              : 'fill-gray-100 dark:fill-slate-700'
          }
        />
      ))}
    </svg>
  )
}
