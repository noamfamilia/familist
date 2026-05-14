/**
 * Goal / dartboard mark (from repo `goal.svg`), stroke-only for teal menu icons.
 */
export function GoalMenuIcon({ className }: { className?: string }) {
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
      <polygon
        points="15 6 15 9 18 9 21 6 18 6 18 3 15 6"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <path
        d="M15,9l-2.5,2.5M15,6V9h3l3-3H18V3Z"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.33,3H12a9,9,0,1,0,9,9c0-.11,0-.22,0-.33"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.9,13A5,5,0,1,1,11,7.1"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
