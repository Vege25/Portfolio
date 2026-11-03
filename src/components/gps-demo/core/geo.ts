import type { LatLng } from './types'

const EARTH_RADIUS_M = 6_371_000

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

/**
 * Haversine distance in meters between two coordinates.
 * Portable to C: same formula, replace Math.* with standard math.h equivalents.
 */
export function haversineDistance(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/**
 * Forward bearing in degrees [0, 360) from point `from` to point `to`.
 * 0° = North, 90° = East, 180° = South, 270° = West.
 */
export function bearing(from: LatLng, to: LatLng): number {
  const dLng = toRad(to.lng - from.lng)
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)
  const x = Math.sin(dLng) * Math.cos(lat2)
  const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (toDeg(Math.atan2(x, y)) + 360) % 360
}

/**
 * Normalize an angle to the range (-180, 180].
 * Used for arrow display: 0° = straight ahead, positive = right, negative = left.
 */
export function normalizeAngle(deg: number): number {
  let a = deg % 360
  if (a > 180) a -= 360
  if (a <= -180) a += 360
  return a
}

/**
 * Exponentially ease a displayed bearing toward a target, taking the
 * shortest arc across the 0/360° wrap (via `normalizeAngle`) and never
 * overshooting once within `snapEpsilonDeg` of the target. Pure, stateless —
 * callers own the "current" value between calls (a ref, a struct field,
 * whatever their platform uses).
 *
 * General-purpose version of the exponential-ease shape used by
 * `core/arrowEase.ts` (which additionally layers a slew-rate cap and a
 * post-big-jump settle hold for the arrow widget specifically) — this one is
 * for simpler callers, like a map's bearing cone, that don't need that extra
 * state machine. Was duplicated inline in MapView.tsx before being factored
 * out here.
 *
 * `speed` — higher eases faster; same units/shape as ARROW_EASE_SPEED
 * (core/arrowEase.ts), so a value of 4-6 "feels" comparable between the two.
 */
export function easeBearingTowards(
  current: number,
  target: number,
  dtS: number,
  speed: number,
  snapEpsilonDeg = 0.1,
): number {
  const diff = normalizeAngle(target - current)
  if (dtS <= 0 || Math.abs(diff) <= snapEpsilonDeg) return current
  return current + diff * (1 - Math.exp(-dtS * speed))
}

/**
 * Interpolate a midpoint between two coordinates.
 */
export function midpoint(a: LatLng, b: LatLng): LatLng {
  return {
    lat: (a.lat + b.lat) / 2,
    lng: (a.lng + b.lng) / 2,
  }
}

/**
 * Linear lat/lng interpolation between two nearby points (`t=0` → `a`,
 * `t=1` → `b`). Flat-earth-adequate at the tens-of-metres scale this is used
 * at (see getDesiredBearing in navigation.ts) — not a great-circle
 * interpolation, which isn't needed since `a`/`b` are always close together.
 */
export function lerpLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  }
}

export interface SegmentProjection {
  /** Scalar position along the segment: 0 = at point A, 1 = at point B. */
  t: number
  /** Perpendicular distance in meters from `pos` to the nearest point on the segment. */
  distance: number
}

/**
 * Project `pos` onto the line segment [a, b] and return the perpendicular
 * distance and the scalar t ∈ [0, 1] along the segment.
 *
 * Uses a flat-earth approximation: lat/lng differences are converted to metres
 * using cos(avgLat) scaling. Error < 0.3% at 60° latitude — well within GPS
 * noise and perfectly adequate for route-snapping.
 *
 * Portable to C++: only basic arithmetic and one sqrt/dot product.
 */
export function projectOntoSegment(pos: LatLng, a: LatLng, b: LatLng): SegmentProjection {
  const RAD = Math.PI / 180
  const avgLat = ((a.lat + b.lat) / 2) * RAD
  const cosLat = Math.cos(avgLat)
  const R = EARTH_RADIUS_M

  // Convert to approximate flat-earth metres (origin at A)
  const ax = 0
  const ay = 0
  const bx = (b.lng - a.lng) * cosLat * R * RAD
  const by = (b.lat - a.lat) * R * RAD
  const px = (pos.lng - a.lng) * cosLat * R * RAD
  const py = (pos.lat - a.lat) * R * RAD

  const segLenSq = bx * bx + by * by

  let t: number
  if (segLenSq === 0) {
    // Degenerate segment (A === B) — return distance to A
    t = 0
  } else {
    // Scalar projection of AP onto AB, clamped to [0, 1]
    t = Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / segLenSq))
  }

  // Closest point on segment
  const cx = ax + t * bx
  const cy = ay + t * by

  const dx = px - cx
  const dy = py - cy
  const distance = Math.sqrt(dx * dx + dy * dy)

  return { t, distance }
}

/**
 * Move a position by `distanceMeters` in the given bearing.
 * Used by the GPS simulator.
 */
export function movePosition(pos: LatLng, bearingDeg: number, distanceMeters: number): LatLng {
  const angDist = distanceMeters / EARTH_RADIUS_M
  const bearRad = toRad(bearingDeg)
  const lat1 = toRad(pos.lat)
  const lng1 = toRad(pos.lng)
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angDist) + Math.cos(lat1) * Math.sin(angDist) * Math.cos(bearRad),
  )
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearRad) * Math.sin(angDist) * Math.cos(lat1),
      Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2),
    )
  return {
    lat: toDeg(lat2),
    lng: toDeg(lng2),
  }
}

/** Whether `lat`/`lng` are finite and within valid coordinate ranges. */
export function isValidLatLng(lat: number, lng: number): boolean {
  return isFinite(lat) && isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

/** 8-point compass labels, indexed by `Math.round(bearingDeg / 45) % 8`. */
const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

/** Bucket a bearing (degrees) into its nearest 8-point compass label (N/NE/E/...). */
export function bearingToCompassLabel(bearingDeg: number): string {
  return COMPASS_POINTS[Math.round(bearingDeg / 45) % 8] ?? 'N'
}
