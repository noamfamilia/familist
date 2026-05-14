/** Category editor trigger — red ring, teal outline, white center (matches list category control affordance). */
export function CategoryEditorIcon({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="24" cy="24" r="15" className="fill-red-500 stroke-teal" strokeWidth="2.5" />
      <circle cx="24" cy="24" r="8" className="fill-white" />
    </svg>
  )
}
