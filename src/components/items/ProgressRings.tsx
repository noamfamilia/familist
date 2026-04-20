interface ProgressRingsProps {
  targetQty: number
  totalQty: number
  totalDoneQty: number
  size?: number
}

export function ProgressRings({ targetQty, totalQty, totalDoneQty, size = 36 }: ProgressRingsProps) {
  const cx = size / 2
  const cy = size / 2
  const edgePadding = 2
  const outerStrokeWidth = 4
  const innerStrokeWidth = 2
  // Centerlines: inner ring outside (innerR + inner/2) meets outer ring inside (outerR - outer/2) with no gap.
  const outerR = size / 2 - edgePadding - outerStrokeWidth / 2
  const innerR = outerR - (innerStrokeWidth + outerStrokeWidth) / 2

  const outerCircumference = 2 * Math.PI * outerR
  const innerCircumference = 2 * Math.PI * innerR

  const qtyProgress = targetQty > 0 ? Math.min(totalQty / targetQty, 1) : 0
  const doneProgress = targetQty > 0 ? Math.min(totalDoneQty / targetQty, 1) : 0

  const outerDash = doneProgress * outerCircumference
  const outerGap = outerCircumference - outerDash
  const innerDash = qtyProgress * innerCircumference
  const innerGap = innerCircumference - innerDash

  return (
    <svg width={size} height={size} className="flex-shrink-0">
      {/* Outer track */}
      <circle cx={cx} cy={cy} r={outerR} fill="none"
        stroke="currentColor" className="text-gray-200 dark:text-slate-600"
        strokeWidth={outerStrokeWidth} />
      {/* Outer fill: done progress */}
      {doneProgress > 0 && (
        <circle cx={cx} cy={cy} r={outerR} fill="none"
          className="stroke-black"
          strokeWidth={outerStrokeWidth}
          strokeDasharray={`${outerDash} ${outerGap}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} />
      )}
      {/* Inner track */}
      <circle cx={cx} cy={cy} r={innerR} fill="none"
        stroke="currentColor" className="text-gray-200 dark:text-slate-600"
        strokeWidth={innerStrokeWidth} />
      {/* Inner fill: quantity progress */}
      {qtyProgress > 0 && (
        <circle cx={cx} cy={cy} r={innerR} fill="none"
          className="stroke-black"
          strokeWidth={innerStrokeWidth}
          strokeDasharray={`${innerDash} ${innerGap}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} />
      )}
      {/* Target quantity in center */}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
        className="fill-primary dark:fill-gray-100 text-xs font-medium select-none">
        {targetQty}
      </text>
    </svg>
  )
}
