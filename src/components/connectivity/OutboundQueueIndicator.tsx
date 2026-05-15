'use client'

import { QueueIcon } from '@/components/icons/QueueIcon'
import { useOutboundQueueIndicator } from '@/hooks/useOutboundQueueIndicator'

export function OutboundQueueIndicator({ className }: { className?: string }) {
  const { shouldShow, queueCount } = useOutboundQueueIndicator()

  if (!shouldShow) return null

  return (
    <span
      className={`inline-flex items-center gap-0.5 ${className ?? ''}`}
      role="status"
      aria-live="polite"
      aria-label={`${queueCount} changes waiting to sync`}
    >
      <QueueIcon className="h-8 w-8" />
      <span className="text-cyan text-sm font-semibold tabular-nums leading-none">{queueCount}</span>
    </span>
  )
}
