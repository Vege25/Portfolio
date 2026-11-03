import { bearing, haversineDistance, movePosition } from './geo'
import type { LatLng } from './types'

/**
 * Truth-walker + GPS noise model.
 *
 * Used by two consumers:
 *   1. The in-app desktop "ghost walker" simulator (App.tsx) — lets you test
 *      navigation without a phone GPS by walking a synthetic truth position
 *      along the route and feeding it noisy fixes.
 *   2. The headless regression sims (`sim/save-mode-sim.ts` etc.) — the same
 *      model, run non-interactively against real GPX routes.
 *
 * Not part of the C-portable navigation core — this generates *test input*,
 * it isn't logic the watch firmware runs.
 */

// ── Deterministic RNG ────────────────────────────────────────────────────────

/** A 0..1 uniform random source. Inject a seeded one for reproducible sims. */
export type Rng = () => number

/** Mulberry32 — tiny, fast, good-enough seeded PRNG for simulation. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard-normal sample via Box–Muller, drawing from `rng`. */
export function gaussian(rng: Rng): number {
  // Guard against log(0)
  const u1 = Math.max(rng(), 1e-12)
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

// ── Truth walker ─────────────────────────────────────────────────────────────

export interface WalkerState {
  pos: LatLng
  /** Index of the segment the walker is currently on (route[segIdx]→route[segIdx+1]). */
  segIdx: number
  /** Metres travelled into the current segment. */
  segProgress: number
  /** True once the walker reaches the final waypoint. */
  finished: boolean
}

export function initWalker(route: LatLng[]): WalkerState {
  return { pos: route[0]!, segIdx: 0, segProgress: 0, finished: route.length < 2 }
}

/**
 * Advance the truth walker `distanceM` along the route polyline, spilling across
 * segment boundaries. Mutation-free: returns a new WalkerState.
 */
export function advanceWalker(state: WalkerState, route: LatLng[], distanceM: number): WalkerState {
  if (route.length < 2 || state.finished) return state

  let { segIdx, segProgress } = state
  let remaining = distanceM

  while (remaining > 1e-6) {
    const a = route[segIdx]!
    const b = route[segIdx + 1]!
    const segLen = haversineDistance(a, b)
    const distToEnd = Math.max(0, segLen - segProgress)

    if (remaining >= distToEnd) {
      // Cross into the next segment.
      remaining -= distToEnd
      if (segIdx >= route.length - 2) {
        return { pos: b, segIdx, segProgress: segLen, finished: true }
      }
      segIdx += 1
      segProgress = 0
    } else {
      segProgress += remaining
      remaining = 0
    }
  }

  const a = route[segIdx]!
  const b = route[segIdx + 1]!
  const segLen = haversineDistance(a, b)
  const brg = segLen > 1e-6 ? bearing(a, b) : 0
  return { pos: movePosition(a, brg, segProgress), segIdx, segProgress, finished: false }
}

// ── Speed profile (scripted stop / slow / fast for the sim) ───────────────────

export interface SpeedPhase {
  /** Duration of this phase (seconds). */
  durationS: number
  /** Ground speed during this phase (m/s). 0 = standing still. */
  speedMs: number
}

/**
 * A default scripted walk that exercises the hard cases the constant-speed sim
 * never did: a normal walk, a slow-down, a full stop (dwell), a resume, and a
 * fast stretch. Used by both the desktop auto-walk and the headless sim so stop
 * detection, zero-creep, and speed-change tracking get real coverage.
 */
export const DEFAULT_SPEED_PROFILE: SpeedPhase[] = [
  { durationS: 20, speedMs: 1.4 }, // steady walk
  { durationS: 10, speedMs: 0.6 }, // slow down
  { durationS: 12, speedMs: 0 },   // full stop (dwell)
  { durationS: 10, speedMs: 1.4 }, // resume
  { durationS: 12, speedMs: 2.6 }, // fast stretch
  { durationS: 60, speedMs: 1.4 }, // steady walk (long straight → slow-poll)
]

/** Ground speed (m/s) at elapsed time `tS` for a profile; holds the last phase's speed after the end. */
export function speedProfileAt(profile: SpeedPhase[], tS: number): number {
  let acc = 0
  for (const phase of profile) {
    acc += phase.durationS
    if (tS < acc) return phase.speedMs
  }
  return profile.length > 0 ? profile[profile.length - 1]!.speedMs : 0
}

// ── GPS noise model ──────────────────────────────────────────────────────────

export interface NoiseOptions {
  /** Typical horizontal accuracy (m, 1σ) the chip reports — drives lateral noise. */
  accuracyM: number
  /** Probability [0..1] that a given fix is a gross outlier. */
  outlierProb: number
  /** Outlier displacement (m) when one occurs. */
  outlierM: number
  /**
   * Multipath drift bias (m, steady-state 1σ) — a slowly-wandering offset added
   * on top of the per-fix Gaussian jitter, correlated across consecutive fixes
   * (see DriftState). 0 (default) disables it: every fix's error is independent,
   * appropriate for open sky where multipath geometry doesn't dominate. Set this
   * for forest/urban-canyon conditions, where reflected signals bias the fix in
   * roughly the same direction for several seconds at a time rather than
   * randomizing fix-to-fix.
   */
  driftM?: number
  /**
   * Time constant (s) over which the drift bias reverts toward zero — i.e. how
   * long a multipath bias persists before the geometry changes enough to drift
   * elsewhere. Real multipath bias tracks satellite geometry and nearby
   * reflectors, which change slowly relative to a 1 Hz fix rate, so this is
   * seconds, not fix-to-fix. Ignored when driftM is 0/undefined.
   */
  driftTauS?: number
}

/**
 * Modern smartphone GPS (multi-constellation: GPS+GLONASS+Galileo) under open
 * sky typically reports 3–5 m 1σ horizontal accuracy, not the 8 m this used to
 * model — the old values were closer to a single-constellation chip or
 * moderate tree cover, and overstated real-world jitter enough to make the
 * smoothing/dead-reckoning code harder to reason about than the real signal
 * warrants. Outliers (multipath near buildings/trees) are real but less
 * frequent and smaller in the common case. No drift bias — open sky isn't
 * dominated by multipath geometry, so per-fix error is close to independent.
 */
export const DEFAULT_NOISE: NoiseOptions = {
  accuracyM: 4,
  outlierProb: 0.03,
  outlierM: 12,
}

/**
 * Dense forest canopy: signal attenuation (up to ~90% at 20 m foliage depth)
 * and multipath off trunks/branches raise the baseline error to 5–15 m, and —
 * unlike open sky — that error is dominated by multipath geometry relative to
 * nearby trees, which doesn't change fix-to-fix. So the dominant term here is
 * `driftM`, a correlated bias that wanders over several seconds (driftTauS),
 * not independent per-fix jitter; a naive per-fix-independent 15 m accuracy
 * would look jumpier than real forest GPS, which tends to hold a bias steady
 * for a while rather than randomizing every fix. `accuracyM` stays modest — it
 * layers small independent jitter on top of the drift, not the whole budget.
 */
export const FOREST_NOISE: NoiseOptions = {
  accuracyM: 4,
  outlierProb: 0.05,
  outlierM: 25,
  driftM: 9,
  driftTauS: 12,
}

export interface NoisyFix {
  pos: LatLng
  /** Accuracy the chip would report for this fix (m). Larger for outliers. */
  accuracyM: number
  isOutlier: boolean
  /** Updated drift state — feed back into the next sampleNoisyFix call. */
  drift: DriftState
}

/**
 * Model the GPS chip's Doppler speed reading around a true ground speed. Real
 * chips report speed from Doppler shift, which is far less noisy than a
 * position delta and reads ~0 when stationary — the property that makes it a
 * reliable stop signal. We add a little Gaussian noise and zero it out at a
 * standstill (chips clamp tiny speeds to 0). Returns NaN with probability
 * `dropoutProb` to model chips/fixes that don't supply a speed.
 */
export function dopplerSpeed(trueSpeedMs: number, rng: Rng, dropoutProb = 0): number {
  if (dropoutProb > 0 && rng() < dropoutProb) return NaN
  if (trueSpeedMs <= 0.05) return 0
  const noisy = trueSpeedMs + gaussian(rng) * 0.15
  return Math.max(0, noisy)
}

/**
 * Model the GPS chip's Doppler-derived heading (course over ground) around a
 * true ground bearing. Unlike a two-fix position-delta bearing — whose error
 * is `atan(position noise / distance walked)` and so blows up at the short
 * steps this app runs at — Doppler heading error doesn't depend on distance
 * at all: it's a roughly fixed angular noise on the velocity vector's
 * direction, largely independent of step length. That's the entire reason
 * this app prefers it (see computeMovementBearing's doc in navigation.ts).
 * `sigmaDeg` has no cited real-world figure (GPS chip datasheets don't publish
 * one) — this is an engineering placeholder for exercising the sim/demo path,
 * not a validated accuracy model; tune down once real device logs are
 * available. Returns NaN below walking pace (mirrors `MIN_DOPPLER_HEADING_SPEED_MS`
 * in core/motion.ts — a real chip has no usable Doppler signal near a
 * standstill either).
 */
export function dopplerHeading(trueBearingDeg: number, speedMs: number, rng: Rng, sigmaDeg = 6): number {
  if (speedMs < 0.5) return NaN
  return (trueBearingDeg + gaussian(rng) * sigmaDeg + 360) % 360
}

/**
 * Correlated multipath drift bias, in local east/north metres. An
 * Ornstein-Uhlenbeck process: it wanders (a small Gaussian step each call) but
 * mean-reverts toward zero with time constant `tauS`, so the bias persists
 * across consecutive fixes instead of randomizing every call like the plain
 * per-fix Gaussian jitter does — modeling how multipath geometry relative to
 * nearby reflectors (tree trunks, buildings) changes slowly, not fix-to-fix.
 * `steadyStateM` is the 1σ magnitude the bias wanders within once settled.
 */
export interface DriftState {
  eastM: number
  northM: number
}

export const ZERO_DRIFT: DriftState = { eastM: 0, northM: 0 }

export function stepDrift(
  state: DriftState,
  steadyStateM: number,
  tauS: number,
  dtS: number,
  rng: Rng,
): DriftState {
  if (steadyStateM <= 0 || tauS <= 0) return ZERO_DRIFT
  // Discrete OU update: reversion pulls toward 0, then a Gaussian step whose
  // variance is sized so the process's steady-state stdev equals steadyStateM.
  const revert = Math.exp(-dtS / tauS)
  const stepSigma = steadyStateM * Math.sqrt(1 - revert * revert)
  return {
    eastM: state.eastM * revert + gaussian(rng) * stepSigma,
    northM: state.northM * revert + gaussian(rng) * stepSigma,
  }
}

/** Displace `pos` by a DriftState's east/north offset (metres). No-op at ~0. */
function applyDrift(pos: LatLng, drift: DriftState): LatLng {
  const mag = Math.hypot(drift.eastM, drift.northM)
  if (mag < 1e-6) return pos
  const dir = (Math.atan2(drift.eastM, drift.northM) * 180) / Math.PI
  return movePosition(pos, (dir + 360) % 360, mag)
}

/**
 * Sample a noisy GPS fix around a truth position. Normal fixes get 2-D Gaussian
 * error scaled by `accuracyM` plus the current correlated drift bias (if any —
 * see DriftState/stepDrift); with probability `outlierProb` a fix is displaced
 * by ~`outlierM` in a random direction and reports an inflated accuracy — the
 * classic forest/multipath glitch that the Kalman filter and bearing-outlier
 * guard have to survive.
 *
 * `drift` is the PREVIOUS call's returned drift state (ZERO_DRIFT for the
 * first fix, or when opts.driftM is unset — e.g. DEFAULT_NOISE); `dtS` is the
 * elapsed time since that previous fix, sizing how far the bias can move this
 * step. The returned `NoisyFix.drift` feeds into the next call.
 */
export function sampleNoisyFix(
  truth: LatLng,
  opts: NoiseOptions,
  rng: Rng,
  drift: DriftState = ZERO_DRIFT,
  dtS = 1,
): NoisyFix {
  const nextDrift = opts.driftM
    ? stepDrift(drift, opts.driftM, opts.driftTauS ?? 12, dtS, rng)
    : ZERO_DRIFT

  if (rng() < opts.outlierProb) {
    const dir = rng() * 360
    const mag = opts.outlierM * (0.7 + 0.6 * rng())
    const pos = applyDrift(movePosition(truth, dir, mag), nextDrift)
    return { pos, accuracyM: opts.outlierM, isOutlier: true, drift: nextDrift }
  }
  // 2-D Gaussian: independent north/east offsets at 1σ = accuracy, plus the
  // slowly-wandering drift bias on top.
  const dir = rng() * 360
  const mag = Math.abs(gaussian(rng)) * opts.accuracyM
  const pos = applyDrift(movePosition(truth, dir, mag), nextDrift)
  return { pos, accuracyM: opts.accuracyM, isOutlier: false, drift: nextDrift }
}
