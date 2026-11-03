/**
 * 1-D Kalman position filter — the same math App.tsx runs per-axis (lat, lng)
 * on every GPS fix to smooth position estimates.
 *
 * Pure, allocation-light arithmetic. Portable to C: no dependencies beyond
 * basic arithmetic.
 */

/** Per-axis Kalman state: estimate `x` and variance `p`. */
export interface KalmanAxis {
  x: number
  p: number
}

const METERS_PER_DEG = 111_320

/**
 * Assumed walking speed (m/s) used to grow process noise between fixes when the
 * caller doesn't supply a live speed. Drives how much the filter "opens up" to
 * follow a fresh fix after a gap.
 */
export const KALMAN_ASSUMED_SPEED_MS = 1.4

/**
 * Extra slack (m) added to the motion term so the filter never becomes so
 * confident it lags — covers heading changes and speed variation between
 * fixes. This is a CEILING reached over KALMAN_SLACK_RAMP_S of elapsed time,
 * not a flat per-step addition — see processNoiseVariance.
 */
const KALMAN_MOTION_SLACK_M = 3

/**
 * Time (s) over which the motion slack ramps from 0 up to its full
 * KALMAN_MOTION_SLACK_M ceiling. Sized for save-mode's multi-second gaps,
 * where the full slack matters (covers heading/speed variation the caller's
 * speed estimate doesn't capture). At performance-mode's sub-second cadence
 * (continuous fixes, ~100ms apart — see effectiveGpsMode in App.tsx), a flat
 * 3 m slack would swamp the actual ~0.1-0.5 m of real motion per fix and keep
 * the filter's gain nearly as open as it is after a multi-second save-mode
 * gap — so it wouldn't meaningfully smooth GPS noise between frequent fixes,
 * which is exactly when there's the most raw noise (and jitter it causes in
 * the movement bearing / arrow) to smooth away. Ramping the slack with
 * elapsed time keeps both regimes correct from one formula.
 */
const KALMAN_SLACK_RAMP_S = 2

/**
 * Process-noise variance (deg²) accumulated over `elapsedS` at `speedMs`.
 *
 * The old model used a tiny fixed per-second constant tuned for continuous
 * (~1 Hz) performance-mode fixes. In battery-save mode fixes can be 5–10 s
 * apart, during which the walker moves `speed × elapsed` metres — if the filter
 * doesn't grow its uncertainty to match, its Kalman gain collapses and the
 * estimate lags metres behind the walker (the "position feels late" symptom).
 *
 * So we model the between-fix motion directly: the walker could be anywhere
 * within ~`speed × elapsed` (+ ramped slack) of the last estimate, and we use
 * that as the standard deviation of the process noise.
 */
export function processNoiseVariance(elapsedS: number, speedMs: number): number {
  const v = Number.isFinite(speedMs) && speedMs > 0 ? speedMs : KALMAN_ASSUMED_SPEED_MS
  const clampedElapsedS = Math.max(elapsedS, 0)
  const slackM = KALMAN_MOTION_SLACK_M * Math.min(clampedElapsedS / KALMAN_SLACK_RAMP_S, 1)
  const motionM = v * clampedElapsedS + slackM
  const motionDeg = motionM / METERS_PER_DEG
  return motionDeg * motionDeg
}

/**
 * One Kalman update for a single axis. `null` state initialises to the
 * measurement. `elapsedS` is time since the previous fix; `speedMs` is the
 * current walking speed estimate — together they set how far the filter opens
 * up to follow a fresh fix after a gap.
 */
export function kalmanStep(
  state: KalmanAxis | null,
  measured: number,
  r: number,
  elapsedS: number,
  speedMs: number,
): KalmanAxis {
  if (state === null) return { x: measured, p: r }
  const pPred = state.p + processNoiseVariance(elapsedS, speedMs)
  const K = pPred / (pPred + r)
  return { x: state.x + K * (measured - state.x), p: (1 - K) * pPred }
}

/**
 * Extra margin (m) added on top of plausible travel distance before a jump is
 * treated as suspicious — covers speed-estimate error and fix-to-fix timing
 * jitter so a legitimately brisk fix isn't penalised right at the boundary.
 */
const JUMP_PLAUSIBLE_MARGIN_M = 6

/**
 * Measurement variance R (deg²) from a reported accuracy, with the same
 * large-jump inflation the app uses on-route: a fix that jumps further than
 * the hiker could plausibly have travelled is trusted less (multipath), but a
 * fix near/over the off-route threshold is NOT suppressed (a real stray).
 *
 * The plausible-travel bound is `speed × elapsed + accuracy allowance +
 * margin`, not a fixed accuracy-scaled constant — a fixed threshold (the old
 * `accuracyM * 2.5` cap) is sized for walking pace and misfires at higher
 * speeds: at 40 km/h (~11 m/s) a hiker/rider legitimately covers ~11 m between
 * 1 Hz fixes, which used to exceed the old ~10 m cap on every single fix,
 * inflating R by ~7-8x and making the filter distrust genuine motion — the
 * "dot lags behind at speed" symptom. Scaling the bound by the live speed
 * estimate (already tracked for the poll-interval/activity logic) keeps a
 * real corner-cut-sized stray flagged as suspicious while brisk-but-legitimate
 * travel at any speed is trusted outright.
 */
export function measurementVariance(
  accuracyM: number,
  jumpM: number,
  onRoute: boolean,
  rawPerpFar: boolean,
  elapsedS: number,
  speedMs: number,
): number {
  const accuracyDeg = accuracyM / METERS_PER_DEG
  let r = accuracyDeg * accuracyDeg
  const v = Number.isFinite(speedMs) && speedMs > 0 ? speedMs : KALMAN_ASSUMED_SPEED_MS
  const plausibleM = v * Math.max(elapsedS, 0) + accuracyM + JUMP_PLAUSIBLE_MARGIN_M
  if (onRoute && !rawPerpFar && jumpM > plausibleM) {
    r *= (jumpM / plausibleM) ** 2
  }
  return r
}
