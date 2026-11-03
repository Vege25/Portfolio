import { bearing, haversineDistance, movePosition } from './geo'
import { getArrowAngle, navigationTick } from './navigation'
import type { LatLng, NavState } from './types'
import type { NavConfig } from '../config'

export interface AutoWalkStepResult {
  newPos: LatLng
  navState: NavState
  /** Bearing of this movement step (for map marker). */
  moveBearing: number
  finished: boolean
}

/**
 * Advance one auto-walk tick along the dense route.
 *
 * Moves toward the current segment end (activeSegIdx + 1), then runs
 * navigationTick so the arrow uses the same state as real GPS updates.
 */
export function autoWalkStep(
  pos: LatLng,
  route: LatLng[],
  navState: NavState,
  metersPerTick: number,
  config: NavConfig,
  speedMs?: number,
): AutoWalkStepResult | null {
  if (route.length < 2 || metersPerTick <= 0) return null

  const targetIdx = Math.min(navState.activeSegIdx + 1, route.length - 1)
  const target = route[targetIdx]
  if (!target) return null

  let dist = haversineDistance(pos, target)
  let moveBearing = dist > 1e-6 ? bearing(pos, target) : navState.movementBearing

  // Sitting exactly on a waypoint — step onto the next segment.
  if (dist < config.jitterThresholdM && targetIdx < route.length - 1) {
    const next = route[targetIdx + 1]!
    dist = haversineDistance(pos, next)
    moveBearing = dist > 1e-6 ? bearing(pos, next) : moveBearing
  }

  const moveBy = Math.max(0, Math.min(metersPerTick, dist))
  const newPos = moveBy > 0 ? movePosition(pos, moveBearing, moveBy) : pos

  const newNavState = navigationTick(newPos, pos, route, navState, config, undefined, true, speedMs)

  // Auto-walk steps can be shorter than jitterThresholdM — use step bearing so
  // the arrow tracks the route instead of staying at the initial 0° heading.
  const movementBearing = moveBy > 0 ? moveBearing : newNavState.movementBearing
  const arrowAngle = getArrowAngle(newPos, movementBearing, route, newNavState.activeSegIdx, speedMs)

  const navWithBearing = {
    ...newNavState,
    movementBearing,
    arrowAngle: arrowAngle ?? newNavState.arrowAngle,
  }

  const finished =
    targetIdx >= route.length - 1 &&
    haversineDistance(newPos, route[route.length - 1]!) <= metersPerTick + 1

  return { newPos, navState: navWithBearing, moveBearing: movementBearing, finished }
}

/** Initialise nav state when the hiker is placed at the route start. */
export function navStateAtRouteStart(
  start: LatLng,
  route: LatLng[],
  config: NavConfig,
): NavState {
  const state = navigationTick(start, null, route, {
    activeSegIdx: 0,
    movementBearing: 0,
    hasConfidentBearing: false,
    arrowAngle: 0,
    distanceToNext: 0,
    distanceOffRoute: 0,
    bearingAnchorPos: null,
    pendingBearing: null,
    lastSharpTurnWpIdx: null,
    sharpTurnJustCrossed: false,
  }, config)

  if (route.length < 2) return state

  // Face the first segment so the arrow starts straight (0°) before the first step.
  const segBearing = bearing(start, route[1]!)
  return { ...state, movementBearing: segBearing, hasConfidentBearing: true, arrowAngle: 0 }
}
