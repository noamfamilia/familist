interface ProgressRingsProps {
  targetQty: number
  totalQty: number
  totalDoneQty: number
  size?: number
}

export function ProgressRings({ targetQty, totalQty, totalDoneQty, size = 36 }: ProgressRingsProps) {
  const outerR = size / 2 - 2
  const innerR = outerR - 5
  const cx = size / 2
  const cy = size / 2
  const strokeWidth = 3

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
        strokeWidth={strokeWidth} />
      {/* Outer fill (red-500): done progress */}
      {doneProgress > 0 && (
        <circle cx={cx} cy={cy} r={outerR} fill="none"
          stroke="rgb(239 68 68)" strokeWidth={strokeWidth}
          strokeDasharray={`${outerDash} ${outerGap}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} />
      )}
      {/* Inner track */}
      <circle cx={cx} cy={cy} r={innerR} fill="none"
        stroke="currentColor" className="text-gray-200 dark:text-slate-600"
        strokeWidth={strokeWidth} />
      {/* Inner fill (teal): quantity progress */}
      {qtyProgress > 0 && (
        <circle cx={cx} cy={cy} r={innerR} fill="none"
          stroke="rgb(20 184 166)" strokeWidth={strokeWidth}
          strokeDasharray={`${innerDash} ${innerGap}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} />
      )}
    </svg>
  )
}
