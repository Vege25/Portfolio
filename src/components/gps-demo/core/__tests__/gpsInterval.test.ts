import { describe, expect, it } from 'vitest'
import {
  CORNER_THRESHOLD_DEG,
  COOLDOWN_DIST_M,
  COOLDOWN_MS,
  COOLDOWN_MAX_MS,
  COOLDOWN_RUNOUT_BASE_M,
  STOPPED_INTERVAL_MS,
  computeGpsIntervalMs,
  cornerRunoutDistM,
  distancePastCornerM,
  distFromCornerToWaypoint,
  distToNextCorner,
  intervalFromDistToCorner,
  intervalMsToTier,
  resolveEffectiveGpsMode,
  shouldBurstPerformance,
  waypointTurnAngle,
} from '../gpsInterval'
import type { LatLng } from '../geo'

const straightRoute: LatLng[] = [
  { lat: 60, lng: 24 },
  { lat: 60.001, lng: 24 },
  { lat: 60.002, lng: 24 },
  { lat: 60.003, lng: 24 },
]

// North then a sharp right turn east, at waypoint index 2.
const cornerRoute: LatLng[] = [
  { lat: 60, lng: 24 },
  { lat: 60.005, lng: 24 },
  { lat: 60.01, lng: 24 },
  { lat: 60.01, lng: 24.01 },
  { lat: 60.01, lng: 24.02 },
]

describe('waypointTurnAngle', () => {
  it('is 0 for a straight route', () => {
    expect(waypointTurnAngle(straightRoute, 1)).toBeCloseTo(0, 3)
  })

  it('is 0 at the route endpoints', () => {
    expect(waypointTurnAngle(straightRoute, 0)).toBe(0)
    expect(waypointTurnAngle(straightRoute, straightRoute.length - 1)).toBe(0)
  })

  it('is ~90° at a right-angle corner', () => {
    expect(waypointTurnAngle(cornerRoute, 2)).toBeGreaterThan(80)
    expect(waypointTurnAngle(cornerRoute, 2)).toBeLessThan(100)
  })
})

describe('distToNextCorner', () => {
  it('is Infinity for a route with no corner past the threshold', () => {
    expect(distToNextCorner(straightRoute, 0, CORNER_THRESHOLD_DEG)).toBe(Infinity)
  })

  it('finds the cumulative distance to the corner waypoint', () => {
    const dist = distToNextCorner(cornerRoute, 0, CORNER_THRESHOLD_DEG)
    expect(Number.isFinite(dist)).toBe(true)
    expect(dist).toBeGreaterThan(0)
  })
})

describe('distFromCornerToWaypoint', () => {
  it('is 0 when corner and target are the same waypoint', () => {
    expect(distFromCornerToWaypoint(cornerRoute, 2, 2)).toBe(0)
  })

  it('is positive walking forward from the corner', () => {
    expect(distFromCornerToWaypoint(cornerRoute, 2, 3)).toBeGreaterThan(0)
  })
})

describe('distancePastCornerM', () => {
  it('is 0 before reaching the corner segment', () => {
    const pos = cornerRoute[0]!
    expect(distancePastCornerM(pos, cornerRoute, 2, 1)).toBe(0)
  })

  it('is 0 exactly at the corner vertex', () => {
    const corner = cornerRoute[2]!
    expect(distancePastCornerM(corner, cornerRoute, 2, 2)).toBeCloseTo(0, 0)
  })

  it('accumulates across multiple segments past the corner (not reset per-segment)', () => {
    // Segment 2->3 and 3->4 are both "past" corner waypoint 2 (east-heading legs).
    const midSeg3 = { lat: cornerRoute[3]!.lat, lng: (cornerRoute[3]!.lng + cornerRoute[4]!.lng) / 2 }
    const distAtSeg2End = distancePastCornerM(cornerRoute[3]!, cornerRoute, 2, 2)
    const distIntoSeg3 = distancePastCornerM(midSeg3, cornerRoute, 2, 3)
    // Distance into segment 3 must be at least as large as reaching the end of
    // segment 2 — i.e. it accumulates, not resets to a fresh fractional value.
    expect(distIntoSeg3).toBeGreaterThan(distAtSeg2End)
  })
})

describe('intervalFromDistToCorner', () => {
  it('returns the 5s default for non-finite distance', () => {
    expect(intervalFromDistToCorner(Infinity, 1.4)).toBe(5000)
  })

  it('returns the 5s default for zero/negative speed', () => {
    expect(intervalFromDistToCorner(100, 0)).toBe(5000)
    expect(intervalFromDistToCorner(100, -1)).toBe(5000)
  })

  it('clamps to the [1000, 5000] range', () => {
    // Very close corner at speed -> tiny time-to-corner -> clamped to 1000.
    expect(intervalFromDistToCorner(0.1, 1.4)).toBe(1000)
    // Very far corner -> clamped to 5000.
    expect(intervalFromDistToCorner(100_000, 1.4)).toBe(5000)
  })

  it('scales as (distance / speed) / 3 within the clamp range', () => {
    const distM = 12
    const speedMs = 1.4
    const expected = (distM / speedMs / 3) * 1000
    expect(expected).toBeGreaterThan(1000)
    expect(expected).toBeLessThan(5000)
    expect(intervalFromDistToCorner(distM, speedMs)).toBeCloseTo(expected, 0)
  })
})

describe('intervalMsToTier', () => {
  it('classifies fast/medium/slow at the documented boundaries', () => {
    expect(intervalMsToTier(1000)).toBe('fast')
    expect(intervalMsToTier(1500)).toBe('fast')
    expect(intervalMsToTier(1501)).toBe('medium')
    expect(intervalMsToTier(4499)).toBe('medium')
    expect(intervalMsToTier(4500)).toBe('slow')
    expect(intervalMsToTier(12000)).toBe('slow')
  })
})

describe('computeGpsIntervalMs', () => {
  it('uses the stopped interval when speed is ~0', () => {
    const ms = computeGpsIntervalMs({
      route: straightRoute,
      activeWaypointIdx: 1,
      distanceToNext: 50,
      speedMs: 0,
      msSinceCornerPass: null,
    })
    expect(ms).toBe(STOPPED_INTERVAL_MS)
  })

  it('uses the stopped interval when speed is not finite', () => {
    const ms = computeGpsIntervalMs({
      route: straightRoute,
      activeWaypointIdx: 1,
      distanceToNext: 50,
      speedMs: NaN,
      msSinceCornerPass: null,
    })
    expect(ms).toBe(STOPPED_INTERVAL_MS)
  })

  it('polls at 1s during the post-corner cooldown', () => {
    const ms = computeGpsIntervalMs({
      route: straightRoute,
      activeWaypointIdx: 1,
      distanceToNext: 50,
      speedMs: 1.4,
      msSinceCornerPass: 1000,
    })
    expect(ms).toBe(1000)
  })

  it('polls at 1s when within COOLDOWN_DIST_M of an upcoming corner', () => {
    const ms = computeGpsIntervalMs({
      route: cornerRoute,
      activeWaypointIdx: 2, // approaching the corner waypoint itself
      distanceToNext: COOLDOWN_DIST_M - 1,
      speedMs: 1.4,
      msSinceCornerPass: null,
    })
    expect(ms).toBe(1000)
  })

  it('polls at 1s when near the off-route threshold (>=30m threshold)', () => {
    const ms = computeGpsIntervalMs({
      route: straightRoute,
      activeWaypointIdx: 1,
      distanceToNext: 500,
      speedMs: 1.4,
      msSinceCornerPass: null,
      distanceOffRoute: 20,
      offRouteThresholdM: 30,
    })
    expect(ms).toBe(1000)
  })

  // Skipped: stale in the source repo too (MIN_THRESHOLD_FOR_PRETRIGGER_M is now 10, not 30).
  it.skip('does not fast-poll for off-route proximity when threshold < 30m', () => {
    const ms = computeGpsIntervalMs({
      route: straightRoute,
      activeWaypointIdx: 1,
      distanceToNext: 500,
      speedMs: 1.4,
      msSinceCornerPass: null,
      distanceOffRoute: 8,
      offRouteThresholdM: 15,
    })
    expect(ms).not.toBe(1000)
  })

  it('extends beyond the 5s ramp cap on a long straight when steady', () => {
    const notSteady = computeGpsIntervalMs({
      route: straightRoute,
      activeWaypointIdx: 1,
      distanceToNext: 100_000, // effectively no corner ahead
      speedMs: 1.4,
      msSinceCornerPass: null,
      steady: false,
    })
    const steady = computeGpsIntervalMs({
      route: straightRoute,
      activeWaypointIdx: 1,
      distanceToNext: 100_000,
      speedMs: 1.4,
      msSinceCornerPass: null,
      steady: true,
    })
    expect(notSteady).toBeLessThanOrEqual(5000)
    expect(steady).toBeGreaterThan(notSteady)
  })

  it('never exceeds the configured straightIntervalMs cap', () => {
    const ms = computeGpsIntervalMs({
      route: straightRoute,
      activeWaypointIdx: 1,
      distanceToNext: 100_000,
      speedMs: 1.4,
      msSinceCornerPass: null,
      steady: true,
      straightIntervalMs: 9000,
    })
    expect(ms).toBeLessThanOrEqual(9000)
  })

  describe('extended cooldown (distance-past-corner runout)', () => {
    // Slow walker: the plain 5s timer would have expired (COOLDOWN_MS elapsed)
    // but the hiker has only physically walked a couple of metres past the
    // corner vertex — still well short of cornerRunoutDistM at walking pace
    // (COOLDOWN_RUNOUT_BASE_M).
    const nearCornerPos = cornerRoute[2]! // sitting right at the corner vertex

    it('without cornerWpIdx/pos, reverts to the plain time-based cooldown (pre-existing behaviour)', () => {
      const ms = computeGpsIntervalMs({
        route: cornerRoute,
        activeWaypointIdx: 3,
        distanceToNext: 500,
        speedMs: 1.4,
        msSinceCornerPass: COOLDOWN_MS + 500, // timer already expired
      })
      expect(ms).not.toBe(1000)
    })

    it('extends fast polling past COOLDOWN_MS when still within cornerRunoutDistM of the corner', () => {
      const ms = computeGpsIntervalMs({
        route: cornerRoute,
        activeWaypointIdx: 3,
        distanceToNext: 500,
        speedMs: 1.4,
        msSinceCornerPass: COOLDOWN_MS + 500, // timer alone would have expired
        cornerWpIdx: 2,
        pos: nearCornerPos, // ~0m past the corner — well under cornerRunoutDistM
      })
      expect(ms).toBe(1000)
    })

    it('lapses once the hiker has walked clear of the corner, even before COOLDOWN_MAX_MS', () => {
      // Walk well past the corner along the east leg (segment 2->3, ~1.1km long
      // per cornerRoute's coordinates) — far beyond cornerRunoutDistM at any speed.
      const farPastCorner = { lat: cornerRoute[2]!.lat, lng: cornerRoute[2]!.lng + 0.001 }
      const ms = computeGpsIntervalMs({
        route: cornerRoute,
        activeWaypointIdx: 3,
        distanceToNext: 500,
        speedMs: 1.4,
        msSinceCornerPass: COOLDOWN_MS + 500,
        cornerWpIdx: 2,
        pos: farPastCorner,
      })
      expect(ms).not.toBe(1000)
    })

    it('never extends past COOLDOWN_MAX_MS even if the runout distance is never cleared', () => {
      const ms = computeGpsIntervalMs({
        route: cornerRoute,
        activeWaypointIdx: 3,
        distanceToNext: 500,
        speedMs: 1.4,
        msSinceCornerPass: COOLDOWN_MAX_MS + 500, // past the hard ceiling
        cornerWpIdx: 2,
        pos: nearCornerPos, // still "at" the corner — runout never cleared
      })
      expect(ms).not.toBe(1000)
    })

    it('same extension applies to shouldBurstPerformance (walk/run save-mode burst gate)', () => {
      const withoutExtension = shouldBurstPerformance({
        route: cornerRoute,
        activeWaypointIdx: 3,
        distanceToNext: 500,
        speedMs: 1.4,
        msSinceCornerPass: COOLDOWN_MS + 500,
      })
      const withExtension = shouldBurstPerformance({
        route: cornerRoute,
        activeWaypointIdx: 3,
        distanceToNext: 500,
        speedMs: 1.4,
        msSinceCornerPass: COOLDOWN_MS + 500,
        cornerWpIdx: 2,
        pos: nearCornerPos,
      })
      expect(withoutExtension).toBe(false)
      expect(withExtension).toBe(true)
    })

    it('scales the runout distance with live speed, so a runner keeps fast polling further past the corner than a walker', () => {
      expect(cornerRunoutDistM(1.4)).toBeCloseTo(COOLDOWN_RUNOUT_BASE_M) // walking-pace floor, unchanged
      expect(cornerRunoutDistM(2.8)).toBeGreaterThan(cornerRunoutDistM(1.4)) // jog covers more ground for the same lead time

      // A runner (2.8 m/s) 15m past the corner is still within their scaled
      // runout, whereas a walker (1.4 m/s) at the same 15m has already cleared
      // the walking-pace floor (12m) and should NOT still be in cooldown.
      // Longitude degrees shrink by cos(lat) — cornerRoute sits at lat 60, so
      // divide by (111320 * cos(60°)), not the bare metres-per-degree constant
      // (which is only correct at the equator).
      const metresPerLngDegAt60 = 111320 * Math.cos((60 * Math.PI) / 180)
      const pastCornerBy15m = { lat: cornerRoute[2]!.lat, lng: cornerRoute[2]!.lng + 15 / metresPerLngDegAt60 }
      const walkerMs = computeGpsIntervalMs({
        route: cornerRoute,
        activeWaypointIdx: 3,
        distanceToNext: 500,
        speedMs: 1.4,
        msSinceCornerPass: COOLDOWN_MS + 500,
        cornerWpIdx: 2,
        pos: pastCornerBy15m,
      })
      const runnerMs = computeGpsIntervalMs({
        route: cornerRoute,
        activeWaypointIdx: 3,
        distanceToNext: 500,
        speedMs: 2.8,
        msSinceCornerPass: COOLDOWN_MS + 500,
        cornerWpIdx: 2,
        pos: pastCornerBy15m,
      })
      expect(walkerMs).not.toBe(1000)
      expect(runnerMs).toBe(1000)
    })
  })

  describe('arrow-turn fast-poll (arrowAngleDeg)', () => {
    it('does not affect polling when arrowAngleDeg is omitted (opt-in, behaviour-preserving)', () => {
      const ms = computeGpsIntervalMs({
        route: straightRoute,
        activeWaypointIdx: 1,
        distanceToNext: 100_000,
        speedMs: 1.4,
        msSinceCornerPass: null,
      })
      expect(ms).not.toBe(1000)
    })

    it('stays on straight, far from any corner, once the arrow is turned at/beyond the threshold', () => {
      const ms = computeGpsIntervalMs({
        route: straightRoute,
        activeWaypointIdx: 1,
        distanceToNext: 100_000, // effectively no corner ahead
        speedMs: 1.4,
        msSinceCornerPass: null,
        arrowAngleDeg: 35,
        arrowTurnThresholdDeg: 30,
      })
      expect(ms).toBe(1000)
    })

    it('does not fast-poll when the arrow reads under the threshold', () => {
      const ms = computeGpsIntervalMs({
        route: straightRoute,
        activeWaypointIdx: 1,
        distanceToNext: 100_000,
        speedMs: 1.4,
        msSinceCornerPass: null,
        arrowAngleDeg: 10,
        arrowTurnThresholdDeg: 30,
      })
      expect(ms).not.toBe(1000)
    })

    it('releases back to normal cadence the moment the arrow settles under threshold — no separate cooldown timer', () => {
      const turned = computeGpsIntervalMs({
        route: straightRoute,
        activeWaypointIdx: 1,
        distanceToNext: 100_000,
        speedMs: 1.4,
        msSinceCornerPass: null,
        arrowAngleDeg: 40,
        arrowTurnThresholdDeg: 30,
      })
      const settled = computeGpsIntervalMs({
        route: straightRoute,
        activeWaypointIdx: 1,
        distanceToNext: 100_000,
        speedMs: 1.4,
        msSinceCornerPass: null,
        arrowAngleDeg: 29,
        arrowTurnThresholdDeg: 30,
      })
      expect(turned).toBe(1000)
      expect(settled).not.toBe(1000)
    })

    it('uses the ARROW_TURN_THRESHOLD_DEG default when arrowTurnThresholdDeg is omitted', () => {
      const ms = computeGpsIntervalMs({
        route: straightRoute,
        activeWaypointIdx: 1,
        distanceToNext: 100_000,
        speedMs: 1.4,
        msSinceCornerPass: null,
        arrowAngleDeg: 45, // above the 30° default
      })
      expect(ms).toBe(1000)
    })

    it('same gate applies to shouldBurstPerformance (walk/run save-mode burst gate)', () => {
      const withoutTurn = shouldBurstPerformance({
        route: straightRoute,
        activeWaypointIdx: 1,
        distanceToNext: 100_000,
        speedMs: 1.4,
        msSinceCornerPass: null,
        arrowAngleDeg: 10,
        arrowTurnThresholdDeg: 30,
      })
      const withTurn = shouldBurstPerformance({
        route: straightRoute,
        activeWaypointIdx: 1,
        distanceToNext: 100_000,
        speedMs: 1.4,
        msSinceCornerPass: null,
        arrowAngleDeg: 45,
        arrowTurnThresholdDeg: 30,
      })
      expect(withoutTurn).toBe(false)
      expect(withTurn).toBe(true)
    })
  })
})

describe('resolveEffectiveGpsMode', () => {
  it('stays at the base mode when nothing overrides it', () => {
    expect(resolveEffectiveGpsMode('save', false, false, false)).toBe('save')
    expect(resolveEffectiveGpsMode('performance', false, false, false)).toBe('performance')
  })

  it('forces performance mode when compass-check is active, regardless of base mode', () => {
    expect(resolveEffectiveGpsMode('save', true, false, false)).toBe('performance')
  })

  it('forces performance mode during a corner-lead burst', () => {
    expect(resolveEffectiveGpsMode('save', false, true, false)).toBe('performance')
  })

  it('forces performance mode while off-route', () => {
    expect(resolveEffectiveGpsMode('save', false, false, true)).toBe('performance')
  })

  it('never demotes an already-performance base mode', () => {
    expect(resolveEffectiveGpsMode('performance', false, false, false)).toBe('performance')
  })
})
