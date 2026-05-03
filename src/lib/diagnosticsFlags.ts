/**
 * Debug toggles for diagnostics / perf buffering.
 * For full legacy behavior, set **both** to `true` (panel + in-memory nav/perf buffers).
 */

/** When false, nav/perf lines are not appended to React state (no in-memory buffer growth). */
export const DIAGNOSTICS_DATA_COLLECTION_ENABLED = true

/** When false, the bottom diagnostics panel is not rendered. */
export const DIAGNOSTICS_PANEL_VISIBLE = true
