interface QtyProgressBarIconProps {
  className?: string
  /** 0–1: sum of assigned members’ quantities divided by Qty target */
  ratio: number
}

/**
 * Pill track + inner progress bar. viewBox 100×16 — inner bar height 4 (2× the previous 2-unit bar).
 * At 100%, fill spans almost the full inner width (2 viewBox units inset each side).
 */
export function QtyProgressBarIcon({ className, ratio }: QtyProgressBarIconProps) {
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0
  const inset = 2
  const innerMaxW = 100 - inset * 2
  const barW = innerMaxW * r

  return (
    <svg
      className={className}
      viewBox="0 0 100 16"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="0" y="0" width="100" height="16" rx="8" className="fill-gray-200 dark:fill-slate-600" />
      <rect
        x={inset}
        y="6"
        width={barW}
        height="4"
        rx="2"
        className="fill-primary dark:fill-gray-200"
      />
    </svg>
  )
}
