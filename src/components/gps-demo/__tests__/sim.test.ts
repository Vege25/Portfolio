import { describe, expect, it } from 'vitest';
import { arrowAngle, initialSim, offRouteM, SIM_SPEED, start, step, wrongTurn, type Sim } from '../sim';

// The demo has to show the product's story through the real navigation pipeline:
// arrow up while following the route, GPS checks spread out on straights, and the
// arrow swinging back after a wrong turn.

const keys = { fwd: false, left: false, right: false };
const FRAME_S = 1 / 60;

function run(s: Sim, realSeconds: number, each?: (s: Sim) => void) {
  for (let i = 0; i < realSeconds * 60; i++) {
    step(s, FRAME_S, keys);
    each?.(s);
  }
}

describe('GPS arrow demo simulation', () => {
  it('walks the whole route on track, polling GPS sparingly with 12 s checks on straights', () => {
    const s = initialSim();
    start(s, 'auto');
    const intervals: number[] = [];
    let seen = s.fixCount;
    let wentOffRoute = false;
    while (!s.arrived && s.t < 3000) {
      run(s, 1, (x) => {
        if (x.fixCount !== seen) {
          seen = x.fixCount;
          intervals.push(x.lastIntervalMs);
        }
        if (x.isOffRoute) wentOffRoute = true;
      });
    }
    expect(s.arrived).toBe(true);
    expect(wentOffRoute).toBe(false);
    // Far fewer checks than once a second.
    expect(s.fixCount / s.t).toBeLessThan(0.35);
    // The long-straight 12 s interval really happens, and so does 1 s near corners.
    expect(intervals.some((ms) => ms >= 12000)).toBe(true);
    expect(intervals.some((ms) => ms <= 1000)).toBe(true);
  });

  it('a wrong turn takes the hiker off route and the arrow swings back toward it', () => {
    const s = initialSim();
    start(s, 'auto');
    run(s, 120 / SIM_SPEED + 15);
    wrongTurn(s);
    run(s, 8);
    expect(s.isOffRoute).toBe(true);
    expect(offRouteM(s)).toBeGreaterThan(25);
    expect(Math.abs(arrowAngle(s)!)).toBeGreaterThan(120);
    expect(s.lastIntervalMs).toBe(1000); // GPS stays on while off route

    start(s, 'auto'); // "Back to the route"
    run(s, 10);
    expect(s.isOffRoute).toBe(false);
    expect(s.mode).toBe('auto');
    expect(Math.abs(arrowAngle(s)!)).toBeLessThan(30);
  });
});
