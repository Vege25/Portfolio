export interface LatLng {
  lat: number
  lng: number
}

/** A raw GPS fix — lat/lng plus optional chip-reported heading (Doppler) and speed. */
export interface GpsFix extends LatLng {
  /** Degrees 0–360 clockwise from north. NaN when unavailable. */
  heading: number
  /** Speed in m/s. NaN when unavailable. */
  speedMs: number
  /** Horizontal accuracy in metres (1σ). */
  accuracy: number
}

export interface NavState {
  /** Route segment the hiker is projected onto: `route[activeSegIdx] → route[activeSegIdx + 1]`. */
  activeSegIdx: number
  /** Hiker's real fix-to-fix movement bearing — never route direction. */
  movementBearing: number
  /**
   * Whether `movementBearing` has ever been set from a real, confidently-moving
   * fix. False only before the first such fix — `movementBearing` is a
   * meaningless placeholder (0) until then, so it must not be blended into
   * the first real reading (see computeMovementBearing's cold-start guard).
   */
  hasConfidentBearing: boolean
  arrowAngle: number
  distanceToNext: number
  /** Perpendicular distance in meters from the hiker to the nearest route segment.
   *  More accurate than nearest-waypoint distance for off-route detection. */
  distanceOffRoute: number
  /**
   * Anchor position `movementBearing` is measured from — NOT the previous fix.
   * Held fixed across several ticks so the raw bearing is computed over
   * accumulated real displacement (shrinking GPS noise's angular contribution)
   * rather than a single short, noise-dominated step. Re-anchored at `pos`
   * once accumulated distance clears BEARING_CONFIDENT_MOVE_M. See
   * computeMovementBearing in navigation.ts.
   */
  bearingAnchorPos: LatLng | null
  /**
   * A large (> LARGE_BEARING_JUMP_DEG) bearing jump seen on the previous tick,
   * awaiting a second, agreeing fix before being accepted into
   * `movementBearing`. Rejects single-fix noise flukes while still letting a
   * real turn (whose consecutive fixes agree) through within 1-2 fixes. See
   * computeMovementBearing in navigation.ts.
   */
  pendingBearing: number | null
  /**
   * Waypoint index of the last sharp corner (turn angle > CORNER_THRESHOLD_DEG)
   * the hiker has walked past, or null if none yet this route. Used by the
   * caller (GPS-poll scheduling) to arm/extend a post-corner fast-polling
   * cooldown — see `distancePastCornerM`/`isInCornerCooldown` in
   * gpsInterval.ts. Detected purely from route geometry + activeSegIdx
   * progress (see `detectCrossedCorner` in navigation.ts), never from a
   * timestamp — NavState carries no wall-clock time (see `sharpTurnJustCrossed`
   * for why), so turning this into a cooldown TIMER is the caller's job.
   */
  lastSharpTurnWpIdx: number | null
  /**
   * True only on the tick a NEW sharp corner was just detected as crossed
   * (i.e. `lastSharpTurnWpIdx` changed this tick) — false on every other
   * tick, including all the ticks after while still within that corner's
   * cooldown. This is the caller's cue to (re)start its own cooldown timer
   * (e.g. `performance.now()` in the browser, a hardware tick counter in a C
   * port) — NavState itself deliberately has no wall-clock/tick field, since
   * core/ stays pure and time-free (see this file's other durations, which
   * are always caller-supplied elapsed amounts, never absolute clocks).
   */
  sharpTurnJustCrossed: boolean
}

export interface SimState {
  position: LatLng
  prevPosition: LatLng | null
  movementBearing: number
}

export interface DensifyOptions {
  turnThresholdDeg: number
  maxSpacingMeters: number
}

export const DEFAULT_DENSIFY_OPTIONS: DensifyOptions = {
  turnThresholdDeg: 10,
  maxSpacingMeters: 15,
}
