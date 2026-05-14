import { SUM_RING_D } from '@/components/icons/ShowItemSumIcon'

/** Outer ring from `sum.svg` only, with a diagonal strike in `currentColor` (teal in menu). */
export function HideItemSumIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width={20} height={20} viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path fill="currentColor" d={SUM_RING_D} />
      <line
        x1="104"
        y1="408"
        x2="408"
        y2="104"
        stroke="currentColor"
        strokeWidth={40}
        strokeLinecap="round"
      />
    </svg>
  )
}
