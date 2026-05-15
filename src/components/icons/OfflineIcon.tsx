/**
 * Connectivity indicator — geometry from repo root `offline2.svg` (SVG Repo).
 * `offline`: cyan cloud with ✕; `recovering`: teal cloud only (bottom edge bridged where ✕ was).
 */
const OFFLINE2_CLOUD_D =
  'M24 14a5 5 0 0 1-5 5h-1v-1h1a3.99 3.99 0 0 0 .623-7.934l-.79-.124-.052-.798a5.293 5.293 0 0 0-10.214-1.57L8.17 8.59l-.977-.483A2.277 2.277 0 0 0 6.19 7.87a2.18 2.18 0 0 0-1.167.339 2.205 2.205 0 0 0-.98 1.395l-.113.505-.476.2A4 4 0 0 0 5 18h6v1H5a5 5 0 0 1-1.934-9.611 3.21 3.21 0 0 1 1.422-2.024A3.17 3.17 0 0 1 6.19 6.87a3.268 3.268 0 0 1 1.446.34 6.293 6.293 0 0 1 12.143 1.867A4.988 4.988 0 0 1 24 14z'

const OFFLINE2_X_D =
  'M15.207 18.5l3.146-3.146-.707-.707-3.146 3.146-3.146-3.146-.707.707 3.146 3.146-3.146 3.146.707.707 3.146-3.146 3.146 3.146.707-.707z'

/** Fills the gap in the cloud bottom outline left when the ✕ subpath is omitted. */
const OFFLINE2_RECOVERING_BRIDGE_D = 'M11.85 18.05h6.7v0.95h-6.7z'

export type OfflineIconVariant = 'offline' | 'recovering'

export function OfflineIcon({
  className = 'h-8 w-8',
  variant = 'offline',
}: {
  className?: string
  variant?: OfflineIconVariant
}) {
  const colorClass = variant === 'offline' ? 'text-cyan-500' : 'text-teal'

  return (
    <svg
      className={`${colorClass} ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path d={OFFLINE2_CLOUD_D} fill="currentColor" />
      {variant === 'offline' ? (
        <path d={OFFLINE2_X_D} fill="currentColor" />
      ) : (
        <path d={OFFLINE2_RECOVERING_BRIDGE_D} fill="currentColor" />
      )}
    </svg>
  )
}
