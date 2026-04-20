interface ProgressRingsProps {
  targetQty: number
  totalQty: number
  totalDoneQty: number
  size?: number
}

export function ProgressRings({ targetQty, totalQty, totalDoneQty, size = 40 }: ProgressRingsProps) {
  const cx = size / 2
  const cy = size / 2
  const strokeWidth = 2
  const innerR = 18
  const outerR = 18

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
      {/* Inner fill: quantity progress */}
      {qtyProgress > 0 && (
        <circle cx={cx} cy={cy} r={innerR} fill="none"
          className="stroke-gray-400"
          strokeWidth={strokeWidth}
          strokeDasharray={`${innerDash} ${innerGap}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} />
      )}
      {/* Outer fill: done progress */}
      {doneProgress > 0 && (
        <circle cx={cx} cy={cy} r={outerR} fill="none"
          className="stroke-black"
          strokeWidth={strokeWidth}
          strokeDasharray={`${outerDash} ${outerGap}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} />
      )}
      {/* Target quantity in center */}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
        className="fill-primary dark:fill-gray-100 text-[0.9rem] font-medium select-none">
        {targetQty}
      </text>
    </svg>
  )
}
