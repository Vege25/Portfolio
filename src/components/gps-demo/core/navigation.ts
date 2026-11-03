import { bearing, haversineDistance, lerpLatLng, normalizeAngle, projectOntoSegment } from './geo'
import { deadReckonAlongRoute } from './deadReckoning'
import { CORNER_THRESHOLD_DEG, distToNextCorner, waypointTurnAngle } from './gpsInterval'
import type { LatLng, NavState } from './types'
import type { NavConfig } from '../config'
import { DEFAULT_NAV_CONFIG } from '../config'

/**
 * Segments to scan behind the last known position.
 * BACK_WINDOW × typical segment length ≈ ~225 m of backward regression allowed.
 * Enables backtracking recovery without a hard "never go backward" rule.
 */
const BACK_WINDOW = 15

/**
 * Segments to scan ahead of the last known position.
 * Handles corner-cutting and obstacle detours up to ~300 m ahead.
 */
const FORWARD_WINDOW = 20

/** Margin (m) the global fallback must beat the windowed best by to win. */
const GLOBAL_FALLBACK_MARGIN_M = 8

/**
 * Margin (m) a segment BEHIND the last match must beat the best-so-far by to
 * win the windowed search. Without this, a tight cluster of nearby waypoints
 * (e.g. a switchback, or several ~20m densify.ts subdivision points close
 * together) lets ordinary GPS/Kalman noise flip the match backward and
 * forward between them on consecutive fixes — confirmed via
 * sim/trace-dump.ts replay: three consecutive route segments whose
 * perpendicular distances were within 1.3m of each other caused a real
 * fix-to-fix backward jump of 2 segments from just 5.8m of actual movement,
 * producing a 170°+ arrow swing with no real direction change. Forward
 * progress is never penalised (only candidates strictly behind the last
 * match need to clear this margin) — this only damps backward flicker
 * between near-tied nearby segments, not genuine backtracking (a real
 * backtrack's candidate segment is far enough away to clear the margin
 * easily). Deliberately much smaller than the old (deleted) regression-
 * corroboration system's multi-fix hysteresis — this is a single-tick
 * distance margin, no persisted streak/candidate state, staying within the
 * pure-pursuit redesign's "no persisted position state" constraint.
 */
const BACKWARD_STICKY_MARGIN_M = 3

/** Shortest-path interpolation between two compass bearings. */
function lerpBearing(fromDeg: number, toDeg: number, t: number): number {
  const delta = normalizeAngle(toDeg - fromDeg)
  return (fromDeg + delta * t + 360) % 360
}

/**
 * Find the index of the route segment the hiker is currently on.
 *
 * Uses perpendicular segment projection (flat-earth approximation) to find the
 * nearest segment in a bidirectional window around `lastSegIdx`, with a
 * whole-route fallback when the windowed best is suspiciously far (a genuine
 * wander beyond the window). The fallback must beat the windowed best by a real
 * margin so a merely-coincident far fold (identical geometry on a loop) can't
 * win a tie and teleport the match.
 *
 * `rawPos` (optional) — unfiltered GPS position used only for distanceOffRoute.
 * Keeps the Kalman-filtered pos for bearing/arrow but measures raw perpendicular
 * distance so Kalman smoothing doesn't delay off-route detection at low thresholds.
 *
 * Returns segment index `i` such that the next target waypoint is `route[i + 1]`.
 */
export function findActiveSegment(
  pos: LatLng,
  route: LatLng[],
  lastSegIdx: number,
  rawPos?: LatLng,
  offRouteThresholdM?: number,
): { segIdx: number; distanceOffRoute: number } {
  if (route.length < 2) {
    return { segIdx: 0, distanceOffRoute: 0 }
  }

  const maxSeg = route.length - 2
  const clampedLast = Math.max(0, Math.min(lastSegIdx, maxSeg))

  const searchStart = Math.max(0, clampedLast - BACK_WINDOW)
  const searchEnd = Math.min(maxSeg, clampedLast + FORWARD_WINDOW)

  // Distance at the previous match itself — the reference point backward
  // candidates must beat by BACKWARD_STICKY_MARGIN_M (not the running best,
  // which would let several near-tied backward segments compound the margin
  // against each other as the scan proceeds).
  const distAtLast = projectOntoSegment(pos, route[clampedLast]!, route[clampedLast + 1]!).distance

  let bestSeg = clampedLast
  let bestDist = distAtLast

  for (let i = searchStart; i <= searchEnd; i++) {
    if (i === clampedLast) continue
    const { distance } = projectOntoSegment(pos, route[i]!, route[i + 1]!)
    // A segment behind the previous match must ALSO beat that match's own
    // distance by a real margin — see BACKWARD_STICKY_MARGIN_M — on top of
    // the usual "beat the running best" requirement. Segments at/after the
    // previous match only need the latter (forward progress is never
    // penalised).
    if (distance >= bestDist) continue
    if (i < clampedLast && distance >= distAtLast - BACKWARD_STICKY_MARGIN_M) continue
    bestDist = distance
    bestSeg = i
  }

  // Global fallback: if windowed best is suspiciously far, re-check the whole
  // route. Catches a genuine wander beyond the window — but it must beat the
  // windowed best by a real margin, so a merely-coincident far fold (identical
  // geometry on a loop) can't win a tie and teleport the match.
  if (offRouteThresholdM !== undefined && bestDist > offRouteThresholdM * 0.6) {
    for (let i = 0; i < route.length - 1; i++) {
      if (i >= searchStart && i <= searchEnd) continue
      const { distance } = projectOntoSegment(pos, route[i]!, route[i + 1]!)
      if (distance < bestDist - GLOBAL_FALLBACK_MARGIN_M) {
        bestDist = distance
        bestSeg = i
      }
    }
  }

  // Measure off-route distance from raw (unfiltered) position if provided,
  // so Kalman smoothing doesn't add lag to off-route detection.
  let distanceOffRoute = bestDist
  if (rawPos) {
    const { distance: rawDist } = projectOntoSegment(rawPos, route[bestSeg]!, route[bestSeg + 1]!)
    distanceOffRoute = rawDist
  }

  return { segIdx: bestSeg, distanceOffRoute }
}

/**
 * Floor lookahead (m) along the route the arrow aims — the pure-pursuit
 * lookahead at or below walking pace. See `pursuitLookaheadM` for the
 * speed-scaled version actually used by `getDesiredBearing`.
 *
 * Was 12. Lowered to 9: the arrow only reads fully straight again once the
 * lookahead point has walked clear of a corner (see getDesiredBearing's
 * corner cap), so a smaller floor makes the arrow settle sooner after a turn
 * — traded against slightly less advance warning before the next corner.
 * `gpsInterval.ts`'s `COOLDOWN_RUNOUT_BASE_M` mirrors this value so the
 * post-corner fast-polling window stays matched to how far the arrow itself
 * needs to settle (kept in sync manually — see that constant's doc for why
 * it can't just import this one).
 */
export const PURE_PURSUIT_LOOKAHEAD_M = 9

/**
 * Base lead time (s) at/below walking pace — mirrors `cornerLeadDistM`'s
 * shape in gpsInterval.ts. At `PURE_PURSUIT_LOOKAHEAD_M / PURSUIT_LOOKAHEAD_MIN_SPEED_MS`
 * ≈ 8.6s, walking-pace behaviour is unchanged from the original fixed 12m
 * constant (verified: PURE_PURSUIT_LOOKAHEAD_M is the floor, reached exactly
 * at the min speed).
 */
const PURSUIT_LOOKAHEAD_BASE_S = PURE_PURSUIT_LOOKAHEAD_M / 1.4

/** Floor speed (m/s) used when sizing the lookahead from a live speed estimate — same floor as cornerLeadDistM. */
const PURSUIT_LOOKAHEAD_MIN_SPEED_MS = 1.4

/**
 * Extra lead time (s) added at the top of the growth curve — see
 * `leadTimeS`'s doc comment for the full shape. Calibrated so a ~2.8 m/s jog
 * gets ~12s of lead (vs. walking's 8.6s) and a ~7 m/s cycling pace gets ~25s
 * — a real, noticeable increase at each step up, not just constant-time
 * preservation, without exploding to unusable lookahead distances at the
 * top end (capped in practice by getDesiredBearing's corner-distance cap
 * regardless, since a route rarely runs 100m+ straight without a turn).
 */
const PURSUIT_LOOKAHEAD_GROWTH_S = 3.43

/**
 * Growth exponent for lead time above walking pace — super-linear (>1) so
 * lead time itself accelerates with speed, not just the lookahead distance.
 * See `leadTimeS` and PURSUIT_LOOKAHEAD_GROWTH_S for calibration.
 */
const PURSUIT_LOOKAHEAD_EXPONENT = 1.13

/**
 * Lead TIME (s) the pure-pursuit lookahead represents, as a function of live
 * speed. This is deliberately NOT constant above walking pace — verified via
 * sim/straight-noise-sim.ts and live use that a plain constant-time formula
 * (fixed ~8.6s at any speed, i.e. lookahead distance scaling exactly
 * proportional to speed) still made the arrow turn noticeably late at a
 * corner: keeping reaction TIME constant means a runner/cyclist gets no more
 * real-world warning than a walker, even though higher speed makes a late
 * turn more consequential (less time to physically react once the arrow
 * does swing). This curve grows lead time itself with speed — walking stays
 * at the base 8.6s (byte-identical to the original fixed-distance
 * behaviour), then grows super-linearly above walking pace (~12s at a 2.8 m/s
 * jog, ~25s at a 7 m/s cycling pace — see PURSUIT_LOOKAHEAD_GROWTH_S/
 * PURSUIT_LOOKAHEAD_EXPONENT for calibration), so a jog gets moderately more
 * lead time, a run gets more still, and cycling gets disproportionately more
 * — matching "earlier for running than walking, and relatively more for
 * cycling than running" rather than a flat proportional scaling. The
 * resulting lookahead DISTANCE grows quickly at higher speeds (100m+), but
 * getDesiredBearing's corner-distance cap already bounds that against real
 * route geometry, so this only asks for "as much lead as the upcoming route
 * shape actually allows," never an unusably long straight-line reach. Pure
 * function of `speedMs`, no persisted state, still C-portable (one pow()
 * call).
 */
function leadTimeS(speedMs: number): number {
  if (speedMs <= PURSUIT_LOOKAHEAD_MIN_SPEED_MS) return PURSUIT_LOOKAHEAD_BASE_S
  const over = (speedMs - PURSUIT_LOOKAHEAD_MIN_SPEED_MS) / PURSUIT_LOOKAHEAD_MIN_SPEED_MS
  return PURSUIT_LOOKAHEAD_BASE_S + PURSUIT_LOOKAHEAD_GROWTH_S * Math.pow(over, PURSUIT_LOOKAHEAD_EXPONENT)
}

/**
 * Speed-scaled pure-pursuit lookahead distance (m). Faster movement covers
 * any fixed metre radius in less time, so the arrow would start reacting to
 * a corner later in TIME as pace increases if the radius stayed fixed — this
 * grows the lookahead with live speed so the warning arrives with enough
 * real time to react, floored at walking pace so normal walking behaviour is
 * unchanged from the original fixed constant. See `leadTimeS` for why lead
 * time itself grows with speed instead of staying constant.
 */
export function pursuitLookaheadM(speedMs: number): number {
  const v = Number.isFinite(speedMs) ? Math.max(speedMs, PURSUIT_LOOKAHEAD_MIN_SPEED_MS) : PURSUIT_LOOKAHEAD_MIN_SPEED_MS
  return v * leadTimeS(v)
}

/**
 * Offset (m) from the route at which the desired-bearing origin blend (see
 * getDesiredBearing) reaches 50% confidence in the raw position (measured
 * ABOVE `ORIGIN_BLEND_DEAD_ZONE_M` — see that constant). Ordinary GPS noise
 * (2-5m, well under offRouteThresholdM=20) should sit mostly damped toward
 * the route-projected point; a genuine off-route excursion (tens of metres)
 * should saturate toward the raw position so "point back to route" steering
 * stays intact. Same saturating-curve shape as BEARING_CONFIDENCE_HALF_M,
 * chosen for the same reason: no offset value ever removes noise-sensitivity
 * entirely, but it shrinks fast where it matters.
 */
const ORIGIN_BLEND_HALF_M = 42

/**
 * Lateral offset (m) from the route below which the origin blend applies
 * ZERO "steer toward route" bias — the arrow points exactly along the
 * route's own forward direction, same as walking dead-on it. Without this,
 * even a small, CONSTANT lateral offset (e.g. waypoints recorded on one side
 * of a road/path, hiker walking the other side, same direction of travel)
 * produced a small but persistent deflection toward the route line — verified
 * numerically: a 5m constant offset showed a steady ~3° arrow angle, 12m
 * showed ~16°, neither of which converges to 0 over time since the offset
 * itself never shrinks. That reads as "arrow keeps nudging me toward the
 * line" for someone who is, in every real sense, already going the right way.
 * Sized to comfortably cover sidewalk/opposite-side-of-path offsets (a few
 * to ~6m) while staying well under `offRouteThresholdM`'s default (20m) —
 * this only reshapes the ARROW's steering bias, never `findActiveSegment`'s
 * or the off-route alert's own raw-distance off-route detection, so a
 * genuine departure is still caught exactly as before.
 */
const ORIGIN_BLEND_DEAD_ZONE_M = 6

/**
 * Floor (m) the corner-capped lookahead is never shrunk below, even standing
 * right at a corner vertex. Without this, `distToNextCorner` can return a
 * near-zero residual right at the corner, collapsing the lookahead point to
 * almost the anchor's own projected position — which re-exposes the arrow to
 * lateral-noise sensitivity right where responsiveness matters most (the
 * same class of problem ORIGIN_BLEND_HALF_M protects against).
 */
const MIN_LOOKAHEAD_CAP_M = 4

/**
 * The pure-pursuit target point: walk the speed-scaled lookahead distance
 * (`pursuitLookaheadM`) forward along the route from the hiker's projected
 * position on `segIdx`, CAPPED at the distance to the next real corner.
 * Reuses `deadReckonAlongRoute` (core/deadReckoning.ts) — it already projects
 * the anchor onto its segment and walks forward with no persisted state,
 * exactly the pure-pursuit primitive. Falls back to the segment's own bearing
 * (e.g. route too short, or right at the final waypoint) so the arrow still
 * has a sensible direction.
 *
 * Capping at the next corner exists because `deadReckonAlongRoute` has no
 * corner-awareness on its own — it walks the full requested distance through
 * as many segments as needed, including straight through a sharp turn if the
 * lookahead is longer than the distance to it. On real routes this is not
 * rare: back-to-back corners (switchbacks) can be closer together than even
 * the walking-pace lookahead. Uncapped, the arrow's target point lands past
 * BOTH corners, so the arrow shows the bearing after the second turn and
 * appears not to react to the first ("arrow doesn't turn" for back-to-back
 * corners). Capping means the lookahead point can never walk past the next
 * corner — the returned bearing then naturally swings toward that corner as
 * the (now-shorter) lookahead point approaches its vertex, which is exactly
 * pure pursuit's normal single-corner behaviour, just correctly bounded.
 *
 * The returned bearing is measured from an ORIGIN that's blended between the
 * route-projected point and the raw `pos`, not from `pos` directly. Without
 * this, a lookahead point that's always exactly ON the route combined with a
 * raw `pos` that's laterally offset by ordinary GPS noise (a few metres, well
 * within normal accuracy) produces a real, noise-driven "point back toward
 * the route" deflection on every fix — confirmed via sim/straight-noise-sim.ts
 * (a synthetic straight route with zero real direction change anywhere):
 * desired bearing swung 100°+ fix-to-fix from pure noise before this blend.
 * At zero offset the origin is exactly the projected point, so a hiker
 * walking the route dead-on sees the route's own stable forward bearing; as
 * the offset grows toward and past a genuine off-route distance, the origin
 * saturates toward the raw position, preserving today's off-route "steer
 * back to the route" behaviour undamped where it actually matters. This
 * never touches findActiveSegment or off-route alert detection (both use
 * their own raw-pos-based distanceOffRoute) — it only changes which point,
 * on the segment findActiveSegment already selected, the arrow's bearing is
 * measured from.
 *
 * `speedMs` — live speed estimate; omitted/non-finite callers get the
 * walking-pace floor (byte-identical to the original fixed 12m behaviour).
 */
export function getDesiredBearing(
  pos: LatLng,
  route: LatLng[],
  segIdx: number,
  speedMs?: number,
): number {
  const lookaheadM = pursuitLookaheadM(speedMs ?? PURSUIT_LOOKAHEAD_MIN_SPEED_MS)

  const clampedSeg = Math.max(0, Math.min(segIdx, route.length - 2))
  const segStart = route[clampedSeg]!
  const segEnd = route[clampedSeg + 1]!
  const { t } = projectOntoSegment(pos, segStart, segEnd)
  const distanceToNext = (1 - t) * haversineDistance(segStart, segEnd)
  const distToCornerM = distanceToNext + distToNextCorner(route, clampedSeg + 1, CORNER_THRESHOLD_DEG)
  const cappedLookaheadM = Number.isFinite(distToCornerM)
    ? Math.min(lookaheadM, Math.max(distToCornerM, MIN_LOOKAHEAD_CAP_M))
    : lookaheadM

  const result = deadReckonAlongRoute(pos, segIdx, route, cappedLookaheadM)
  if (result) {
    const offsetM = haversineDistance(pos, result.projectedPos)
    // Dead zone: an offset at/under ORIGIN_BLEND_DEAD_ZONE_M contributes zero
    // steer-toward-route bias (confidence 0, origin exactly on the route) —
    // see that constant's doc. Only the excess above the dead zone feeds the
    // saturating confidence curve, so the curve's own shape (and its 50%
    // point at ORIGIN_BLEND_HALF_M above the dead zone) is unchanged, just
    // shifted to start beyond the dead zone instead of at zero offset.
    const excessOffsetM = Math.max(0, offsetM - ORIGIN_BLEND_DEAD_ZONE_M)
    const confidence = excessOffsetM / (excessOffsetM + ORIGIN_BLEND_HALF_M)
    const originPos = lerpLatLng(result.projectedPos, pos, confidence)
    return bearing(originPos, result.pos)
  }
  return bearing(segStart, segEnd)
}

/**
 * Calculate the arrow angle relative to the hiker's movement direction.
 *
 *   0°    = keep going straight (arrow points up)
 *   90°   = turn right
 *  -90°   = turn left
 *  ±180°  = turn around
 *
 * `movementBearing` comes from the last two GPS positions — NOT a compass, and
 * NEVER route direction: always the hiker's real fix-to-fix heading, on-route
 * or off. Returns null when movement bearing is unknown (no movement yet).
 *
 * Pure pursuit gives "point back toward the route, then along it" for free
 * once the hiker is off-route — the lookahead point from `getDesiredBearing`
 * naturally sits back on the route ahead of the projection, no separate
 * off-route mode needed.
 */
export function getArrowAngle(
  pos: LatLng,
  movementBearing: number | null,
  route: LatLng[],
  segIdx: number,
  speedMs?: number,
): number | null {
  if (route.length < 2) return null
  if (movementBearing === null) return null

  const desired = getDesiredBearing(pos, route, segIdx, speedMs)
  return normalizeAngle(desired - movementBearing)
}

/** Minimum movement (m) before bearing is updated. Below GPS jitter; above one auto-walk tick. */
const MIN_BEARING_MOVE_M = 0.5

/**
 * Distance (m) of accumulated anchor→curr movement required before the
 * anchor re-snaps to `curr` (see computeMovementBearing's `nextAnchor`).
 * This is the NOISE-AVERAGING baseline — it does NOT gate how quickly a
 * reading is trusted (see `BEARING_CONFIDENCE_HALF_M` for that; the two used
 * to be one constant and are deliberately split now — see that constant's
 * doc for why).
 *
 * 20 (was 10, originally 6) — raised after a live report that the arrow
 * "almost never" settles exactly straight on a genuinely straight walk, just
 * sitting a few degrees off persistently. Root cause measured directly: in
 * save-mode's sparse polling, a single real step between fixes is routinely
 * 10-29m — already at or past the old value of 10, so the anchor snapped to
 * `curr` on nearly EVERY fix. That means the anchor was barely accumulating
 * any baseline at all — each fix's bearing was effectively measured over
 * just the one most recent step, at whatever lateral noise that single step
 * happened to carry (atan(4m accuracy / 15m step) ~15°), not a genuinely
 * averaged-out longer baseline. A full save-mode pipeline sim (Kalman +
 * median filter + real poll cadence, not raw noise) confirmed only ~37% of
 * fixes sat under 3° of true straight and p90 was ~14° at the old value;
 * raising to 20 improved p90 to ~9° (median 4.5°→3.3°).
 */
const BEARING_ANCHOR_RESNAP_M = 20

/**
 * Distance (m) at which blend CONFIDENCE reaches 50% — separate from
 * `BEARING_ANCHOR_RESNAP_M` (the anchor re-snap distance) on purpose. Below
 * this, GPS noise dominates true displacement and the bearing barely
 * updates; well above it, confidence approaches (but never reaches) 1 — see
 * computeMovementBearing's confidence curve. Roughly: perpendicular GPS
 * noise of a few metres skews a two-point bearing by atan(noise / distance),
 * which is still tens of degrees even at 10-12 m displacement (e.g. 4 m
 * noise at 10 m ⇒ ~22°) — so trusting a fix "outright" (zero smoothing) at
 * any fixed, reasonably-small distance lets lateral noise swing the arrow. A
 * saturating curve keeps a smoothing floor at any distance while still
 * responding to a real turn within a couple of fixes.
 *
 * Was folded into BEARING_ANCHOR_RESNAP_M as one constant (both at 10, then
 * both raised to 20 together) — split apart after a live report that
 * raising the shared value to fix straight-line jitter made the arrow turn
 * noticeably later before a corner and stay turned longer after one. The
 * two jobs want opposite tuning: noise-averaging wants a LONGER anchor
 * baseline (fewer re-snaps, cleaner signal), while trusting a genuine
 * direction change wants a SHORTER confidence distance (react fast once a
 * real jump is seen). Kept at the original 10 (pre-raise value) so turn
 * responsiveness reverts to what it was before the anchor change, while
 * BEARING_ANCHOR_RESNAP_M stays at 20 for the straight-line benefit.
 * Measured together via a combined straight+turn harness: anchor=20/conf=10
 * gave turn90 ~14.9m (vs ~17.8m at the old single value of 10, and ~19.9m at
 * a naive shared value of 20) and turn180 ~25.3m (vs ~28.4m / ~32.3m), while
 * straight-line median stayed at 4.3° (vs 4.5° old, 3.3° naive-20) — better
 * turn response than either single-value choice, at a small straight-line
 * cost relative to the naive-20 option, not the old baseline.
 */
const BEARING_CONFIDENCE_HALF_M = 10

/**
 * Distance (m) of accumulated movement (from the bearing anchor) required
 * before the FIRST-EVER movement bearing is allowed to lock in
 * (`hasConfidentBearing`). Deliberately smaller than
 * `BEARING_ANCHOR_RESNAP_M`/`BEARING_CONFIDENCE_HALF_M` (which govern an
 * already-established bearing) — this only needs to clear ordinary GPS
 * jitter (documented elsewhere in this file as ~1-6m on short steps), not
 * reach the 50%-trust distance, since the consequence of promoting too early
 * here is a single outright, unsmoothed snap (see computeMovementBearing's
 * `!hasConfidentBearing` branch) rather than an ongoing blend. Too low (e.g.
 * the old MIN_BEARING_MOVE_M=0.5m) let a single small jitter blip while
 * genuinely stationary snap to a noise-derived bearing that then froze once
 * isMoving flipped to stopped (arrow showing a bogus turn while "Paused").
 * Too high (e.g. reusing the 10-20m distances above) made a hiker walk
 * several seconds before the arrow appears at all, which reads as broken. 5m
 * splits the difference: clearly above jitter, still quick.
 */
const FIRST_BEARING_CONFIRM_M = 5

/**
 * Above this fix-to-fix bearing jump (degrees), don't trust a single fix —
 * hold the last bearing and wait for a second, agreeing fix. Verified via
 * sim/trace-dump.ts replay: on genuinely straight route segments (same
 * activeSegIdx across consecutive fixes, i.e. no real turn happening), GPS/
 * Kalman noise on short (1-6m) steps was producing raw two-point bearing
 * jumps of 30-80°+, purely from a few metres of lateral noise — because
 * atan(noise / shortDistance) is large regardless of how well the resulting
 * single reading is then blended. A real turn's consecutive fixes are
 * directionally correlated (all measuring progress around the same corner)
 * and agree with each other quickly; noise between independent fixes is not
 * correlated and essentially never agrees twice in a row within
 * PENDING_AGREEMENT_DEG. 45° sits above ordinary noise-induced single-fix
 * jumps at accumulated-anchor distances, but below the smallest real corner
 * this app cares about (CORNER_THRESHOLD_DEG = 25° is the route-shape corner
 * threshold; a real turn's bearing swing is typically much larger than its
 * waypoint angle since the hiker walks through it over several fixes).
 */
const LARGE_BEARING_JUMP_DEG = 45

/**
 * How closely a second fix's raw bearing must agree with the pending
 * candidate (see LARGE_BEARING_JUMP_DEG) to be accepted as a confirmed
 * direction change rather than a second, unrelated noise fluke. Generous on
 * purpose — real turns are the target to let through promptly, not to add
 * extra lag to; two independent noisy fixes agreeing this closely by chance
 * is rare, while two consecutive real-turn fixes reliably do.
 */
const PENDING_AGREEMENT_DEG = 12

/**
 * Confidence weight applied to a trusted Doppler heading in the blend below —
 * deliberately FIXED, not the saturating `dist`-based curve
 * (`BEARING_CONFIDENCE_HALF_M`) used for position-diff bearing. That curve
 * exists specifically to counter position-diff's failure mode: a two-point
 * bearing's error is `atan(GPS noise / distance walked)`, which is huge at
 * the short (1-15m) steps this app runs at, so confidence has to ramp up with
 * distance to avoid trusting a short, noise-dominated step. Doppler heading
 * doesn't have that failure mode at all — it's a direct instantaneous
 * measurement of the velocity vector, not a difference of two noisy points —
 * so gating its confidence on distance-walked would be applying the wrong
 * physics to a different signal.
 *
 * Measured, not guessed: `sim/doppler-heading-sim.ts` sweeps this constant
 * against BOTH a straight-line noise model (fix-to-fix swing, |arrowAngle|
 * error) and a synthetic 90° turn (settle distance past the corner) — the
 * same tension `BEARING_CONFIDENCE_HALF_M` balances for position-diff.
 * Naively going HIGH (e.g. 0.85, "trust it, it's a good signal") was tried
 * first and was wrong: it settles turns fast (~1.7m) but makes STRAIGHT-line
 * swing/error *worse* than the pre-Doppler baseline (p90 swing 7.9°→11.2°) —
 * Doppler's own per-fix noise, applied at near-full weight every single fix
 * with no distance-baseline averaging, dominates. 0.5 is the measured sweet
 * spot: strictly better than the no-Doppler baseline on EVERY metric at once
 * (80-seed sweep: straight swing p90 8.1°→5.7°, straight error p90
 * 19.2°→5.8°, turn-settle p90 25.5m→7.3m) — both smoother AND ~3x faster to
 * recognize a real turn, not a tradeoff between them. Re-run the sim if this
 * is ever retuned; don't hand-pick a value without it.
 */
const DOPPLER_CONFIDENCE = 0.5

interface MovementBearingResult {
  bearing: number
  anchorPos: LatLng
  pendingBearing: number | null
}

/**
 * Movement bearing — the real heading the arrow is measured against, never
 * route direction or a route-derived substitute. Mixing in route direction on
 * straights (the old behaviour) was the root cause of the arrow spinning
 * through corners, since it silently swapped reference frames. Nothing below
 * reads route geometry at all.
 *
 * Prefers the GPS chip's own Doppler-derived heading (`dopplerHeadingDeg`,
 * resolved by `resolveFixHeading` in core/motion.ts) over a two-fix position
 * delta whenever it's trusted this tick. This is the single biggest lever for
 * arrow stability: a two-point position-delta bearing's error is
 * `atan(GPS noise / distance walked)`, which is large at the short (1-15m)
 * steps this app runs at — a few metres of ordinary position noise swings it
 * tens of degrees. Doppler heading comes from the Doppler shift on the
 * velocity vector the GPS chip already computes internally — a direct
 * measurement, not a difference of two independently-noisy points — so it
 * doesn't inherit that error. It's near-universal across GPS chips (NMEA
 * VTG/RMC `cog`, UBX-NAV-PVT `headMot`), including the watch-scale modules
 * this app targets (see PRODUCT_CONCEPT.md) — this is NOT a phone-only or
 * magnetometer-based signal, so it stays within the "must be doable with real
 * hardware" constraint (contrast with the compass-check feature, which uses
 * the phone's magnetometer and is explicitly a manual/stationary-only aid,
 * never a `movementBearing` substitute — see getCompassArrowAngle).
 *
 * Falls back to the position-delta bearing (`gpsBearing`, computed from an
 * ANCHOR position — see below) whenever Doppler isn't trusted this tick: near-
 * stationary (no real velocity for the Doppler measurement to mean anything),
 * a fix/source that doesn't report heading (older devices, some simulators),
 * or a non-finite reading.
 *
 * `gpsBearing` is computed from an ANCHOR position (`anchorPos`), not the
 * immediately previous fix — the anchor holds still across several ticks so
 * the raw bearing is measured over accumulated real displacement rather than
 * a single short, noise-dominated step (a few metres of lateral GPS noise
 * produces a much smaller angular error over 10m of real accumulated
 * movement than over a 1-6m single step). Re-anchors at `curr` once
 * accumulated distance clears BEARING_ANCHOR_RESNAP_M, so the next tick's
 * raw geometry has a fresh, similarly-sized baseline again — this never
 * stalls a genuine turn: the raw bearing is still recomputed every tick,
 * it's just measured against a point a little further back than the last
 * fix, and a real turn's consecutive fixes still skew the anchor→curr
 * bearing toward the new heading together. The anchor keeps advancing even
 * while Doppler is driving the blend, so the position-delta fallback is
 * always ready with a fresh baseline the moment Doppler drops out.
 *
 * A large single-fix jump (see LARGE_BEARING_JUMP_DEG) is not applied
 * immediately — it's held as `pendingBearing` and only accepted once a
 * second fix's raw bearing agrees with it (PENDING_AGREEMENT_DEG), rejecting
 * single-fix noise flukes while still letting a real turn (whose consecutive
 * fixes agree) through within 1-2 fixes, matching the existing "several
 * consecutive agreeing-direction fixes converge quickly" behaviour a genuine
 * turn already relied on before this change. Doppler headings go through this
 * same jump/agreement gate — a genuinely bad chip reading is just as capable
 * of a large single-tick jump as position-diff noise, so it gets the same
 * two-fix confirmation before being trusted outright.
 *
 * `isMoving` — Doppler-derived stop/moving state (see updateIsMoving in
 * core/motion.ts), robust to GPS position jitter even when truly stationary
 * (Doppler reads ~0 at a standstill regardless of position noise). When false,
 * the bearing (and anchor/pending state) freeze outright: without this, a
 * genuinely stationary hiker's Kalman-filtered position still wobbles by a
 * few metres fix-to-fix from pure noise, and the
 * confidence-scaled blend below would keep nudging the bearing a little
 * toward each wobble's (random) direction — so the arrow visibly
 * "breathes"/drifts while standing still, even though no single nudge looks
 * like an outlier. Defaults to true so existing callers that don't track
 * stop state are unaffected.
 */
export function computeMovementBearing(
  anchorPos: LatLng | null,
  curr: LatLng,
  lastMovementBearing: number,
  pendingBearing: number | null,
  isMoving = true,
  hasConfidentBearing = true,
  dopplerHeadingDeg: number | null = null,
): MovementBearingResult {
  if (!isMoving) {
    return { bearing: lastMovementBearing, anchorPos: anchorPos ?? curr, pendingBearing }
  }

  const anchor = anchorPos ?? curr
  const dist = haversineDistance(anchor, curr)

  // Doppler doesn't need a position-delta baseline to be trustworthy (that's
  // its whole advantage over position-diff) — so it can still update the
  // bearing on a tick where the position barely moved, unlike the position-diff
  // path just below which needs MIN_BEARING_MOVE_M of real displacement to mean
  // anything. The anchor is left untouched here (not yet "moved enough" to
  // re-baseline), so the position-diff fallback keeps accumulating normally
  // underneath, ready the moment Doppler drops out.
  if (dist < MIN_BEARING_MOVE_M) {
    if (dopplerHeadingDeg !== null && hasConfidentBearing) {
      const jump = Math.abs(normalizeAngle(dopplerHeadingDeg - lastMovementBearing))
      if (jump <= LARGE_BEARING_JUMP_DEG) {
        return {
          bearing: lerpBearing(lastMovementBearing, dopplerHeadingDeg, DOPPLER_CONFIDENCE),
          anchorPos: anchor,
          pendingBearing: null,
        }
      }
      // Large Doppler jump while position barely moved (e.g. pivoting in place
      // at a junction) — same hold-and-confirm treatment as a large position-diff
      // jump, just recorded here since the distance gate above would otherwise
      // skip it entirely: without this, a real Doppler-detected turn taken
      // slowly/in-place could never accumulate a pending candidate to confirm
      // against, freezing indefinitely instead of settling within a couple of
      // fixes once a second agreeing reading arrives.
      const agreesWithPending =
        pendingBearing !== null && Math.abs(normalizeAngle(dopplerHeadingDeg - pendingBearing)) <= PENDING_AGREEMENT_DEG
      if (agreesWithPending) {
        return {
          bearing: lerpBearing(lastMovementBearing, dopplerHeadingDeg, DOPPLER_CONFIDENCE),
          anchorPos: anchor,
          pendingBearing: null,
        }
      }
      return { bearing: lastMovementBearing, anchorPos: anchor, pendingBearing: dopplerHeadingDeg }
    }
    return { bearing: lastMovementBearing, anchorPos: anchor, pendingBearing }
  }

  const gpsBearing = bearing(anchor, curr)
  const nextAnchor = dist >= BEARING_ANCHOR_RESNAP_M ? curr : anchor

  // No prior CONFIDENT bearing yet — snap outright instead of blending from a
  // meaningless placeholder (INITIAL_NAV_STATE.movementBearing defaults to 0,
  // which isn't a real heading). Blending here would treat the very first
  // real bearing reading as partially "noise" relative to nothing, producing
  // an artificial swing on the NEXT tick once the blended value catches up —
  // a cold-start artifact, not real jitter. Doppler is preferred here too when
  // available — a direct measurement is a better cold-start value than a
  // position delta over whatever short distance just cleared FIRST_BEARING_CONFIRM_M.
  if (!hasConfidentBearing) {
    return { bearing: dopplerHeadingDeg ?? gpsBearing, anchorPos: curr, pendingBearing: null }
  }

  // observedBearing/observedConfidence: Doppler heading (fixed, high
  // confidence — see DOPPLER_CONFIDENCE) when trusted this tick, else the
  // position-diff bearing under its own distance-scaled confidence curve.
  //
  // Confidence-scaled blend, SATURATING (never reaches 1): a two-point
  // bearing's error from perpendicular GPS noise is atan(noise / dist), which
  // shrinks with distance but never hits zero — a fixed "trust outright" cutoff
  // was verified (via sim/trace-dump.ts replay against real GPX data) to let
  // ~10-12 m save-mode steps swing the arrow 100°+ on a dead-straight walk,
  // purely from a few metres of lateral noise. dist / (dist +
  // BEARING_CONFIDENCE_HALF_M) rises smoothly from 0 and approaches 1 only
  // asymptotically: 0.5 at dist == BEARING_CONFIDENCE_HALF_M, ~0.75 at 3x,
  // ~0.9 at 9x — so even a large single-fix displacement retains a little
  // smoothing against lateral noise, while a genuine sustained turn (several
  // consecutive fixes agreeing) still converges within a couple of fixes
  // instead of lagging indefinitely. Deliberately measured from `dist`
  // (anchor→curr, same distance nextAnchor uses) rather than a separate
  // measurement — only the 50%-point CONSTANT differs from the anchor
  // re-snap distance, not what's being measured. Doesn't apply to Doppler at
  // all — see DOPPLER_CONFIDENCE's doc for why distance-gating is the wrong
  // physics for that signal.
  const observedBearing = dopplerHeadingDeg ?? gpsBearing
  const observedConfidence = dopplerHeadingDeg !== null
    ? DOPPLER_CONFIDENCE
    : dist / (dist + BEARING_CONFIDENCE_HALF_M)

  const jump = Math.abs(normalizeAngle(observedBearing - lastMovementBearing))
  if (jump <= LARGE_BEARING_JUMP_DEG) {
    return {
      bearing: lerpBearing(lastMovementBearing, observedBearing, observedConfidence),
      anchorPos: nextAnchor,
      pendingBearing: null,
    }
  }

  const agreesWithPending =
    pendingBearing !== null && Math.abs(normalizeAngle(observedBearing - pendingBearing)) <= PENDING_AGREEMENT_DEG

  if (agreesWithPending) {
    // A confirmed real turn (two independent fixes agreeing) re-anchors
    // HALFWAY to curr, not just via the normal distance-gated `nextAnchor`.
    // Without this, the anchor stays stuck behind the turn until 10m of
    // (mixed pre-/post-turn) chord distance accumulates, so every subsequent
    // fix's anchor→curr bearing keeps blending in stale pre-turn geometry —
    // measured via sim/measure-turn-lag.ts to take ~12-40 fixes (~18-40m) to
    // settle within 20° of the true new heading on a 90-180° turn.
    // Snapping the anchor ALL the way to curr was tried and rejected: it
    // starves the very next fix's baseline distance down to a single ~1 fix
    // step (~1.4m at walking pace), collapsing `confidence` toward 0 so the
    // blend barely moves — measured to never converge within 40 fixes on a
    // 135-180° turn. Halfway keeps a still-meaningful baseline while
    // discarding most of the stale distance, cutting convergence to ~13-20
    // fixes (~18-28m) with no increase in settled-bearing jitter (verified:
    // post-recognition bearing std-dev stayed flat vs the un-re-anchored
    // baseline, unlike full re-anchoring which raised it ~40-70%). Still
    // reanchors from position (`anchor`/`curr`), even when Doppler is what
    // confirmed the turn — the anchor only ever serves the position-diff
    // fallback path, so it must stay position-based regardless of which
    // signal drove this tick's bearing.
    const halfAnchor = lerpLatLng(anchor, curr, 0.5)
    return {
      bearing: lerpBearing(lastMovementBearing, observedBearing, observedConfidence),
      anchorPos: halfAnchor,
      pendingBearing: null,
    }
  }

  // First sighting of a large jump (or one that doesn't match the previous
  // pending candidate) — hold the bearing, remember this reading to check
  // against on the next tick. Anchor is left alone (not yet confirmed as a
  // real turn) so a noise fluke that's never confirmed doesn't disturb the
  // established smoothing baseline.
  return { bearing: lastMovementBearing, anchorPos: nextAnchor, pendingBearing: observedBearing }
}

/**
 * Detect whether a sharp corner (turn angle > CORNER_THRESHOLD_DEG) was
 * crossed while `activeWaypointIdx` advanced from `lastCheckedWpIdx` to
 * `activeWaypointIdx`. Scans the WHOLE range crossed, not just the single
 * newest waypoint — `activeSegIdx` can (and does, especially with sparse
 * GPS polling, where one real step is often 10-20m+) jump by several
 * waypoints in a single tick via `findActiveSegment`'s windowed search. A
 * single-step check silently misses a corner whenever the match jumps PAST
 * its waypoint instead of landing exactly on it — verified live: this let
 * the post-corner fast-polling cooldown never arm at all for some real
 * corners. Returns the LAST (furthest-along) corner in the range, matching
 * `distancePastCornerM`'s own "how far past THIS corner" measurement.
 *
 * Handles `activeWaypointIdx` moving backward too (e.g. findActiveSegment's
 * backward-sticky resolution) — the range is always built from
 * min(previous, current) to max(previous, current), so it's direction-
 * agnostic.
 *
 * Pure geometry, no time — returns which waypoint (if any), not when. The
 * caller turns "a corner was crossed" into a cooldown TIMER using its own
 * clock (see NavState.sharpTurnJustCrossed's doc for why time never enters
 * this module).
 */
function detectCrossedCorner(
  route: LatLng[],
  lastCheckedWpIdx: number,
  activeWaypointIdx: number,
): number | null {
  if (activeWaypointIdx === lastCheckedWpIdx) return null
  const rangeStart = Math.max(1, Math.min(lastCheckedWpIdx, activeWaypointIdx - 1))
  const rangeEnd = Math.max(lastCheckedWpIdx, activeWaypointIdx - 1)
  for (let wp = rangeEnd; wp >= rangeStart; wp--) {
    if (waypointTurnAngle(route, wp) > CORNER_THRESHOLD_DEG) return wp
  }
  return null
}

/**
 * Full navigation tick — call once per GPS update. Pure pursuit: project onto
 * the route, look a fixed distance ahead along it, point the arrow there
 * relative to the real movement bearing. No persisted arc, no corner-cut
 * special case, no separate off-route mode.
 *
 * `NavState.activeSegIdx` is the segment the hiker is projected onto —
 * `route[activeSegIdx] → route[activeSegIdx + 1]`.
 *
 * `rawPos` — unfiltered GPS position passed to `findActiveSegment` for off-route
 * distance measurement, while `pos` (Kalman-filtered) is used for arrow/bearing.
 *
 * `isMoving` — see computeMovementBearing; freezes the movement bearing (and so
 * the arrow) while genuinely stationary, instead of drifting on GPS noise.
 *
 * `speedMs` — live speed estimate, used to scale the pure-pursuit lookahead
 * distance (see `pursuitLookaheadM`) so faster movement gets earlier corner
 * warning in time, not just distance. Omitted callers get the walking-pace
 * floor, unchanged from the original fixed-lookahead behaviour.
 *
 * `dopplerHeadingDeg` — GPS chip's Doppler-derived heading for this fix,
 * already resolved (trusted/untrusted) by the caller via `resolveFixHeading`
 * (core/motion.ts); null when unavailable or not trusted this tick. See
 * `computeMovementBearing`'s doc for why this takes priority over a two-fix
 * position delta. Omitted callers keep the original position-delta-only
 * behaviour, unchanged.
 */
export function navigationTick(
  pos: LatLng,
  prevPos: LatLng | null,
  route: LatLng[],
  lastState: NavState,
  config: NavConfig = DEFAULT_NAV_CONFIG,
  rawPos?: LatLng,
  isMoving = true,
  speedMs?: number,
  dopplerHeadingDeg: number | null = null,
): NavState {
  if (route.length < 2) return lastState

  const { segIdx, distanceOffRoute } = findActiveSegment(
    pos, route, lastState.activeSegIdx, rawPos, config.offRouteThresholdM,
  )

  const bearingResult =
    prevPos !== null
      ? computeMovementBearing(
          lastState.bearingAnchorPos,
          pos,
          lastState.movementBearing,
          lastState.pendingBearing,
          isMoving,
          lastState.hasConfidentBearing,
          dopplerHeadingDeg,
        )
      : { bearing: lastState.movementBearing, anchorPos: lastState.bearingAnchorPos, pendingBearing: lastState.pendingBearing }
  const movementBearing = bearingResult.bearing
  // First-time confidence requires clearing FIRST_BEARING_CONFIRM_M (see its
  // doc) — not just MIN_BEARING_MOVE_M, whose 0.5m dead-band only guards
  // against recomputing on a truly zero-length step and is easily cleared by
  // ordinary GPS jitter alone. Measuring from the ANCHOR (not just the
  // previous fix) matches what computeMovementBearing itself measures.
  const anchorForConfidence = lastState.bearingAnchorPos ?? prevPos
  const movedEnough =
    prevPos !== null &&
    anchorForConfidence !== null &&
    haversineDistance(anchorForConfidence, pos) >= FIRST_BEARING_CONFIRM_M
  const hasConfidentBearing = lastState.hasConfidentBearing || (isMoving && movedEnough)

  const arrowAngle = getArrowAngle(pos, movementBearing, route, segIdx, speedMs)

  const target = route[Math.min(segIdx + 1, route.length - 1)]!
  const distanceToNext = haversineDistance(pos, target)

  const crossedCornerWpIdx = detectCrossedCorner(route, lastState.activeSegIdx + 1, segIdx + 1)
  const sharpTurnJustCrossed = crossedCornerWpIdx !== null
  const lastSharpTurnWpIdx = sharpTurnJustCrossed ? crossedCornerWpIdx : lastState.lastSharpTurnWpIdx

  return {
    activeSegIdx: segIdx,
    movementBearing,
    hasConfidentBearing,
    arrowAngle: arrowAngle ?? lastState.arrowAngle,
    distanceToNext,
    distanceOffRoute,
    bearingAnchorPos: bearingResult.anchorPos,
    pendingBearing: bearingResult.pendingBearing,
    lastSharpTurnWpIdx,
    sharpTurnJustCrossed,
  }
}

/**
 * Arrow angle for compass-check mode.
 *
 * Instead of movement-bearing (GPS position delta) this uses the device's
 * real compass heading so the arrow is correct even when standing still.
 *
 * Returns null when deviceHeading is unavailable or not finite.
 */
export function getCompassArrowAngle(
  pos: LatLng,
  deviceHeading: number | null,
  route: LatLng[],
  segIdx: number,
): number | null {
  if (deviceHeading === null || !isFinite(deviceHeading)) return null
  if (route.length < 2) return null
  const desired = getDesiredBearing(pos, route, segIdx)
  return normalizeAngle(desired - deviceHeading)
}

/**
 * Search the entire route for the nearest segment to `pos`.
 * Used on GPS activation to correctly initialize position regardless of
 * where the user actually is on the route.
 */
export function findNearestSegmentGlobal(
  pos: LatLng,
  route: LatLng[],
  preferArcM?: number,
): number {
  if (route.length < 2) return 0

  // Arc of each segment's start, walked once. Only needed when a preference is
  // supplied; on a closed loop two coincident folds (e.g. the shared start/end
  // node) sit at the same distance, and without a tie-break the *last* equal
  // match would win — snapping a start at the loop origin to the far end fold.
  let bestSeg = 0
  let bestDist = Infinity
  let bestArcDelta = Infinity
  let arc = 0
  const TIE_M = 3 // distances within this are "equal"; break by arc proximity
  for (let i = 0; i < route.length - 1; i++) {
    const segArc = arc
    arc += haversineDistance(route[i]!, route[i + 1]!)
    const { distance } = projectOntoSegment(pos, route[i]!, route[i + 1]!)
    const arcDelta = preferArcM !== undefined ? Math.abs(segArc - preferArcM) : 0
    if (distance < bestDist - TIE_M) {
      // Clearly closer — take it outright.
      bestDist = distance; bestSeg = i; bestArcDelta = arcDelta
    } else if (distance < bestDist + TIE_M) {
      // A near-tie in distance: prefer the candidate closest to the preferred arc
      // (or, without a preference, keep the earlier/lower-arc one).
      if (preferArcM !== undefined ? arcDelta < bestArcDelta : distance < bestDist) {
        bestDist = Math.min(bestDist, distance); bestSeg = i; bestArcDelta = arcDelta
      }
    }
  }
  return bestSeg
}

export const INITIAL_NAV_STATE: NavState = {
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
}
