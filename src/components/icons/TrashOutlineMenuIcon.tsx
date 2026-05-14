/** Trash — delete archived (stroke-only). */
export function TrashOutlineMenuIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <g transform="translate(0 -0.85)">
        <path
          d="M9 4h6l1 2h5v2H3V6h5l1-2z"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinejoin="round"
        />
        <path
          d="M6 8v12a2 2 0 002 2h8a2 2 0 002-2V8"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
        />
        <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" />
      </g>
    </svg>
  )
}