/** Sort / amount-down style icon (SVG Repo); uses currentColor for stroke. */
export function SortAmountDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M13 12H21M13 8H21M13 16H21M6 7V17M6 17L3 14M6 17L9 14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
