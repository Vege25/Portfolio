import { projectOntoSegment } from './geo'
import type { LatLng } from './types'

/**
 * Douglas-Peucker polyline simplification.
 *
 * Removes points whose perpendicular distance from the straight line between
 * their neighbours is below `toleranceM` metres. Keeps the first and last
 * point unconditionally.
 *
 * Why this helps battery-save mode:
 *   Dense GPS recordings (e.g. Komoot every 3–5 s) produce a point every
 *   ~4–17 m, so even gentle trail meanders register as many tiny turn
 *   waypoints — keeping arrowAngle high and pinning the GPS poll at 1 s all
 *   the time.  After simplification (5 m tolerance) genuine forest straights
 *   become single 100–400 m segments → no spurious corners → GPS correctly
 *   backs off to 5 s → real battery saving.
 *
 * Navigation accuracy is not affected: all corners with max-deviation > 5 m
 * are preserved.  A 90° turn on a 17 m segment has max-deviation ≈ 12 m,
 * well above the 5 m threshold.
 *
 * The original raw route is kept unchanged for map display.
 * Only the navigation (dense) route is simplified.
 *
 * Pure function — portable to C++.
 */
export function douglasPeucker(points: LatLng[], toleranceM: number): LatLng[] {
  if (points.length <= 2) return [...points]
  return _dp(points, 0, points.length - 1, toleranceM)
}

function _dp(pts: LatLng[], start: number, end: number, tol: number): LatLng[] {
  if (end - start < 2) {
    // Only two (or one) points: return both endpoints
    const result: LatLng[] = [pts[start]!]
    if (end > start) result.push(pts[end]!)
    return result
  }

  // Find the interior point with the largest perpendicular distance
  let maxDist = 0
  let maxIdx  = start + 1

  for (let i = start + 1; i < end; i++) {
    const { distance } = projectOntoSegment(pts[i]!, pts[start]!, pts[end]!)
    if (distance > maxDist) {
      maxDist = distance
      maxIdx  = i
    }
  }

  if (maxDist > tol) {
    // Keep this point — recurse on both halves
    const left  = _dp(pts, start, maxIdx, tol)
    const right = _dp(pts, maxIdx, end, tol)
    // left ends with pts[maxIdx], right starts with pts[maxIdx] — merge without duplicate
    return [...left, ...right.slice(1)]
  }

  // All interior points are within tolerance — flatten to endpoints only
  return [pts[start]!, pts[end]!]
}
