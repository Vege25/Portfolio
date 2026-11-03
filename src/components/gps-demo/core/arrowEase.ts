/**
 * Display-layer easing for the arrow angle — shared by ArrowDisplay.tsx (the
 * real UI) and sim/trace-dump.ts (so debug traces plot what the hiker
 * actually sees, not the raw per-fix navState.arrowAngle).
 *
 * This is deliberately separate from core navigation logic: navState.arrowAngle
 * stays a fresh, honest computation every tick (needed for internal
 * consistency and off-route/alert logic elsewhere); this module only smooths
 * how that value is animated on screen (or, eventually, how a physical
 * stepper motor is driven) between updates.
 *
 * Portable to C: fixed-size state struct, no allocation, plain arithmetic.
 */

/** Jump beyond this (degrees) arms the settle hold — a big estimate reposition. */
export const ARROW_EASE_BIG_JUMP_DEG = 60

/** Hold duration (ms) after a big jump before resuming the slew toward target. */
export const ARROW_EASE_SETTLE_MS = 500

/** Exponential-ease rate; higher = snappier. 5-6 feels natural for walking pace. */
export const ARROW_EASE_SPEED = 5.5

/** Below this angular difference (degrees) the display is considered settled. */
const ARROW_EASE_EPSILON_DEG = 0.05

export interface ArrowEaseState {
  /** Unwrapped target angle (can exceed ±180, accumulates the shortest-arc delta each update). */
  target: number
  /** Unwrapped displayed angle, eased toward `target`. */
  display: number
  /** Last raw (wrapped, -180..180) angle fed in, or null before the first one. */
  prevRawAngle: number | null
  /** Timestamp (ms, same clock as `nowMs`) until which slewing is held after a big jump. */
  settleUntilMs: number
}

export const INITIAL_ARROW_EASE_STATE: ArrowEaseState = {
  target: 0,
  display: 0,
  prevRawAngle: null,
  settleUntilMs: 0,
}

/**
 * Fold a fresh raw arrow angle (wrapped -180..180, or null) into the ease
 * state's unwrapped target — taking the shortest arc from the previous raw
 * angle, and arming the settle hold if the jump is large. Call once per new
 * navState.arrowAngle reading, before advancing the animation via
 * `stepArrowEase`.
 */
export function updateArrowEaseTarget(
  state: ArrowEaseState,
  angle: number | null,
  nowMs: number,
): ArrowEaseState {
  if (angle === null) {
    return { ...INITIAL_ARROW_EASE_STATE }
  }
  if (state.prevRawAngle === null) {
    return { ...state, target: angle, prevRawAngle: angle }
  }
  let delta = angle - state.prevRawAngle
  if (delta > 180) delta -= 360
  if (delta <= -180) delta += 360
  const settleUntilMs = Math.abs(delta) > ARROW_EASE_BIG_JUMP_DEG
    ? nowMs + ARROW_EASE_SETTLE_MS
    : state.settleUntilMs
  return { ...state, target: state.target + delta, prevRawAngle: angle, settleUntilMs }
}

/**
 * Advance the displayed angle one animation step (exponential ease toward
 * `target`, slew-capped at `maxDegPerSec`, held flat during the post-jump
 * settle window). Call at the animation's frame rate (60fps in the UI;
 * sim/trace-dump.ts calls this at a fixed virtual rate between fix timestamps).
 *
 * `dtS` — elapsed time (s) since the previous step call.
 */
export function stepArrowEase(
  state: ArrowEaseState,
  dtS: number,
  nowMs: number,
  maxDegPerSec: number,
): ArrowEaseState {
  if (nowMs < state.settleUntilMs) return state

  const diff = state.target - state.display
  if (Math.abs(diff) <= ARROW_EASE_EPSILON_DEG) return state

  const factor = 1 - Math.exp(-dtS * ARROW_EASE_SPEED)
  let step = diff * factor
  const maxStep = maxDegPerSec * dtS
  if (maxStep > 0 && Math.abs(step) > maxStep) {
    step = Math.sign(step) * maxStep
  }
  return { ...state, display: state.display + step }
}
