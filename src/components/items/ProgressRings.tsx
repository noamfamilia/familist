interface ProgressRingsProps {
  targetQty: number
  totalQty: number
  totalDoneQty: number
  size?: number
}

export function ProgressRings({ targetQty, totalQty, totalDoneQty, size = 32 }: ProgressRingsProps) {
  const r = size / 2 - 2
  const cx = size / 2
  const cy = size / 2
  const strokeWidth = 3
  const circumference = 2 * Math.PI * r

  const qtyProgress = targetQty > 0 ? Math.min(totalQty / targetQty, 1) : 0
  const doneProgress = targetQty > 0 ? Math.min(totalDoneQty / targetQty, 1) : 0

  const qtyDash = qtyProgress * circumference
  const qtyGap = circumference - qtyDash
  const doneDash = doneProgress * circumference
  const doneGap = circumference - doneDash

  return (
    <div className="flex items-center gap-0.5 flex-shrink-0">
      <svg width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke="currentColor" className="text-gray-200 dark:text-slate-600"
          strokeWidth={strokeWidth} />
        {qtyProgress > 0 && (
          <circle cx={cx} cy={cy} r={r} fill="none"
            stroke="rgb(20 184 166)" strokeWidth={strokeWidth}
            strokeDasharray={`${qtyDash} ${qtyGap}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`} />
        )}
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
          className="fill-primary dark:fill-gray-100 text-[11px] font-medium select-none">
          {totalQty}
        </text>
      </svg>
      <svg width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke="currentColor" className="text-gray-200 dark:text-slate-600"
          strokeWidth={strokeWidth} />
        {doneProgress > 0 && (
          <circle cx={cx} cy={cy} r={r} fill="none"
            stroke="rgb(239 68 68)" strokeWidth={strokeWidth}
            strokeDasharray={`${doneDash} ${doneGap}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`} />
        )}
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
          className="fill-primary dark:fill-gray-100 text-[11px] font-medium select-none">
          {totalDoneQty}
        </text>
      </svg>
    </div>
  )
}
