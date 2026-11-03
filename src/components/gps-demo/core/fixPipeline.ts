import { navigationTick, getArrowAngle, findActiveSegment, findNearestSegmentGlobal } from './navigation'
import { kalmanStep, measurementVariance } from './kalman'
import { medianFilterStep, INITIAL_OUTLIER_FILTER_STATE, type OutlierFilterState } from './outlierFilter'
import { resolveFixSpeed, resolveFixHeading, updateIsMoving, updateActivityMode, clampPlausibleSpeed, type ActivityMode } from './motion'
import { shouldBurstPerformance } from './gpsInterval'
import { haversineDistance } from './geo'
import type { GpsFix, LatLng, NavState } from './types'
import type { NavConfig } from '../config'

/** How long isMoving must read false before the displayed dot freezes, in ms. */
export const SUSTAINED_STOP_MS = 800

/** EMA smoothing factor for the walking speed that drives the adaptive GPS poll interval. */
export const SPEED_EMA_ALPHA = 0.4

/**
 * Everything the fix pipeline carries between calls. On a caller with no persistent
 * loop (React) this is held in refs; on hardware it's just a struct living across
 * main-loop ticks. No wall-clock reads happen inside this module except via the
 * caller-supplied `nowMs`, so the whole pipeline is time-source-agnostic.
 */
export interface FixPipelineState {
  navState: NavState
  position: LatLng | null
  prevPosition: LatLng | null
  hasFix: boolean
  lastFixTimeMs: number | null
  speedMs: number
  isMoving: boolean
  isStationary: boolean
  stoppedSinceMs: number | null
  lastSharpTurnFixMs: number | null
  kfLat: { x: number; p: number } | null
  kfLng: { x: number; p: number } | null
  outlierFilter: OutlierFilterState
  gpsBurstActive: boolean
  activityMode: ActivityMode
}

export const INITIAL_FIX_PIPELINE_STATE: FixPipelineState = {
  navState: { // overwritten by caller with INITIAL_NAV_STATE; kept here only to satisfy the type
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
  },
  position: null,
  prevPosition: null,
  hasFix: false,
  lastFixTimeMs: null,
  speedMs: 1.2,
  isMoving: true,
  isStationary: false,
  stoppedSinceMs: null,
  lastSharpTurnFixMs: null,
  kfLat: null,
  kfLng: null,
  outlierFilter: INITIAL_OUTLIER_FILTER_STATE,
  gpsBurstActive: false,
  activityMode: 'walk',
}

/** Resets everything a fresh GPS/simulator session needs re-acquired, keeping route-independent fields (activityMode) intact. */
export function resetFixAcquisition(state: FixPipelineState): FixPipelineState {
  return {
    ...state,
    hasFix: false,
    lastFixTimeMs: null,
    speedMs: 1.2,
    isMoving: true,
    isStationary: false,
    stoppedSinceMs: null,
    lastSharpTurnFixMs: null,
    kfLat: null,
    kfLng: null,
    outlierFilter: INITIAL_OUTLIER_FILTER_STATE,
  }
}

export interface MoveResult {
  state: FixPipelineState
  /** Position to render — frozen at the previous position during a sustained stop. */
  displayPos: LatLng
  positionChanged: boolean
}

/**
 * Advances nav state from a new position sample (real fix or simulator step).
 * Freezes the rendered dot once stopped for SUSTAINED_STOP_MS so Kalman noise
 * doesn't visibly wander a standing hiker, while nav-state tracking keeps using
 * the live sample underneath.
 *
 * `dopplerHeadingDeg` — already-resolved (trusted/untrusted) GPS chip heading
 * for this sample, from `resolveFixHeading` (core/motion.ts) — see
 * `computeMovementBearing`'s doc (navigation.ts) for why this takes priority
 * over position-delta bearing. Omitted callers (simulators that don't model a
 * GPS chip's Doppler output) keep the original position-delta-only behaviour.
 */
export function applyMove(
  state: FixPipelineState,
  newPos: LatLng,
  route: LatLng[],
  config: NavConfig,
  nowMs: number,
  rawPos?: LatLng,
  dopplerHeadingDeg: number | null = null,
): MoveResult {
  const prev = state.position
  const stoppedSinceMs = state.isMoving ? null : (state.stoppedSinceMs ?? nowMs)
  const sustainedStop = stoppedSinceMs !== null && nowMs - stoppedSinceMs > SUSTAINED_STOP_MS
  const displayPos = !sustainedStop || prev === null ? newPos : prev

  const positionChanged =
    prev === null ||
    Math.abs(displayPos.lat - prev.lat) > 1e-9 ||
    Math.abs(displayPos.lng - prev.lng) > 1e-9

  const nextPrevPosition = positionChanged ? prev : state.prevPosition
  const nextPosition = positionChanged ? displayPos : state.position

  if (route.length === 0) {
    return {
      state: { ...state, stoppedSinceMs, prevPosition: nextPrevPosition, position: nextPosition },
      displayPos,
      positionChanged,
    }
  }

  let nextNav = navigationTick(
    newPos,
    state.prevPosition,
    route,
    state.navState,
    config,
    rawPos,
    !sustainedStop,
    state.speedMs,
    dopplerHeadingDeg,
  )
  if (sustainedStop && prev !== null) {
    // Recompute the arrow from displayPos (not newPos) so it stays consistent with the frozen dot instead of snapping when the freeze releases.
    const arrowAngle = getArrowAngle(displayPos, nextNav.movementBearing, route, nextNav.activeSegIdx, state.speedMs)
    nextNav = { ...nextNav, arrowAngle: arrowAngle ?? nextNav.arrowAngle }
  }

  // Turns navState.sharpTurnJustCrossed into a wall-clock timestamp — the only place NavState's pure, time-free corner signal becomes a cooldown timer.
  const lastSharpTurnFixMs = nextNav.sharpTurnJustCrossed ? nowMs : state.lastSharpTurnFixMs

  return {
    state: { ...state, navState: nextNav, stoppedSinceMs, prevPosition: nextPrevPosition, position: nextPosition, lastSharpTurnFixMs },
    displayPos,
    positionChanged,
  }
}

export interface SmoothFixResult {
  state: FixPipelineState
  /** Smoothed (Kalman-filtered) position for this fix. */
  pos: LatLng
  /** Raw, unfiltered fix position — for debug overlays. */
  rawPos: LatLng
  /** Median-of-N filtered position — the intermediate input to the Kalman step, for debug overlays. */
  medianPos: LatLng
  /**
   * Instantaneous resolved speed (m/s) for THIS fix — Doppler-preferred, clamped,
   * pre-EMA (see `resolveFixSpeed`) — or null on the first fix / when neither
   * Doppler nor a position delta was available. Exposed so callers can gate other
   * instantaneous (not smoothed) decisions on the same speed reading `isMoving`
   * used, e.g. `resolveFixHeading`'s Doppler-heading trust check in `processFix`.
   */
  fixSpeedMs: number | null
}

/**
 * Outlier pre-filter + Kalman smoothing + speed/moving/activity update for one raw
 * GPS fix — the portion of the pipeline upstream of route/nav-state tracking.
 * Split out from `processFix` so callers that model their own display/glide layer
 * (e.g. the headless save-mode simulators, which feed the smoothed fix straight into
 * `navigationTick` with no stationary-freeze) can reuse the exact smoothing math
 * without also taking `processFix`'s `applyMove` freeze behavior.
 */
export function smoothFix(
  state: FixPipelineState,
  fix: GpsFix,
  config: NavConfig,
  nowMs: number,
  gpsModeIsAuto: boolean,
  speedClamp: (speedMs: number) => number = clampPlausibleSpeed,
): SmoothFixResult {
  const elapsedS = state.lastFixTimeMs !== null ? Math.min((nowMs - state.lastFixTimeMs) / 1000, 30) : 0
  const accuracyM = isFinite(fix.accuracy) ? fix.accuracy : 20
  const rawPos: LatLng = { lat: fix.lat, lng: fix.lng }

  // Median-of-N pre-filter: outlier-robust, damps the bearing swings a single noisy fix would otherwise cause at save-mode's sparse spacing.
  const medianResult = medianFilterStep(state.outlierFilter, rawPos, elapsedS)
  const medianPos = medianResult.pos

  // Measurement variance R, with large-jump inflation on-route (multipath), but not for a legitimate stray near the off-route threshold.
  let jumpM = 0
  if (state.hasFix && state.kfLat && state.kfLng) {
    jumpM = haversineDistance({ lat: state.kfLat.x, lng: state.kfLng.x }, medianPos)
  }
  const onRoute = state.navState.distanceOffRoute <= config.offRouteThresholdM
  const rawPerpFar = state.navState.distanceOffRoute > 8
  const R = measurementVariance(accuracyM, jumpM, onRoute, rawPerpFar, elapsedS, state.speedMs)

  const kfLat = kalmanStep(state.kfLat, medianPos.lat, R, elapsedS, state.speedMs)
  const kfLng = kalmanStep(state.kfLng, medianPos.lng, R, elapsedS, state.speedMs)
  const pos: LatLng = { lat: kfLat.x, lng: kfLng.x }

  const afterFilter: FixPipelineState = { ...state, outlierFilter: medianResult.state, kfLat, kfLng }

  if (!state.hasFix) {
    const firstFixSpeedMs = isFinite(fix.speedMs) ? speedClamp(fix.speedMs) : 1.2
    const acquired: FixPipelineState = {
      ...afterFilter,
      hasFix: true,
      lastFixTimeMs: nowMs,
      speedMs: firstFixSpeedMs,
      isMoving: true,
    }
    return { state: acquired, pos, rawPos, medianPos, fixSpeedMs: firstFixSpeedMs }
  }

  const prev = state.position

  // Prefer the GPS chip's Doppler speed (reliable stop signal), fall back to position-delta speed.
  const deltaSpeed = prev && elapsedS > 0.1 && elapsedS < 30 ? haversineDistance(prev, pos) / elapsedS : null
  const fixSpeed = resolveFixSpeed(fix.speedMs, deltaSpeed, speedClamp)

  let { isMoving, isStationary, speedMs, activityMode } = afterFilter
  if (fixSpeed !== null) {
    // Gated on instantaneous clamped speed (not the EMA) so a real stop is detected within one fix instead of decaying over several.
    isMoving = updateIsMoving(state.isMoving, fixSpeed)
    isStationary = !isMoving
    speedMs = SPEED_EMA_ALPHA * fixSpeed + (1 - SPEED_EMA_ALPHA) * state.speedMs
    if (gpsModeIsAuto) {
      activityMode = updateActivityMode(state.activityMode, speedMs)
    }
  }

  const afterSpeed: FixPipelineState = {
    ...afterFilter,
    isMoving, isStationary, speedMs, activityMode,
    lastFixTimeMs: nowMs,
  }
  return { state: afterSpeed, pos, rawPos, medianPos, fixSpeedMs: fixSpeed }
}

export interface ProcessFixResult {
  state: FixPipelineState
  /** Smoothed (Kalman-filtered) position for this fix. */
  pos: LatLng
  /** Raw, unfiltered fix position — for debug overlays. */
  rawPos: LatLng
  /** True once this fix should trigger the GPS-acquired flash/UI. */
  isFirstFix: boolean
}

/**
 * Runs one raw GPS fix through the full pipeline: outlier pre-filter, Kalman
 * smoothing, first-fix route snap, speed/activity update, corner-burst
 * exit check, and the move/nav-state update (via applyMove). Pure aside from
 * `nowMs`, so a caller supplies wall-clock time (React: performance.now();
 * firmware: a tick counter) and owns all persistence/rendering.
 */
export function processFix(
  state: FixPipelineState,
  fix: GpsFix,
  route: LatLng[],
  config: NavConfig,
  nowMs: number,
  gpsModeIsAuto: boolean,
): ProcessFixResult {
  const isFirstFix = !state.hasFix
  const smoothed = smoothFix(state, fix, config, nowMs, gpsModeIsAuto)
  const { pos, rawPos } = smoothed
  // Gated on the instantaneous resolved speed (not the smoothed EMA) — same
  // reasoning as isMoving in smoothFix: heading trust should react to a real
  // stop/resume within one fix, not lag behind the EMA's decay.
  const dopplerHeadingDeg = resolveFixHeading(fix.heading, smoothed.fixSpeedMs ?? smoothed.state.speedMs)

  if (isFirstFix) {
    let navState = smoothed.state.navState
    if (route.length >= 2) {
      // Nearest-fold search so a closed loop's shared start/end node snaps to the start, not the end.
      const segIdx = findNearestSegmentGlobal(pos, route)
      navState = { ...navState, activeSegIdx: segIdx }
    }
    const acquired: FixPipelineState = { ...smoothed.state, navState, prevPosition: null }
    const moved = applyMove(acquired, pos, route, config, nowMs, rawPos, dopplerHeadingDeg)
    return { state: moved.state, pos, rawPos, isFirstFix: true }
  }

  // Fresh segment/off-route reading for THIS fix (cheap, not a full nav tick) so the burst-exit check reacts the same fix the threshold is crossed, not one fix late.
  const { segIdx: freshSegIdx, distanceOffRoute: freshDistanceOffRoute } = findActiveSegment(
    pos, route, state.navState.activeSegIdx, rawPos, config.offRouteThresholdM,
  )
  const freshTarget = route[Math.min(freshSegIdx + 1, route.length - 1)]
  const freshDistanceToNext = freshTarget ? haversineDistance(pos, freshTarget) : state.navState.distanceToNext

  let gpsBurstActive = smoothed.state.gpsBurstActive
  if (gpsBurstActive) {
    const stillNearCorner = shouldBurstPerformance({
      route,
      activeWaypointIdx: freshSegIdx + 1,
      distanceToNext: freshDistanceToNext,
      speedMs: smoothed.state.speedMs,
      msSinceCornerPass: state.lastSharpTurnFixMs !== null ? nowMs - state.lastSharpTurnFixMs : null,
      cornerWpIdx: state.navState.lastSharpTurnWpIdx,
      pos,
      distanceOffRoute: freshDistanceOffRoute,
      offRouteThresholdM: config.offRouteThresholdM,
      arrowAngleDeg: Math.abs(state.navState.arrowAngle),
      arrowTurnThresholdDeg: config.arrowTurnThresholdDeg,
    })
    if (!stillNearCorner) gpsBurstActive = false
  }

  const moved = applyMove({ ...smoothed.state, gpsBurstActive }, pos, route, config, nowMs, rawPos, dopplerHeadingDeg)
  return { state: moved.state, pos, rawPos, isFirstFix: false }
}
