import { bearing, haversineDistance, normalizeAngle, projectOntoSegment } from './geo'
import type { LatLng } from './types'

/** Turn angle (degrees) above which a waypoint counts as a real corner. */
export const CORNER_THRESHOLD_DEG = 25

/** Post-corner GPS cooldown duration (ms). */
export const COOLDOWN_MS = 5000

/**
 * Hard ceiling (ms) on how long the post-corner cooldown's distance-based
 * runout extension (see `distancePastCornerM`/`COOLDOWN_RUNOUT_M`) may hold
 * fast polling, even if the runout distance is never cleared. Guards against
 * a degenerate route (e.g. the hiker stops right at a corner) pinning
 * polling fast indefinitely — the plain time-based `COOLDOWN_MS` window
 * still always applies underneath this.
 */
export const COOLDOWN_MAX_MS = COOLDOWN_MS * 3

/**
 * Floor distance (m) past a corner vertex the hiker must have walked before
 * the post-corner cooldown is allowed to lapse on time alone, AT WALKING
 * PACE — see `cornerRunoutDistM` for the live-speed-scaled version actually
 * used. The plain `COOLDOWN_MS` timer can expire while the arrow is still
 * visibly mid-turn (e.g. a slow walker, or a corner the pure-pursuit
 * lookahead is still resolving through) — this extends fast polling until
 * the hiker has actually walked clear of the corner geometry, not just until
 * a fixed clock runs out. Matches `PURE_PURSUIT_LOOKAHEAD_M` (navigation.ts,
 * currently 9) exactly, not an independent guess — see `cornerRunoutDistM`
 * below for why. Kept in sync MANUALLY (duplicated, not imported, to avoid a
 * circular import — navigation.ts already imports FROM this module) — if
 * PURE_PURSUIT_LOOKAHEAD_M changes, update this to match.
 */
export const COOLDOWN_RUNOUT_BASE_M = 9

/** Walking speed used to preview overlay tiers (~1.4 m/s). */
export const PREVIEW_WALK_SPEED_MS = 1.4

/**
 * Route distance covered during post-corner cooldown at walking pace. Used as
 * the DEFAULT lead radius by callers that don't have a live speed (the overlay
 * preview). Live callers should use `cornerLeadDistM(speedMs)` instead — a
 * fixed walking-pace radius passes in ~2s at running speed and ~1s at cycling
 * speed, well under the intended 5s of lead time.
 */
export const COOLDOWN_DIST_M = PREVIEW_WALK_SPEED_MS * (COOLDOWN_MS / 1000)

/**
 * Floor speed (m/s) used when sizing the corner lead radius from a live speed
 * estimate. Below this the hiker is essentially stopped, where the fast-poll
 * zone should still cover a sensible walking-pace distance rather than
 * collapsing toward zero — a near-stationary hiker who then moves needs the
 * corner still covered by the fast zone, not a radius sized to their momentary
 * near-0 speed.
 */
const CORNER_LEAD_MIN_SPEED_MS = PREVIEW_WALK_SPEED_MS

/**
 * Seconds of lead time before a corner within which polling should already
 * be fast. Deliberately separate from `COOLDOWN_MS` (the POST-corner window)
 * so each can be tuned independently — they protect different failure modes.
 *
 * Was implicitly `COOLDOWN_MS / 1000` (5s). Widened to 8s: the "steady long
 * straight" path has its own look-ahead clamp that's already generous enough
 * to never be the binding constraint here, but the NORMAL ramp path
 * (`intervalFromDistToCorner`, used whenever `steady` isn't true) has no
 * such clamp — it only guarantees an interval of at most 5000ms right up
 * until the hiker is within the fast-lead radius. At walking pace, 5s of
 * lead was only ~7m — under a single 5000ms ramp interval's worth of ground
 * (~7m), so in the worst case only ONE poll was guaranteed inside the fast
 * zone before reaching the corner, which in practice can look like fast
 * polling "starting at the corner" rather than meaningfully before it.
 * 8s comfortably covers more than one full ramp interval at any speed, so at
 * least two polls land inside the fast zone before the corner is reached.
 */
export const PRE_CORNER_LEAD_S = 8

/**
 * Distance (m) before/after a corner within which polling should run at full
 * speed (1 s cadence, or a performance-mode burst) — sized to give
 * ~PRE_CORNER_LEAD_S of lead time in METRES at the hiker's actual pace, not a
 * fixed walking-pace distance. A runner or cyclist covers the old fixed
 * metre radius in a couple of seconds; scaling by live speed keeps the lead
 * time constant across activities so the burst/fast-poll reliably engages
 * before the corner is reached.
 */
export function cornerLeadDistM(speedMs: number): number {
  const v = Number.isFinite(speedMs) ? Math.max(speedMs, CORNER_LEAD_MIN_SPEED_MS) : CORNER_LEAD_MIN_SPEED_MS
  return v * PRE_CORNER_LEAD_S
}

/**
 * Time (s) the runout distance represents at/below walking pace —
 * `COOLDOWN_RUNOUT_BASE_M / CORNER_LEAD_MIN_SPEED_MS` (reusing the same
 * walking-pace floor speed as the pre-corner lead), so at walking pace
 * `cornerRunoutDistM` returns exactly `COOLDOWN_RUNOUT_BASE_M`
 * (behavior-preserving at the floor).
 */
const RUNOUT_LEAD_S = COOLDOWN_RUNOUT_BASE_M / CORNER_LEAD_MIN_SPEED_MS

/**
 * Live-speed-scaled distance (m) past a corner vertex the hiker must walk
 * before the post-corner cooldown may lapse on time alone. A flat metre
 * radius (the old `COOLDOWN_RUNOUT_M = 8`) passes in a couple of seconds at
 * running/cycling pace, well under the time the arrow's (also speed-scaled)
 * pursuit lookahead needs to fully clear the corner — this scales the same
 * way `cornerLeadDistM` scales the PRE-corner radius, so lead/lag time stays
 * roughly constant in TIME across activities, not just metres.
 *
 * The arrow's pure-pursuit target point is capped at the next corner, so it
 * only fully clears the turn (arrow reads straight) once the hiker has
 * walked the FULL lookahead distance past the corner vertex — less than
 * that and the lookahead point (and so the arrow) is still partially
 * anchored on the corner. The old flat 8m under-covered this even at
 * walking pace (lookahead is 12m), so fast polling could lapse while the
 * arrow was still visibly turned. Mirrors `PURE_PURSUIT_LOOKAHEAD_M`/
 * `pursuitLookaheadM` (navigation.ts) rather than importing them, to avoid
 * a circular import (navigation.ts already imports FROM this module).
 */
export function cornerRunoutDistM(speedMs: number): number {
  const v = Number.isFinite(speedMs) ? Math.max(speedMs, CORNER_LEAD_MIN_SPEED_MS) : CORNER_LEAD_MIN_SPEED_MS
  return v * RUNOUT_LEAD_S
}

/**
 * Default arrow-angle deviation (degrees) above which the hiker is considered
 * "mid-turn" for polling purposes — see `isInArrowTurnCooldown`. Exposed via
 * settings (NavConfig.arrowTurnThresholdDeg) since how twisty a trail is
 * varies a lot; this is just the starting point. Deliberately independent of
 * `CORNER_THRESHOLD_DEG` (a route-geometry constant) — this one gates on the
 * live arrow reading instead.
 */
export const ARROW_TURN_THRESHOLD_DEG = 30

export type GpsTier = 'fast' | 'medium' | 'slow'

/**
 * Extended poll interval (ms) on a long, straight, on-route stretch while moving
 * steadily. Above the normal 5 s cap: the dead-reckoning glide carries the arrow
 * and position smoothly between fixes, so a sparse "confirm" fix is enough on a
 * straight — and every skipped fix is battery saved. Straights dominate most
 * trails, so this is where the real saving is.
 */
export const STRAIGHT_INTERVAL_MS = 12000

/**
 * Fastest plausible on-foot ground speed (m/s) used ONLY to size the long-straight
 * look-ahead clamp — not the live speed. The clamp projects where the next poll
 * would land assuming the hiker could accelerate up to this before it fires, so a
 * sparse sleep can never overshoot a corner even if the walker speeds up (e.g.
 * downhill) after the interval was chosen. 4 m/s ≈ 14 km/h covers brisk jog on a
 * trail. Mirrors MAX_ON_FOOT_SPEED_MS in motion.ts (kept local to avoid
 * coupling this pure module to that one).
 */
export const CLAMP_MAX_SPEED_MS = 4

/**
 * Poll interval (ms) while the hiker is stopped (or speed is unknown). NOT the
 * old 10 s: a stopped hiker can resume at any moment, and the resume can only be
 * detected on the next fix — so a 10 s stopped interval means up to 10 s where
 * the display stays frozen (zero-creep) while the hiker has already walked away,
 * leaving the estimate metres behind the moment they get going. Polling every few
 * seconds while stationary costs little battery (the phone isn't moving, GPS is
 * already warm) and catches resume quickly so the estimate doesn't fall behind.
 */
export const STOPPED_INTERVAL_MS = 3000

export interface GpsIntervalInput {
  route: LatLng[]
  activeWaypointIdx: number
  distanceToNext: number
  speedMs: number
  /** Milliseconds since passing the last corner; null when not in cooldown. */
  msSinceCornerPass: number | null
  /**
   * Waypoint index of the corner that armed `msSinceCornerPass`'s cooldown;
   * null when not in cooldown (mirrors msSinceCornerPass). Combined with
   * `pos` to extend the cooldown until the hiker has actually walked clear
   * of the corner geometry (see `distancePastCornerM`), not just until a
   * fixed clock runs out. Omitted (or `pos` omitted) callers fall back to
   * the plain time-based cooldown — behavior-preserving for callers that
   * don't track this yet (e.g. the overlay preview).
   */
  cornerWpIdx?: number | null
  /** Current position, used with `cornerWpIdx` for the distance-based cooldown runout. */
  pos?: LatLng
  /** Current perpendicular distance from route (m). Used to poll faster near threshold. */
  distanceOffRoute?: number
  /** Off-route threshold (m) from config. */
  offRouteThresholdM?: number
  /**
   * Whether the hiker is moving steadily (not stopped / not mid-speed-change).
   * Gates the long-straight slow-poll: when speed is varying or near a stop we
   * keep the normal cadence so the estimate stays honest. Defaults to false
   * (conservative — no extension) so callers that don't track it are unaffected.
   */
  steady?: boolean
  /**
   * Long-straight poll cap (ms). The interval the slow-poll extends to on a long
   * straight, exposed via settings so battery-vs-responsiveness is tunable.
   * Defaults to STRAIGHT_INTERVAL_MS when absent so sims / overlay preview keep
   * working. The look-ahead clamp keeps corners safe at any value.
   */
  straightIntervalMs?: number
  /**
   * Current arrow deviation from straight-ahead (degrees, unsigned — e.g.
   * `Math.abs(navState.arrowAngle)`). When at/above `arrowTurnThresholdDeg`
   * polling stays fast (1 s) — see `isInArrowTurnCooldown`. Undefined callers
   * are unaffected — opt-in extension, like `cornerWpIdx`/`pos` above.
   */
  arrowAngleDeg?: number
  /**
   * Arrow-angle deviation (degrees) at/above which polling should stay fast —
   * see `isInArrowTurnCooldown`. Defaults to ARROW_TURN_THRESHOLD_DEG.
   */
  arrowTurnThresholdDeg?: number
}

/** Geometric turn angle (degrees) at a dense-route waypoint. */
export function waypointTurnAngle(route: LatLng[], wpIdx: number): number {
  if (wpIdx < 1 || wpIdx >= route.length - 1) return 0
  const inB = bearing(route[wpIdx - 1]!, route[wpIdx]!)
  const outB = bearing(route[wpIdx]!, route[wpIdx + 1]!)
  return Math.abs(normalizeAngle(outB - inB))
}

/**
 * Walk forward from `startWpIdx` and return cumulative distance (metres) to
 * the first waypoint whose turn angle exceeds `thresholdDeg`.
 */
export function distToNextCorner(
  route: LatLng[],
  startWpIdx: number,
  thresholdDeg: number = CORNER_THRESHOLD_DEG,
): number {
  let dist = 0
  for (let i = startWpIdx; i < route.length - 2; i++) {
    dist += haversineDistance(route[i]!, route[i + 1]!)
    if (waypointTurnAngle(route, i + 1) > thresholdDeg) return dist
  }
  return Infinity
}

/** Distance from a corner waypoint back along the route to `wpIdx`. */
export function distFromCornerToWaypoint(route: LatLng[], cornerWpIdx: number, wpIdx: number): number {
  let dist = 0
  for (let i = cornerWpIdx; i < wpIdx; i++) {
    dist += haversineDistance(route[i]!, route[i + 1]!)
  }
  return dist
}

/**
 * Cumulative route distance (m) walked from a corner vertex to the hiker's
 * current position, projected onto the active segment `route[activeSegIdx] →
 * route[activeSegIdx + 1]`.
 *
 * Deliberately NOT "progress on the current segment alone": a dense route
 * subdivides both legs of a sharp turn into short (~20m) segments
 * (densify.ts), so `activeSegIdx` advances through several of them in the
 * first few metres past a real corner. Measuring only the current segment's
 * own fractional progress would reset toward zero at every subdivision
 * boundary instead of accumulating — this sums whole subdivided segments
 * from the corner via `distFromCornerToWaypoint`, then adds the fractional
 * distance into the current (final) segment via `projectOntoSegment`.
 *
 * Returns 0 if the hiker hasn't reached the corner segment yet (defensive —
 * callers only invoke this once a corner has actually armed the cooldown).
 */
export function distancePastCornerM(
  pos: LatLng,
  route: LatLng[],
  cornerWpIdx: number,
  activeSegIdx: number,
): number {
  if (activeSegIdx < cornerWpIdx) return 0
  const wholeSegs = distFromCornerToWaypoint(route, cornerWpIdx, activeSegIdx)
  const a = route[activeSegIdx]
  const b = route[activeSegIdx + 1]
  if (!a || !b) return wholeSegs
  const { t } = projectOntoSegment(pos, a, b)
  return wholeSegs + t * haversineDistance(a, b)
}

/**
 * Compute GPS poll interval (ms) from distance to the next corner.
 * Mirrors the distance-based branch of getGpsInterval() in App.tsx.
 */
export function intervalFromDistToCorner(distM: number, speedMs: number): number {
  if (!isFinite(distM)) return 5000
  if (!Number.isFinite(speedMs) || speedMs <= 0) return 5000
  const timeToCornerMs = (distM / speedMs) * 1000
  return Math.max(1000, Math.min(5000, timeToCornerMs / 3))
}

export function intervalMsToTier(ms: number): GpsTier {
  if (ms <= 1500) return 'fast'
  if (ms < 4500) return 'medium'
  return 'slow'
}

/**
 * Compute GPS poll interval (ms) — single source of truth for runtime and overlay.
 * Used by App.tsx getGpsInterval() and the map overlay preview.
 */
/**
 * Minimum off-route threshold (m) for which the "approaching off-route" 1 s
 * pre-trigger (nearOffRoute, at 50% of the threshold) is worth arming. Below
 * this, half the threshold is small enough that ordinary GPS jitter alone
 * would cross it often, locking the poll rate at 1 s for the whole walk
 * instead of only near a real excursion. Sized as ~2.5x typical modern GPS
 * accuracy (see DEFAULT_NOISE in core/simWalker.ts) rather than a threshold
 * tuned for an older, noisier noise model.
 */
const MIN_THRESHOLD_FOR_PRETRIGGER_M = 10

/** Cumulative route distance (m) from the active waypoint to the next real corner. */
function distToUpcomingCornerFromActive(route: LatLng[], activeWaypointIdx: number, distanceToNext: number): number {
  const turnAtActive = waypointTurnAngle(route, activeWaypointIdx)
  return turnAtActive > CORNER_THRESHOLD_DEG
    ? distanceToNext
    : distanceToNext + distToNextCorner(route, activeWaypointIdx, CORNER_THRESHOLD_DEG)
}

/**
 * Whether the post-corner fast-polling cooldown is still active: either the
 * plain COOLDOWN_MS timer hasn't elapsed yet, OR (extension) the hiker
 * hasn't yet walked `cornerRunoutDistM(speedMs)` past the corner that armed
 * it — capped at COOLDOWN_MAX_MS so a stalled/stopped hiker right at a
 * corner can't pin fast polling on indefinitely. The distance extension only
 * engages when the caller supplies `cornerWpIdx`/`pos` (both geometry-
 * derived, never `arrowAngle` — arrow-angle gating was explicitly rejected
 * as too noisy on a real walk, see dead_reckoning_investigation.md); callers
 * without them get the original time-only behaviour unchanged.
 */
function isInCornerCooldown(input: GpsIntervalInput): boolean {
  const { route, activeWaypointIdx, msSinceCornerPass, cornerWpIdx, pos, speedMs } = input
  if (msSinceCornerPass === null) return false
  if (msSinceCornerPass < COOLDOWN_MS) return true
  if (msSinceCornerPass >= COOLDOWN_MAX_MS) return false
  if (cornerWpIdx == null || pos === undefined) return false

  const activeSegIdx = activeWaypointIdx - 1
  const pastCornerM = distancePastCornerM(pos, route, cornerWpIdx, activeSegIdx)
  return pastCornerM < cornerRunoutDistM(speedMs)
}

/**
 * Whether the arrow is currently turned at/beyond `arrowTurnThresholdDeg`
 * (mid-turn, not yet settled back onto the route direction) and polling
 * should therefore stay fast. Unlike `isInCornerCooldown` (route geometry + a
 * fixed post-corner window) this reacts directly to the live arrow reading —
 * fast polling continues for as long as the arrow reads turned, and releases
 * the moment it settles back under threshold, with no separate timer. Also
 * covers off-route wandering, a missed/unusual turn, or any other situation
 * where the arrow has swung hard without a route corner explaining it.
 */
function isInArrowTurnCooldown(input: GpsIntervalInput): boolean {
  if (input.arrowAngleDeg === undefined) return false
  const thresholdDeg = input.arrowTurnThresholdDeg ?? ARROW_TURN_THRESHOLD_DEG
  return input.arrowAngleDeg >= thresholdDeg
}

/**
 * Whether a corner is close enough (just passed or coming up within the
 * cooldown radius) or the hiker is near the off-route threshold, that a poll
 * should happen NOW at full accuracy rather than wait out a scheduled delay.
 *
 * A save-mode poll can itself take a second or more to resolve (GPS
 * acquisition latency), so even a "poll every 1s" schedule can under-serve a
 * sharp corner at any foot speed — walking or running through it in the time
 * one slow poll takes. Callers use this to decide whether to switch the GPS
 * watcher into a temporary continuous (performance-mode) burst instead of
 * just shortening the next scheduled poll delay; see useGpsWatcher.
 */
export function shouldBurstPerformance(input: GpsIntervalInput): boolean {
  const { route, activeWaypointIdx, distanceToNext, speedMs, distanceOffRoute, offRouteThresholdM } = input

  if (isInCornerCooldown(input)) return true
  if (isInArrowTurnCooldown(input)) return true

  const nearOffRoute =
    distanceOffRoute !== undefined &&
    offRouteThresholdM !== undefined &&
    offRouteThresholdM >= MIN_THRESHOLD_FOR_PRETRIGGER_M &&
    distanceOffRoute > offRouteThresholdM * 0.5
  if (nearOffRoute) return true

  const distToCorner = distToUpcomingCornerFromActive(route, activeWaypointIdx, distanceToNext)
  return distToCorner <= cornerLeadDistM(speedMs)
}

/**
 * Resolve the GPS strategy actually in effect right now: compass-check
 * always forces continuous fixes; being off-route or mid a walk/run
 * corner-lead burst temporarily promotes 'save' to 'performance'. Single
 * source of truth for this decision — it used to be reimplemented three
 * times in App.tsx (the live path, the auto-walk simulator, and the
 * free-drive simulator), and had already drifted: the two simulator copies
 * compared a FRESH (non-hysteretic) off-route distance against the threshold
 * while the live path used the hysteretic `isOffRoute` flag
 * (`updateIsOffRoute`, core/motion.ts), so a fix hovering right at the
 * threshold could resolve to a different mode in the simulator than it would
 * on a real device. Callers decide which off-route signal to pass in
 * (hysteretic for live GPS, a fresh comparison for a simulator that wants to
 * react on the same tick) — this function only encodes the mode-resolution
 * rule itself, not which off-route flavour is "correct".
 */
export function resolveEffectiveGpsMode(
  baseGpsMode: 'performance' | 'save',
  compassCheckActive: boolean,
  gpsBurstActive: boolean,
  isOffRoute: boolean,
): 'performance' | 'save' {
  return compassCheckActive || gpsBurstActive || isOffRoute ? 'performance' : baseGpsMode
}

export function computeGpsIntervalMs(input: GpsIntervalInput): number {
  const { route, activeWaypointIdx, distanceToNext, speedMs, distanceOffRoute, offRouteThresholdM, steady } = input
  const straightCapMs = input.straightIntervalMs ?? STRAIGHT_INTERVAL_MS

  // Stopped (or no speed yet): poll at the stopped cadence, not a long sleep, so
  // resume is caught quickly and the estimate doesn't fall behind on restart.
  if (!Number.isFinite(speedMs) || speedMs < 0.4) return STOPPED_INTERVAL_MS

  if (isInCornerCooldown(input)) return 1000
  if (isInArrowTurnCooldown(input)) return 1000

  // Poll at 1 s when approaching the off-route threshold — but only when the
  // threshold is large enough that GPS noise won't constantly trigger this
  // (see MIN_THRESHOLD_FOR_PRETRIGGER_M).
  const nearOffRoute =
    distanceOffRoute !== undefined &&
    offRouteThresholdM !== undefined &&
    offRouteThresholdM >= MIN_THRESHOLD_FOR_PRETRIGGER_M &&
    distanceOffRoute > offRouteThresholdM * 0.5
  if (nearOffRoute) return 1000

  const distToCorner = distToUpcomingCornerFromActive(route, activeWaypointIdx, distanceToNext)

  // Symmetric fast zone: poll at 1 s once we are within the post-corner cooldown
  // distance of the upcoming corner — i.e. *before* reaching it, not only after
  // the waypoint is passed. In battery-save mode fixes can be up to 10 s apart,
  // so without this the hiker can walk through an entire corner between two
  // fixes and never get the fast updates a corner needs. Radius scales with live
  // speed (cornerLeadDistM) so a runner still gets ~COOLDOWN_MS of lead time in
  // metres, not the fixed walking-pace distance.
  if (distToCorner <= cornerLeadDistM(speedMs)) return 1000

  // Long-straight slow-poll (battery): far from any corner, on-route, and moving
  // steadily → extend past the normal 5 s cap. The DR glide keeps the arrow and
  // position smooth between these sparse confirm-fixes. Gated on `steady` (and an
  // on-route implied by not being nearOffRoute above) so a stop or speed change
  // reverts to normal cadence.
  //
  // Look-ahead clamp (replaces the old fixed STRAIGHT_MIN_DIST_TO_CORNER_M gate):
  // the risk of a sparse sleep is that it lands the NEXT poll *past* where the
  // corner's fast-poll should have begun — so the hiker walks through the corner
  // under-polled. Rather than trust a hand-tuned distance constant (which breaks
  // if the walker accelerates, or if this cap is raised), project where the next
  // poll would land and shorten the interval so it can never overshoot the
  // fast-zone entry. Self-enforcing at any cap and any speed.
  //
  //   fastEntryDist — distance at which the ramp interval (intervalFromDistToCorner)
  //                   first drops below the straight cap; from timeToCorner/3 = cap
  //                   ⇒ dist = 3 · capS · speed. Past this we must be polling faster.
  //   Projection uses CLAMP_MAX_SPEED_MS (not the live speed) so acceleration up to
  //   that ceiling during the sleep still can't overshoot.
  if (steady === true) {
    const projSpeed = Math.max(speedMs, CLAMP_MAX_SPEED_MS)
    const capS = straightCapMs / 1000
    const fastEntryDist = 3 * capS * projSpeed
    const distMargin = distToCorner - fastEntryDist
    if (distMargin > 0) {
      // Take a fix no later than fastEntryDist: available time = margin / speed.
      // Floor at the normal ramp interval for this distance so that right at the
      // fast-zone boundary the clamp hands off smoothly to the ramp (never a
      // sub-ramp sleep, and never a runaway tiny interval as margin → 0). Ceiling
      // is the straight cap. Between the two the clamp only ever *shortens* the
      // sleep to protect the corner — it never polls faster than the ramp would.
      const maxSafeMs = (distMargin / projSpeed) * 1000
      const rampMs = intervalFromDistToCorner(distToCorner, speedMs)
      return Math.max(rampMs, Math.min(straightCapMs, maxSafeMs))
    }
    // Inside the fast-approach zone → fall through to the normal ramp below.
  }

  return intervalFromDistToCorner(distToCorner, speedMs)
}

/** Overlay preview: ms since corner pass at the start of a segment (null if outside zone). */
export function msSinceCornerAtSegmentStart(route: LatLng[], segIdx: number): number | null {
  for (let j = segIdx; j >= 1; j--) {
    if (waypointTurnAngle(route, j) > CORNER_THRESHOLD_DEG) {
      const distFromCorner = distFromCornerToWaypoint(route, j, segIdx)
      if (distFromCorner <= COOLDOWN_DIST_M) {
        return (distFromCorner / PREVIEW_WALK_SPEED_MS) * 1000
      }
      break
    }
  }
  return null
}

/**
 * Classify a dense-route segment for the GPS update-rate map overlay.
 * Evaluates interval at segment start using the same computeGpsIntervalMs().
 */
export function getSegmentTier(
  route: LatLng[],
  segIdx: number,
  straightIntervalMs: number = STRAIGHT_INTERVAL_MS,
): GpsTier {
  const segLen = haversineDistance(route[segIdx]!, route[segIdx + 1]!)

  const ms = computeGpsIntervalMs({
    route,
    activeWaypointIdx: segIdx + 1,
    distanceToNext: segLen,
    speedMs: PREVIEW_WALK_SPEED_MS,
    msSinceCornerPass: msSinceCornerAtSegmentStart(route, segIdx),
    // Preview assumes a steady walk so the long-straight tier can show, matching
    // the live cadence; the same straight cap the runtime uses keeps colours honest.
    steady: true,
    straightIntervalMs,
  })

  return intervalMsToTier(ms)
}
