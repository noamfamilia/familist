interface QtyProgressBarIconProps {
  className?: string
  /** 0–1: sum of assigned members’ quantities divided by Qty target */
  ratio: number
}

const CELL_COUNT = 5
const VB_W = 100
const VB_H = 16
const FRAME_RX = 8
/** Padding from frame inner edge to cell row. */
const ROW_INSET_X = 3.5
const ROW_INSET_Y = 3.25
/** Gap between adjacent cells (viewBox units). */
const CELL_GAP = 2.75

/** Same hue as `bg-teal` (Add task); intensity steps via opacity so 1…5 read as one family. */
function litCellClass(filled: number): string {
  if (filled <= 0) return ''
  if (filled === 1) return 'fill-teal/35 dark:fill-teal/45'
  if (filled === 2) return 'fill-teal/50 dark:fill-teal/55'
  if (filled === 3) return 'fill-teal/65 dark:fill-teal/70'
  if (filled === 4) return 'fill-teal/82 dark:fill-teal/85'
  return 'fill-teal dark:fill-teal'
}

/**
 * Rounded pill frame + five cells; lit cells use theme teal (Add-task button) with higher opacity as more segments fill.
 */
export function QtyProgressBarIcon({ className, ratio }: QtyProgressBarIconProps) {
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0
  const filled = Math.min(CELL_COUNT, Math.max(0, Math.round(CELL_COUNT * r)))
  const innerW = VB_W - 2 * ROW_INSET_X
  const cellH = VB_H - 2 * ROW_INSET_Y
  const usableW = innerW - (CELL_COUNT - 1) * CELL_GAP
  const cellW = usableW / CELL_COUNT
  const litClass = litCellClass(filled)

  return (
    <svg
      className={className}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect
        x="0"
        y="0"
        width={VB_W}
        height={VB_H}
        rx={FRAME_RX}
        className="fill-gray-100 dark:fill-slate-700/90"
      />
      {Array.from({ length: CELL_COUNT }, (_, i) => (
        <rect
          key={i}
          x={ROW_INSET_X + i * (cellW + CELL_GAP)}
          y={ROW_INSET_Y}
          width={cellW}
          height={cellH}
          rx="1.25"
          className={
            i < filled
              ? litClass
              : 'fill-gray-50 dark:fill-slate-600/80'
          }
        />
      ))}
    </svg>
  )
}
