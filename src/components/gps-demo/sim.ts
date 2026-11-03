/**
 * The GPS arrow demo's simulation, separate from the UI so it can be tested
 * headlessly (./__tests__/sim.test.ts).
 *
 * A "true" hiker walks around; the simulated device only ever sees noisy GPS
 * readings taken when its battery-saving schedule says so. Every reading goes
 * through the full navigation pipeline from the gps repo (./core, copied
 * unchanged): outlier filter, Kalman smoothing, route tracking and the arrow
 * angle. Like the real device, it has no compass: it learns which way you walk
 * only from how the GPS readings move, so the arrow updates at GPS checks.
 */
import { DEFAULT_NAV_CONFIG, type NavConfig } from './config';
import { INITIAL_ARROW_EASE_STATE, stepArrowEase, updateArrowEaseTarget, type ArrowEaseState } from './core/arrowEase';
import { navStateAtRouteStart } from './core/autoWalk';
import { densifyTurnsOnly } from './core/densify';
import {
  INITIAL_FIX_PIPELINE_STATE,
  processFix,
  resetFixAcquisition,
  type FixPipelineState,
} from './core/fixPipeline';
import { bearing, haversineDistance, movePosition, normalizeAngle } from './core/geo';
import {
  computeGpsIntervalMs,
  resolveEffectiveGpsMode,
  shouldBurstPerformance,
  type GpsIntervalInput,
} from './core/gpsInterval';
import { updateIsOffRoute } from './core/motion';
import { douglasPeucker } from './core/simplify';
import { DEFAULT_NOISE, dopplerHeading, dopplerSpeed, makeRng, sampleNoisyFix, ZERO_DRIFT, type DriftState, type Rng } from './core/simWalker';
import type { LatLng } from './core/types';
import { ROUTE, toXY, viewBox } from './projection';

export const CONFIG: NavConfig = DEFAULT_NAV_CONFIG;
/** Demo time runs this many times faster than real time. */
export const SIM_SPEED = 6;
export const WALK_MS = 1.4;
/** How often GPS reads while tracking continuously (off the route, through corners). */
const CONTINUOUS_MS = 1000;
const TURN_DEG_PER_REAL_S = 110;
const ARROW_MAX_DEG_PER_S = 120;
const FIX_TRAIL = 14;
/** "Take a wrong turn": heading change and distance walked. */
const WRONG_TURN_DEG = 100;
const WRONG_TURN_M = 45;
/** When walking back to the route, aim this far ahead of the nearest route point. */
const REJOIN_AHEAD_M = 10;
/** Padding around the route on the demo map (GpsDemo's viewBox). */
export const MAP_PAD_M = 45;
/** Keep the wrong-turn end point this far inside the map edge, so the hiker marker (about 30 m in radius on the map) isn’t cut off. */
const WRONG_TURN_EDGE_MARGIN_M = 35;

/** The route as the device stores it: simplified, then densified at turns (same as the app). */
export const NAV_ROUTE: LatLng[] = densifyTurnsOnly(douglasPeucker(ROUTE, 5), CONFIG.turnThresholdDeg);

const CUM: number[] = (() => {
  const out = [0];
  for (let i = 1; i < ROUTE.length; i++) out.push(out[i - 1]! + haversineDistance(ROUTE[i - 1]!, ROUTE[i]!));
  return out;
})();
export const TOTAL_M = CUM[CUM.length - 1]!;

function pointAlong(d: number): { pos: LatLng; heading: number } {
  const dist = Math.max(0, Math.min(TOTAL_M, d));
  let i = 1;
  while (i < CUM.length - 1 && CUM[i]! < dist) i++;
  const a = ROUTE[i - 1]!;
  const b = ROUTE[i]!;
  const segLen = CUM[i]! - CUM[i - 1]!;
  const t = segLen === 0 ? 0 : (dist - CUM[i - 1]!) / segLen;
  return { pos: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }, heading: bearing(a, b) };
}

/** Metres along the walked route to the point nearest `p` (flat projection, fine at this scale). */
function nearestAlong(p: LatLng): { along: number; distM: number } {
  const q = toXY(p);
  let best = { along: 0, distM: Infinity };
  for (let i = 1; i < ROUTE.length; i++) {
    const a = toXY(ROUTE[i - 1]!);
    const b = toXY(ROUTE[i]!);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2));
    const distM = Math.hypot(a.x + dx * t - q.x, a.y + dy * t - q.y);
    if (distM < best.distM) best = { along: CUM[i - 1]! + t * (CUM[i]! - CUM[i - 1]!), distM };
  }
  return best;
}

export type Mode = 'idle' | 'auto' | 'manual' | 'goto' | 'wrong';
export interface Keys {
  fwd: boolean;
  left: boolean;
  right: boolean;
}

export interface Sim {
  /** Demo seconds since start. */
  t: number;
  /** Real milliseconds since start (drives the arrow animation). */
  realMs: number;
  // The true hiker
  pos: LatLng;
  heading: number;
  mode: Mode;
  autoDist: number;
  goto: LatLng | null;
  resumeAutoAt: number | null;
  wrongHeading: number;
  wrongLeftM: number;
  moving: boolean;
  // The device
  pipeline: FixPipelineState;
  isOffRoute: boolean;
  nextFixAt: number;
  lastIntervalMs: number;
  reason: string;
  fixes: { pos: LatLng; t: number }[];
  fixCount: number;
  arrow: ArrowEaseState;
  rng: Rng;
  drift: DriftState;
  arrived: boolean;
  started: boolean;
}

export function initialSim(): Sim {
  const start = ROUTE[0]!;
  const pipeline = resetFixAcquisition({
    ...INITIAL_FIX_PIPELINE_STATE,
    navState: navStateAtRouteStart(start, NAV_ROUTE, CONFIG),
    position: start,
  });
  return {
    t: 0,
    realMs: 0,
    pos: start,
    heading: bearing(ROUTE[0]!, ROUTE[1]!),
    mode: 'idle',
    autoDist: 0,
    goto: null,
    resumeAutoAt: null,
    wrongHeading: 0,
    wrongLeftM: 0,
    moving: false,
    pipeline: { ...pipeline, speedMs: WALK_MS },
    isOffRoute: false,
    nextFixAt: 0,
    lastIntervalMs: CONTINUOUS_MS,
    reason: '',
    fixes: [],
    fixCount: 0,
    arrow: INITIAL_ARROW_EASE_STATE,
    rng: makeRng(0x6a2b),
    drift: ZERO_DRIFT,
    arrived: false,
    started: false,
  };
}

function reasonFor(s: Sim, ms: number, input: GpsIntervalInput): string {
  if (s.isOffRoute) return 'off the route, GPS stays on';
  if (s.pipeline.gpsBurstActive) return 'going through a corner';
  if (!s.pipeline.isMoving) return 'standing still';
  if (ms >= CONFIG.straightIntervalMs) return 'long straight, saving battery';
  if (ms <= 1000 && (input.distanceOffRoute ?? 0) > CONFIG.offRouteThresholdM / 2) return 'drifting off the route';
  if (ms <= 1000 && (input.arrowAngleDeg ?? 0) >= CONFIG.arrowTurnThresholdDeg) return 'arrow is turning';
  if (ms <= 1000) return 'corner close';
  if (ms < 4000) return 'corner coming up';
  return 'steady walking';
}

/** One GPS reading: run it through the device's pipeline and schedule the next one. */
function takeFix(s: Sim) {
  const nowMs = s.t * 1000;
  const noisy = sampleNoisyFix(s.pos, DEFAULT_NOISE, s.rng, s.drift, s.lastIntervalMs / 1000);
  s.drift = noisy.drift;
  const groundMs = s.moving ? WALK_MS : 0;
  const result = processFix(
    s.pipeline,
    {
      lat: noisy.pos.lat,
      lng: noisy.pos.lng,
      heading: groundMs > 0 ? dopplerHeading(s.heading, groundMs, s.rng) : NaN,
      speedMs: dopplerSpeed(groundMs, s.rng),
      accuracy: noisy.accuracyM,
    },
    NAV_ROUTE,
    CONFIG,
    nowMs,
    false,
  );
  s.pipeline = result.state;
  const nav = s.pipeline.navState;
  s.isOffRoute = updateIsOffRoute(s.isOffRoute, nav.distanceOffRoute, CONFIG.offRouteThresholdM);
  if (nav.hasConfidentBearing) s.arrow = updateArrowEaseTarget(s.arrow, nav.arrowAngle, s.realMs);

  // Next check: same inputs as the app's save-mode scheduler (App.tsx getGpsInterval).
  const input: GpsIntervalInput = {
    route: NAV_ROUTE,
    activeWaypointIdx: nav.activeSegIdx + 1,
    distanceToNext: nav.distanceToNext,
    speedMs: s.pipeline.speedMs,
    msSinceCornerPass: s.pipeline.lastSharpTurnFixMs !== null ? nowMs - s.pipeline.lastSharpTurnFixMs : null,
    cornerWpIdx: nav.lastSharpTurnWpIdx,
    pos: s.pipeline.position ?? noisy.pos,
    distanceOffRoute: nav.distanceOffRoute,
    offRouteThresholdM: CONFIG.offRouteThresholdM,
    steady: s.pipeline.isMoving,
    straightIntervalMs: CONFIG.straightIntervalMs,
    arrowAngleDeg: Math.abs(nav.arrowAngle),
    arrowTurnThresholdDeg: CONFIG.arrowTurnThresholdDeg,
  };
  if (!s.pipeline.gpsBurstActive && shouldBurstPerformance(input)) {
    s.pipeline = { ...s.pipeline, gpsBurstActive: true };
  }
  const continuous = resolveEffectiveGpsMode('save', false, s.pipeline.gpsBurstActive, s.isOffRoute) === 'performance';
  const ms = continuous ? CONTINUOUS_MS : computeGpsIntervalMs(input);

  s.lastIntervalMs = ms;
  s.reason = reasonFor(s, ms, input);
  s.nextFixAt = s.t + ms / 1000;
  s.fixCount += 1;
  s.fixes = [...s.fixes.slice(-(FIX_TRAIL - 1)), { pos: noisy.pos, t: s.t }];
}

/** Start or switch what the hiker is doing. */
export function start(s: Sim, mode: Mode) {
  if (s.arrived && mode === 'auto') Object.assign(s, initialSim());
  if (!s.started) {
    s.started = true;
    takeFix(s);
  }
  if (mode === 'auto') {
    // Walk back to the route first if the hiker has left it, instead of jumping onto it.
    const near = nearestAlong(s.pos);
    if (near.distM > 3) {
      const along = Math.min(TOTAL_M, near.along + REJOIN_AHEAD_M);
      s.goto = pointAlong(along).pos;
      s.resumeAutoAt = along;
      s.mode = 'goto';
      return;
    }
    s.autoDist = near.along;
  }
  if (mode !== 'goto') s.resumeAutoAt = null;
  s.mode = mode;
}

export function pause(s: Sim) {
  s.mode = 'idle';
  s.goto = null;
  s.resumeAutoAt = null;
}

export function walkTo(s: Sim, target: LatLng) {
  s.goto = target;
  s.resumeAutoAt = null;
  start(s, 'goto');
}

export function wrongTurn(s: Sim) {
  start(s, 'manual');
  s.goto = null;
  s.resumeAutoAt = null;
  // Turn to the side that ends farthest from every part of the route (so it
  // clearly counts as off route), among the sides that stay on the map.
  const view = viewBox(MAP_PAD_M);
  const options = [WRONG_TURN_DEG, -WRONG_TURN_DEG].map((d) => {
    const heading = normalizeAngle(s.heading + d);
    const endLatLng = movePosition(s.pos, heading, WRONG_TURN_M);
    const end = toXY(endLatLng);
    const m = WRONG_TURN_EDGE_MARGIN_M;
    const onMap = end.x > view.x + m && end.x < view.x + view.w - m && end.y > view.y + m && end.y < view.y + view.h - m;
    return { heading, onMap, fromRoute: nearestAlong(endLatLng).distM };
  });
  const candidates = options.some((o) => o.onMap) ? options.filter((o) => o.onMap) : options;
  s.wrongHeading = candidates.reduce((a, b) => (b.fromRoute > a.fromRoute ? b : a)).heading;
  s.wrongLeftM = WRONG_TURN_M;
  s.mode = 'wrong';
}

/** Advance by `dtReal` real seconds. `arrowMaxDegPerS` caps how fast the arrow turns on screen. */
export function step(s: Sim, dtReal: number, keys: Keys, arrowMaxDegPerS = ARROW_MAX_DEG_PER_S) {
  if (!s.started) return;
  const dt = dtReal * SIM_SPEED;
  let moving = false;

  if (keys.left) s.heading = normalizeAngle(s.heading - TURN_DEG_PER_REAL_S * dtReal);
  if (keys.right) s.heading = normalizeAngle(s.heading + TURN_DEG_PER_REAL_S * dtReal);

  const turnToward = (want: number) => {
    const diff = normalizeAngle(want - s.heading);
    const maxTurn = TURN_DEG_PER_REAL_S * 1.5 * dtReal;
    s.heading = normalizeAngle(s.heading + Math.max(-maxTurn, Math.min(maxTurn, diff)));
    return diff;
  };

  if (s.mode === 'auto' && !s.arrived) {
    s.autoDist += WALK_MS * dt;
    const p = pointAlong(s.autoDist);
    s.pos = p.pos;
    s.heading = normalizeAngle(s.heading + normalizeAngle(p.heading - s.heading) * Math.min(1, dtReal * 6));
    moving = s.autoDist < TOTAL_M;
    if (!moving) s.arrived = true;
  } else if (s.mode === 'wrong') {
    if (Math.abs(turnToward(s.wrongHeading)) < 30) {
      const stepM = Math.min(s.wrongLeftM, WALK_MS * dt);
      s.pos = movePosition(s.pos, s.heading, stepM);
      s.wrongLeftM -= stepM;
      moving = true;
      if (s.wrongLeftM <= 0) s.mode = 'manual';
    }
  } else if (s.mode === 'goto' && s.goto) {
    const d = haversineDistance(s.pos, s.goto);
    if (d < 2) {
      s.goto = null;
      if (s.resumeAutoAt !== null) {
        s.autoDist = s.resumeAutoAt;
        s.resumeAutoAt = null;
        s.mode = 'auto';
      } else {
        s.mode = 'manual';
      }
    } else if (Math.abs(turnToward(bearing(s.pos, s.goto))) < 60) {
      s.pos = movePosition(s.pos, s.heading, Math.min(d, WALK_MS * dt));
      moving = true;
    }
  } else if (s.mode === 'manual' && keys.fwd) {
    s.pos = movePosition(s.pos, s.heading, WALK_MS * dt);
    moving = true;
  }

  s.moving = moving;
  s.t += dt;
  s.realMs += dtReal * 1000;

  if (s.t >= s.nextFixAt) takeFix(s);
  s.arrow = stepArrowEase(s.arrow, dtReal, s.realMs, arrowMaxDegPerS);
  if (s.arrived && s.mode === 'auto') s.mode = 'idle';
}

/** What the device screen shows: arrow relative to the way you walk, null until it knows that direction. */
export function arrowAngle(s: Sim): number | null {
  return s.pipeline.navState.hasConfidentBearing ? s.arrow.display : null;
}

export function offRouteM(s: Sim): number {
  return s.pipeline.navState.distanceOffRoute;
}
