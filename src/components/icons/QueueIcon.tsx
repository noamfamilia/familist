/** Sync-queue indicator — geometry from repo root `queue.svg` (SVG Repo). */
const QUEUE_ICON_PATH_D =
  'M36,64a4.0002,4.0002,0,0,1,4-4H216a4,4,0,0,1,0,8H40A4.0002,4.0002,0,0,1,36,64Zm100,60H40a4,4,0,0,0,0,8h96a4,4,0,0,0,0-8Zm0,64H40a4,4,0,0,0,0,8h96a4,4,0,0,0,0-8Zm108-28a4.0011,4.0011,0,0,1-1.87988,3.39209l-64,40A4,4,0,0,1,172,200V120a4,4,0,0,1,6.12012-3.39209l64,40A4.0011,4.0011,0,0,1,244,160Zm-11.54687,0L180,127.2168v65.5664Z'

export function QueueIcon({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg
      className={`text-cyan shrink-0 ${className}`}
      viewBox="0 0 256 256"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path d={QUEUE_ICON_PATH_D} fill="currentColor" />
    </svg>
  )
}
