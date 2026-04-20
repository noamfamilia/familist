interface QtyProgressBarIconProps {
  className?: string
  /** 0–1: sum of assigned members’ quantities divided by Qty target */
  ratio: number
}

/**
 * Horizontal progress track + fill (Carbon / SVG Repo style). viewBox 0 0 32 32.
 * Fill bar: x=6, max width 14 in icon coordinates.
 */
export function QtyProgressBarIcon({ className, ratio }: QtyProgressBarIconProps) {
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0
  const barWidth = 14 * r

  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M28,21H4a2.0021,2.0021,0,0,1-2-2V13a2.0021,2.0021,0,0,1,2-2H28a2.0021,2.0021,0,0,1,2,2v6A2.0021,2.0021,0,0,1,28,21ZM4,13v6H28V13Z"
        className="fill-gray-200 dark:fill-slate-600"
      />
      <rect x="6" y="15" width={barWidth} height="2" className="fill-primary dark:fill-gray-200" />
    </svg>
  )
}
