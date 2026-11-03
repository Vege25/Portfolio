import type { LatLng } from './types'

/**
 * Median-of-N outlier-robust pre-filter for raw GPS fixes.
 *
 * At CONTINUOUS fix cadence (performance mode, ~100 ms apart), real
 * displacement per fix is small enough that a single noisy fix can swing the
 * fix-to-fix movement bearing — and so the arrow — by tens of degrees even
 * through the Kalman filter. Per-axis median-of-N is a cheap, outlier-robust
 * pre-filter there: unlike a mean, a single wild outlier can't drag the
 * result off the true position, only one of N samples toward it.
 *
 * That reasoning INVERTS at save-mode's sparse cadence (fixes up to ~12 s
 * apart): a fixed sample-count window of N=3 then spans up to N × 12 s of
 * real walking, so "median of the last 3 fixes" isn't averaging noise around
 * one true position anymore — it's blending three genuinely different
 * positions the hiker has already walked through, which INCREASES position
 * error and, via the bearing it feeds, produces exactly the wild arrow swings
 * this filter was meant to prevent. So the buffer is keyed on elapsed time,
 * not sample count: a fix older than MAX_SAMPLE_AGE_S is dropped before the
 * median is taken, so at sparse cadence the "window" collapses to just the
 * latest fix (median of 1 = itself, i.e. effectively bypassed) while at
 * continuous cadence it still holds the full outlier-rejecting window.
 *
 * Portable to C: fixed-size ring buffer (capacity OUTLIER_FILTER_N, aged
 * entries just unused rather than freed), no allocation beyond the buffer
 * itself, one insertion sort per axis over at most `N` elements.
 */

/** Ring-buffer capacity for the median filter. Odd so the median is a real sample, not an average. */
export const OUTLIER_FILTER_N = 3

/**
 * Maximum age (s) a buffered fix may reach before it's dropped from the
 * median window. Sized well above continuous-mode's ~100 ms cadence (so the
 * full N-sample window is available there) and well below save-mode's
 * multi-second cadence (so a sparse fix's window collapses to itself instead
 * of blending in fixes from many metres back down the trail).
 */
export const MAX_SAMPLE_AGE_S = 1.5

interface AgedSample {
  pos: LatLng
  ageS: number
}

export interface OutlierFilterState {
  /** Buffered recent fixes, oldest first, each carrying its age at last update. */
  buffer: AgedSample[]
}

export const INITIAL_OUTLIER_FILTER_STATE: OutlierFilterState = { buffer: [] }

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

/**
 * Push a fresh raw fix into the filter and return the median-filtered
 * position plus the updated state. Call once per raw fix, threading the
 * returned state into the next call.
 *
 * `elapsedS` — time since the previous fix (0 or omitted for the first fix).
 * Ages the existing buffer before dropping stale entries and appending the
 * new one, so the window always reflects real elapsed time, not fix count.
 */
export function medianFilterStep(
  state: OutlierFilterState,
  rawPos: LatLng,
  elapsedS = 0,
): { pos: LatLng; state: OutlierFilterState } {
  const aged = state.buffer
    .map((s) => ({ pos: s.pos, ageS: s.ageS + Math.max(0, elapsedS) }))
    .filter((s) => s.ageS <= MAX_SAMPLE_AGE_S)
  const buffer = [...aged, { pos: rawPos, ageS: 0 }].slice(-OUTLIER_FILTER_N)
  const pos: LatLng = {
    lat: median(buffer.map((s) => s.pos.lat)),
    lng: median(buffer.map((s) => s.pos.lng)),
  }
  return { pos, state: { buffer } }
}
