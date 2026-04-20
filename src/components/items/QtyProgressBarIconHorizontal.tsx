interface QtyProgressBarIconHorizontalProps {
  className?: string
  /** 0–1: sum of assigned members’ quantities divided by Qty target */
  ratio: number
}

const CELL_COUNT = 5
const VB_W = 100
const VB_H = 16
const ROW_INSET_X = 3.5
const ROW_INSET_Y = 3.25
const CELL_GAP = 2.75

/** Theme `teal` (same as Add-member `bg-teal`); opacity by lit count. */
function litCellClass(filled: number): string {
  if (filled <= 0) return ''
  const base = 'fill-current text-teal'
  if (filled <= 2) return `${base} opacity-45`
  if (filled <= 4) return `${base} opacity-60`
  return `${base} opacity-80`
}

/**
 * Horizontal 5-cell bar (20% steps). Kept for easy switch-back from vertical layout.
 */
export function QtyProgressBarIconHorizontal({ className, ratio }: QtyProgressBarIconHorizontalProps) {
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0
  const filled = Math.min(CELL_COUNT, Math.max(0, Math.floor(r * CELL_COUNT)))
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
      <rect x="0" y="0" width={VB_W} height={VB_H} className="fill-gray-100 dark:fill-slate-700/90" />
      {Array.from({ length: CELL_COUNT }, (_, i) => (
        <rect
          key={i}
          x={ROW_INSET_X + i * (cellW + CELL_GAP)}
          y={ROW_INSET_Y}
          width={cellW}
          height={cellH}
          className={i < filled ? litClass : 'fill-gray-50 dark:fill-slate-600/80'}
        />
      ))}
    </svg>
  )
}
