import type { GpsMode } from '../config'

/**
 * Activity classification from ground speed. Drives the GPS polling strategy:
 * walking gets maximum battery saving, running adds short performance-mode
 * bursts through corners, cycling/driving stays in performance mode throughout
 * (covering ground fast enough that any polling gap risks missing a turn).
 *
 * Single source of truth for "how fast is the hiker/runner/rider going" so the
 * GPS interval, dead-reckoning speed clamp, and activity-mode UI all agree —
 * previously each read the same speedMs but assumed a walking-only range.
 */
export type ActivityMode = 'walk' | 'run' | 'bike'

/**
 * Upper bound (m/s) for a plausible walking speed. Above this a measured speed
 * is either a run/ride or a GPS artifact — either way the walking-only clamp
 * that used to apply everywhere must not clip it.
 */
export const WALK_UPPER_MS = 2.2 // ~8 km/h

/** Speed (m/s) below which a run/bike reading reverts toward walk (hysteresis). */
export const WALK_UPPER_EXIT_MS = 1.9 // ~6.8 km/h

/** Upper bound (m/s) for a plausible running speed. */
export const RUN_UPPER_MS = 5.0 // ~18 km/h

/** Speed (m/s) below which a bike reading reverts toward run (hysteresis). */
export const RUN_UPPER_EXIT_MS = 4.3 // ~15.5 km/h

/**
 * Upper bound (m/s) for a plausible on-foot/cycling speed used to clamp the
 * speed EMA before it feeds the Kalman filter and dead reckoning. Above this a
 * measured speed is a GPS artifact (an outlier fix divided by a short
 * interval), not real motion. ~40 m/s ≈ 144 km/h covers cycling and casual
 * driving; a genuine highway speed would need this raised further.
 */
export const MAX_PLAUSIBLE_SPEED_MS = 40

/** Clamp a raw measured speed to a plausible moving range for the EMA. */
export function clampPlausibleSpeed(speedMs: number): number {
  if (!Number.isFinite(speedMs) || speedMs < 0) return 0
  return Math.min(speedMs, MAX_PLAUSIBLE_SPEED_MS)
}

/**
 * Classify ground speed into an activity mode, with hysteresis at both
 * boundaries so a speed hovering near a threshold (e.g. a runner slowing at a
 * light) doesn't flicker the GPS strategy fix-to-fix. Only moves one band at a
 * time per call — a genuine mode change still settles within a couple of fixes
 * since callers re-invoke this on every fix.
 */
export function updateActivityMode(prev: ActivityMode, speedMs: number): ActivityMode {
  if (!Number.isFinite(speedMs)) return prev

  if (prev === 'walk') {
    return speedMs > WALK_UPPER_MS ? 'run' : 'walk'
  }
  if (prev === 'run') {
    if (speedMs > RUN_UPPER_MS) return 'bike'
    if (speedMs < WALK_UPPER_EXIT_MS) return 'walk'
    return 'run'
  }
  // prev === 'bike'
  return speedMs < RUN_UPPER_EXIT_MS ? 'run' : 'bike'
}

/**
 * GPS strategy for an activity mode:
 *  - walk / run: adaptive battery-save polling, with a temporary performance
 *    burst through corners (see shouldBurstPerformance) — a corner can be
 *    walked or run through in the time a single save-mode poll takes to
 *    resolve, so save mode alone under-serves the turn at any foot speed.
 *  - bike: always performance mode — covering enough ground per second that
 *    any polling gap risks missing a turn entirely.
 */
export function gpsModeForActivity(activity: ActivityMode): Exclude<GpsMode, 'auto'> {
  return activity === 'bike' ? 'performance' : 'save'
}

/**
 * Turn-anticipation start distance (m) scaled for activity — covering more
 * ground per second means the arrow must start anticipating a turn earlier to
 * give the same reaction time. Baseline is tuned for walking; run/bike scale
 * it up roughly with typical top-of-range speed.
 */
export function turnAnticipationForActivity(activity: ActivityMode, baselineM: number): number {
  if (activity === 'bike') return baselineM * 2.5
  if (activity === 'run') return baselineM * 1.5
  return baselineM
}

// ── On-foot speed clamp + stop/moving detection ────────────────────────────

/**
 * Upper bound (m/s) for a plausible on-foot speed. A measured speed above this
 * is a GPS artifact (an outlier fix divided by a short interval), not real
 * motion — clamp it before it inflates the speed EMA, which would otherwise
 * both shorten the GPS poll interval and make dead reckoning overshoot.
 * ~4 m/s ≈ 14 km/h — covers running, rejects glitches.
 */
export const MAX_ON_FOOT_SPEED_MS = 4

/** Clamp a raw measured speed to a plausible on-foot range for the EMA. */
export function clampWalkingSpeed(speedMs: number): number {
  if (!Number.isFinite(speedMs) || speedMs < 0) return 0
  return Math.min(speedMs, MAX_ON_FOOT_SPEED_MS)
}

/**
 * Speed (m/s) at or below which the hiker is treated as stopped. A standing
 * hiker's position-delta speed is dominated by GPS jitter (a few m over a few s
 * ≈ 0.3–0.6 m/s), and a real Doppler speed reads ~0. Below this we freeze the
 * dead-reckoning forward floor so the dot doesn't creep on noise.
 */
export const STOPPED_SPEED_MS = 0.5

/**
 * Speed (m/s) above which the hiker is unambiguously moving. Between STOPPED and
 * MOVING is a hysteresis band: the is-moving flag holds its previous value there,
 * so a hiker hovering near the threshold doesn't flicker the arrow / poll rate.
 */
export const MOVING_SPEED_MS = 0.9

/**
 * Resolve the best available speed for a fix. Prefers the GPS chip's Doppler
 * speed (`fixSpeedMs`) — it reads ~0 when stationary even under position noise,
 * making it a far better stop signal than a position delta — and falls back to
 * the clamped position-delta speed when Doppler is absent (NaN/negative).
 * Returns null when neither is available (e.g. first fix).
 *
 * `clamp` bounds the result to a plausible range for the activity in play —
 * defaults to the on-foot ceiling (`clampWalkingSpeed`) for sims that only
 * model walking; the live app passes `clampPlausibleSpeed` (this module) so
 * cycling/driving speeds aren't clipped to a walking pace.
 */
export function resolveFixSpeed(
  fixSpeedMs: number,
  deltaSpeedMs: number | null,
  clamp: (speedMs: number) => number = clampWalkingSpeed,
): number | null {
  if (Number.isFinite(fixSpeedMs) && fixSpeedMs >= 0) return clamp(fixSpeedMs)
  if (deltaSpeedMs !== null && Number.isFinite(deltaSpeedMs) && deltaSpeedMs >= 0) {
    return clamp(deltaSpeedMs)
  }
  return null
}

/**
 * Speed (m/s) below which the GPS chip's own Doppler-derived course-over-ground
 * is unreliable and must not be trusted. GPS heading comes from the Doppler
 * shift on the velocity vector the chip computes internally — with little or no
 * real velocity, there's no signal to derive a heading from, so chips report a
 * frozen/garbage value below this floor (u-blox M10 Integration Manual documents
 * COG as "inaccurate" and held at its last value below 0.1 m/s). Set above that
 * floor with margin for a phone/consumer chip's noisier Doppler estimate than a
 * dedicated survey-grade receiver.
 */
export const MIN_DOPPLER_HEADING_SPEED_MS = 0.5

/**
 * Resolve the GPS chip's Doppler-derived heading (course over ground) for a fix,
 * or null when it can't be trusted this tick. Doppler heading is a genuinely
 * different (and typically far cleaner) signal than a two-fix position delta —
 * it comes from the Doppler shift on the velocity vector the chip already
 * computes internally, not from differencing two independently-noisy position
 * estimates, so it doesn't inherit position error the way `bearing(prev, curr)`
 * does. Near-universal across GPS chips (NMEA VTG/RMC `cog`, UBX-NAV-PVT
 * `headMot`), including the watch-scale modules this app targets — see
 * PRODUCT_CONCEPT.md.
 *
 * Requires `speedMs` at/above `MIN_DOPPLER_HEADING_SPEED_MS`: below that the
 * chip has too little real velocity for the Doppler measurement to mean
 * anything, and reports a frozen/stale value that must not be blended in as if
 * it were fresh.
 */
export function resolveFixHeading(headingDeg: number, speedMs: number): number | null {
  if (!Number.isFinite(headingDeg) || headingDeg < 0 || headingDeg >= 360) return null
  if (!Number.isFinite(speedMs) || speedMs < MIN_DOPPLER_HEADING_SPEED_MS) return null
  return headingDeg
}

/**
 * Update the boolean "is moving" state with hysteresis. Above MOVING_SPEED_MS →
 * moving; at/below STOPPED_SPEED_MS → stopped; in between → hold previous. Keeps
 * the stop/steady signal stable near the threshold.
 */
export function updateIsMoving(prevIsMoving: boolean, speedMs: number): boolean {
  if (!Number.isFinite(speedMs)) return prevIsMoving
  if (speedMs >= MOVING_SPEED_MS) return true
  if (speedMs <= STOPPED_SPEED_MS) return false
  return prevIsMoving
}

/**
 * Fraction of offRouteThresholdM the hiker must return within before
 * `updateIsOffRoute` clears — hysteresis band, mirrors this file's own
 * STOPPED/MOVING split for `updateIsMoving`. Without a gap, a raw fix
 * hovering right at the threshold (GPS noise, worse at higher speed) flips
 * the off-route flag every tick; each flip promotes/demotes the GPS strategy
 * and re-anchors the dead-reckoning display, reading as a rapid on/off/on
 * toggle loop.
 */
export const OFF_ROUTE_EXIT_RATIO = 0.7

/**
 * Update the boolean "genuinely off route" state with hysteresis. Enters at
 * `offRouteThresholdM` (the full off-route alert distance — this is a policy
 * decision, "switch to continuous GPS because the hiker is really lost", not
 * the tighter display-only rejoin corridor used elsewhere), only clears once
 * back within `OFF_ROUTE_EXIT_RATIO` of it.
 */
export function updateIsOffRoute(prev: boolean, distanceOffRoute: number, offRouteThresholdM: number): boolean {
  if (!Number.isFinite(distanceOffRoute)) return prev
  if (distanceOffRoute > offRouteThresholdM) return true
  if (distanceOffRoute <= offRouteThresholdM * OFF_ROUTE_EXIT_RATIO) return false
  return prev
}
