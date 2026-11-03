import { bearing, haversineDistance, midpoint } from './geo'
import type { DensifyOptions, LatLng } from './types'
import { DEFAULT_DENSIFY_OPTIONS } from './types'

/**
 * Densify a GPX route by inserting additional waypoints at:
 *   1. Turns — whenever the bearing change exceeds TURN_THRESHOLD degrees.
 *   2. Long straights — whenever two consecutive points are > MAX_SPACING apart.
 *
 * Used by the POC simulator (the spacing fill keeps display dots dense enough
 * to visually represent the route and enables the map overlay of dense waypoints).
 *
 * Pure function — no DOM/Node deps, directly portable to C++.
 */
export function densify(route: LatLng[], options: DensifyOptions = DEFAULT_DENSIFY_OPTIONS): LatLng[] {
  if (route.length < 2) return [...route]

  const { turnThresholdDeg, maxSpacingMeters } = options

  let pts = insertTurnWaypoints(route, turnThresholdDeg, maxSpacingMeters)
  pts = fillSpacingGaps(pts, maxSpacingMeters)

  return pts
}

/**
 * Densify a GPX route for watch deployment — turn waypoints ONLY, no spacing fill.
 *
 * With segment-projection navigation, straights need no intermediate points:
 * the GPS position is projected onto the line segment itself, not snapped to
 * a nearby dot. Only turns need waypoints so the segment endpoints mark corners.
 *
 * Result: a 100 km route produces ~400–800 waypoints (~5 KB as float32)
 * instead of ~9,200 waypoints (147 KB) with max-spacing fill.
 *
 * Pure function — directly portable to C++.
 */
export function densifyTurnsOnly(route: LatLng[], turnThresholdDeg = 10): LatLng[] {
  if (route.length < 2) return [...route]
  // Re-use the same turn-detection pass; maxSpacing is only used for
  // subdivision of the segments adjacent to a turn (keeps them reasonable).
  return insertTurnWaypoints(route, turnThresholdDeg, 20)
}

/**
 * For each interior point, if the bearing change (turn angle) exceeds the threshold,
 * recursively subdivide the two adjacent segments until they are short enough.
 */
function insertTurnWaypoints(
  route: LatLng[],
  turnThresholdDeg: number,
  maxSpacingMeters: number,
): LatLng[] {
  const result: LatLng[] = [route[0]!]

  for (let i = 1; i < route.length - 1; i++) {
    const prev = route[i - 1]!
    const curr = route[i]!
    const next = route[i + 1]!

    const inBearing = bearing(prev, curr)
    const outBearing = bearing(curr, next)
    const angleDelta = Math.abs(normalizeAngleDelta(outBearing - inBearing))

    if (angleDelta > turnThresholdDeg) {
      // Subdivide the incoming segment and push midpoints
      const incoming = subdivideSegment(prev, curr, maxSpacingMeters)
      // Push all but first (already added) and last (curr itself)
      for (let j = 1; j < incoming.length - 1; j++) {
        result.push(incoming[j]!)
      }
    }

    result.push(curr)
  }

  result.push(route[route.length - 1]!)
  return result
}

/**
 * Recursively subdivide a segment until all sub-segments are <= maxSpacing.
 * Returns all points including both endpoints.
 */
function subdivideSegment(a: LatLng, b: LatLng, maxSpacingMeters: number): LatLng[] {
  const dist = haversineDistance(a, b)
  if (dist <= maxSpacingMeters) return [a, b]
  const mid = midpoint(a, b)
  const left = subdivideSegment(a, mid, maxSpacingMeters)
  const right = subdivideSegment(mid, b, maxSpacingMeters)
  // Merge: left ends with mid, right starts with mid — avoid duplicate
  return [...left, ...right.slice(1)]
}

/**
 * Walk the route and insert midpoints wherever two consecutive points
 * are more than maxSpacingMeters apart.
 */
function fillSpacingGaps(route: LatLng[], maxSpacingMeters: number): LatLng[] {
  const result: LatLng[] = [route[0]!]

  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!
    const b = route[i]!
    const dist = haversineDistance(a, b)

    if (dist > maxSpacingMeters) {
      const segments = subdivideSegment(a, b, maxSpacingMeters)
      // Push all except the first (already in result)
      for (let j = 1; j < segments.length; j++) {
        result.push(segments[j]!)
      }
    } else {
      result.push(b)
    }
  }

  return result
}

/**
 * Normalize bearing delta to (-180, 180].
 */
function normalizeAngleDelta(delta: number): number {
  let a = delta % 360
  if (a > 180) a -= 360
  if (a <= -180) a += 360
  return a
}
