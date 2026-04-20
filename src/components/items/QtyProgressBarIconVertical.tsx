interface QtyProgressBarIconVerticalProps {
  className?: string
  /** 0–1: sum of assigned members’ quantities divided by Qty target */
  ratio: number
}

const VB_W = 12
const VB_H = 100
const INSET = 3
const GAP = 2
/** Bottom sliver height (smaller than each large segment). */
const SMALL_H = 10

function largeLitOpacityClass(largeLit: number): string {
  const base = 'fill-current text-teal'
  if (largeLit <= 0) return ''
  if (largeLit === 1) return `${base} opacity-40`
  if (largeLit === 2) return `${base} opacity-60`
  return `${base} opacity-80`
}

const oneSegmentLit = 'fill-current text-teal opacity-40'

/**
 * Vertical track: 3 large steps (≥⅓, ≥⅔, 100%) + smaller bottom cell for (0, ⅓).
 * Large segments share opacity by how many of the three are lit; tiny cell uses same as “one segment” (40%).
 */
export function QtyProgressBarIconVertical({ className, ratio }: QtyProgressBarIconVerticalProps) {
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0
  const smallLit = r > 0 && r < 1 / 3
  let largeLit = 0
  if (r >= 1 / 3) largeLit++
  if (r >= 2 / 3) largeLit++
  if (r >= 1) largeLit++
  const largeClass = largeLitOpacityClass(largeLit)

  const innerH = VB_H - 2 * INSET
  const largeH = (innerH - SMALL_H - 3 * GAP) / 3
  const cellW = 8
  const x = (VB_W - cellW) / 2
  const smallW = 6
  const smallX = (VB_W - smallW) / 2

  // Top → bottom in SVG: y increases down. Top = 100% cell, bottom = small sliver.
  const yTop = INSET
  const yMid1 = yTop + largeH + GAP
  const yMid2 = yMid1 + largeH + GAP
  const ySmall = yMid2 + largeH + GAP

  const topOn = r >= 1
  const mid1On = r >= 2 / 3
  const mid2On = r >= 1 / 3

  return (
    <svg
      className={className}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="0" y="0" width={VB_W} height={VB_H} className="fill-gray-100 dark:fill-slate-700/90" />
      <rect
        x={x}
        y={yTop}
        width={cellW}
        height={largeH}
        className={topOn ? largeClass : 'fill-gray-50 dark:fill-slate-600/80'}
      />
      <rect
        x={x}
        y={yMid1}
        width={cellW}
        height={largeH}
        className={mid1On ? largeClass : 'fill-gray-50 dark:fill-slate-600/80'}
      />
      <rect
        x={x}
        y={yMid2}
        width={cellW}
        height={largeH}
        className={mid2On ? largeClass : 'fill-gray-50 dark:fill-slate-600/80'}
      />
      <rect
        x={smallX}
        y={ySmall}
        width={smallW}
        height={SMALL_H}
        className={smallLit ? oneSegmentLit : 'fill-gray-50 dark:fill-slate-600/80'}
      />
    </svg>
  )
}
