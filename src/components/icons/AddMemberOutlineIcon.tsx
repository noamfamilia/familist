/** Person + small plus, stroke-only (for teal outline in menus). */
export function AddMemberOutlineIcon({ className }: { className?: string }) {
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
      <circle cx={9} cy={8} r={3.5} stroke="currentColor" strokeWidth={1.75} />
      <path
        d="M4 19v0a5 5 0 0 1 10 0"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
      />
      <path d="M17 10v4M15 12h4" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" />
    </svg>
  )
}
