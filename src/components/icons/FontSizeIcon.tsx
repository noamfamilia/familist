/** Font size / typography control (SVG Repo–style A’s; strokes use currentColor). */
export function FontSizeIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <g stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" fill="none">
        <polyline points="28,43 43,1 44,1 59,43" />
        <line x1="33" y1="29" x2="54" y2="29" />
      </g>
      <g stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" fill="none">
        <polyline points="5,43 13,20 14,20 22,43" />
        <line x1="7" y1="36" x2="20" y2="36" />
      </g>
      <polyline stroke="currentColor" strokeWidth="2" strokeLinejoin="bevel" strokeMiterlimit="10" fill="none" points="56,63 63,56 56,49" />
      <polyline stroke="currentColor" strokeWidth="2" strokeLinejoin="bevel" strokeMiterlimit="10" fill="none" points="8,49 1,56 8,63" />
      <line stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" x1="63" y1="56" x2="1" y2="56" />
    </svg>
  )
}
