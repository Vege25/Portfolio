import { bearing, haversineDistance, movePosition, projectOntoSegment } from './geo'
import type { LatLng } from './types'

/**
 * Pure-pursuit lookahead primitive: walk forward along a route polyline from
 * an anchor position by a fixed distance.
 *
 * Portable to C: only basic arithmetic + the geo helpers, no allocation beyond
 * the returned struct.
 */

export interface DeadReckonResult {
  /** Projected position along the route. */
  pos: LatLng
  /** Route bearing at the projected position (degrees, 0–360). */
  bearing: number
  /**
   * `anchorPos` projected onto its segment — the on-route point the lookahead
   * walk started from, before walking forward. Exposed so callers (see
   * getDesiredBearing in navigation.ts) can measure a bearing FROM this
   * stable on-route point instead of from the possibly noise-offset
   * `anchorPos` itself.
   */
  projectedPos: LatLng
}

/**
 * Walk forward along `route` starting from `anchorPos` (which is assumed to lie
 * on or near segment `anchorSegIdx`) by `distanceM` metres.
 *
 * `anchorSegIdx` is the index `i` such that the active segment is
 * `route[i] → route[i + 1]`.
 *
 * Returns null when the route is too short or `distanceM` is not positive, so
 * the caller can fall back to the raw anchor position.
 */
export function deadReckonAlongRoute(
  anchorPos: LatLng,
  anchorSegIdx: number,
  route: LatLng[],
  distanceM: number,
): DeadReckonResult | null {
  if (route.length < 2) return null
  if (!Number.isFinite(distanceM) || distanceM <= 0) return null

  const maxSeg = route.length - 2
  let segIdx = Math.max(0, Math.min(anchorSegIdx, maxSeg))

  // Project the anchor onto its segment so we start from the closest on-route
  // point, not from a laterally-offset GPS position.
  const segStart = route[segIdx]!
  const segEnd = route[segIdx + 1]!
  const { t } = projectOntoSegment(anchorPos, segStart, segEnd)
  const segLen = haversineDistance(segStart, segEnd)
  const projectedPos = segLen > 1e-6 ? movePosition(segStart, bearing(segStart, segEnd), t * segLen) : segStart

  let remaining = distanceM
  // Metres already consumed within the current segment by the projection point.
  let consumedInSeg = t * segLen

  // Advance segment by segment along the polyline.
  while (segIdx <= maxSeg) {
    const a = route[segIdx]!
    const b = route[segIdx + 1]!
    const len = haversineDistance(a, b)
    const availableInSeg = len - consumedInSeg

    if (remaining <= availableInSeg || segIdx === maxSeg) {
      // The projection lands inside this segment (or we've run out of route).
      const travelInSeg = Math.min(consumedInSeg + remaining, len)
      const segBearing = len > 1e-6 ? bearing(a, b) : bearing(anchorPos, b)
      const pos = movePosition(a, segBearing, travelInSeg)
      return { pos, bearing: segBearing, projectedPos }
    }

    remaining -= availableInSeg
    consumedInSeg = 0
    segIdx += 1
  }

  // Fell off the end of the route — clamp to the final waypoint.
  const last = route[route.length - 1]!
  const prev = route[route.length - 2]!
  return { pos: last, bearing: bearing(prev, last), projectedPos: last }
}
