/**
 * Segmented timing for list first-paint. Filter console with `[list-paint]`.
 */

let originPerf: number | null = null
let lastPerf: number | null = null

let itemNameMeasureCount = 0
let itemNameMeasureTotalMs = 0

export function resetListPaintSegments(listId?: string): void {
  if (typeof window === 'undefined') return
  originPerf = performance.now()
  lastPerf = originPerf
  itemNameMeasureCount = 0
  itemNameMeasureTotalMs = 0
  logPaintSegment('click', listId ? { listId } : undefined, { skipDelta: true })
}

export function logPaintSegment(
  step: string,
  detail?: Record<string, unknown>,
  options?: { skipDelta?: boolean },
): void {
  if (typeof window === 'undefined' || typeof performance === 'undefined') return

  const now = performance.now()
  if (originPerf === null) {
    originPerf = now
    lastPerf = now
  }

  const sinceOrigin = Math.round(now - originPerf)
  const sinceLast =
    options?.skipDelta || lastPerf === null ? null : Math.round(now - lastPerf)
  if (!options?.skipDelta) lastPerf = now

  const iso = new Date().toISOString()
  const deltaStr = sinceLast == null ? '' : ` Δ+${sinceLast}ms`
  const detailStr =
    detail && Object.keys(detail).length > 0 ? ` ${JSON.stringify(detail)}` : ''

  console.log(`[list-paint] ${iso} t+${sinceOrigin}ms${deltaStr} ${step}${detailStr}`)
}

export function timePaintSegment<T>(
  step: string,
  fn: () => T,
  detail?: Record<string, unknown>,
): T {
  const t0 = performance.now()
  const result = fn()
  logPaintSegment(step, { ...detail, ms: Math.round(performance.now() - t0) })
  return result
}

export function recordItemNameMeasure(ms: number): void {
  itemNameMeasureCount += 1
  itemNameMeasureTotalMs += ms
}

export function flushItemNameMeasureSummary(): void {
  if (itemNameMeasureCount === 0) return
  logPaintSegment('width: ItemCard measureItemNameNaturalWidthPx (aggregate)', {
    count: itemNameMeasureCount,
    totalMs: Math.round(itemNameMeasureTotalMs),
    avgMs: Math.round((itemNameMeasureTotalMs / itemNameMeasureCount) * 100) / 100,
  })
  itemNameMeasureCount = 0
  itemNameMeasureTotalMs = 0
}
