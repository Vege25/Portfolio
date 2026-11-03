/**
 * Interactive demo of the GPS arrow. The simulation (./sim.ts) runs the full
 * navigation pipeline from the gps repo (./core, copied unchanged) on a real
 * recorded route that has been moved to a fake location.
 *
 * The hiker walks at a normal pace (1.4 m/s) but demo time runs SIM_SPEED
 * times faster, so the GPS intervals (1–12 s) are visible quickly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSegmentTier, type GpsTier } from './core/gpsInterval';
import { movePosition } from './core/geo';
import {
  arrowAngle,
  CONFIG,
  initialSim,
  MAP_PAD_M,
  NAV_ROUTE,
  offRouteM,
  pause,
  SIM_SPEED,
  start,
  step,
  walkTo,
  wrongTurn,
  type Keys,
} from './sim';
import { toLatLng, toXY, viewBox } from './projection';

/** Length of the dashed "arrow direction" line on the map, in metres. */
const ARROW_RAY_M = 30;
/** Map width (m) the marker sizes below were designed for; wider maps scale them up. */
const DESIGN_MAP_W_M = 511;

const TIER_COLOR: Record<GpsTier, string> = {
  fast: 'var(--color-accent)',
  medium: '#c7643a',
  slow: 'var(--color-faint)',
};

export default function GpsDemo() {
  const simRef = useRef(initialSim());
  const keys = useRef<Keys>({ fwd: false, left: false, right: false });
  const [, setFrame] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const visible = useRef(false);

  const vb = useMemo(() => viewBox(MAP_PAD_M), []);
  // Map units are metres, so on a larger route everything drawn would shrink: scale it back.
  const k = vb.w / DESIGN_MAP_W_M;
  const scaleBarM = vb.w > 800 ? 200 : 100;
  const segments = useMemo(
    () =>
      NAV_ROUTE.slice(0, -1).map((p, i) => ({
        a: toXY(p),
        b: toXY(NAV_ROUTE[i + 1]!),
        tier: getSegmentTier(NAV_ROUTE, i, CONFIG.straightIntervalMs),
      })),
    [],
  );
  const grid = useMemo(() => {
    const gridStep = vb.w > 800 ? 100 : 50;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let x = Math.ceil(vb.x / gridStep) * gridStep; x < vb.x + vb.w; x += gridStep) xs.push(x);
    for (let y = Math.ceil(vb.y / gridStep) * gridStep; y < vb.y + vb.h; y += gridStep) ys.push(y);
    return { xs, ys };
  }, [vb]);

  const rerender = () => setFrame((f) => (f + 1) % 1_000_000);

  const begin = useCallback((mode: 'auto' | 'manual') => start(simRef.current, mode), []);

  const reset = useCallback(() => {
    simRef.current = initialSim();
    keys.current = { fwd: false, left: false, right: false };
    rerender();
  }, []);

  // Main loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dtReal = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = simRef.current;
      if (s.started && visible.current) {
        step(s, dtReal, keys.current);
        rerender();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Pause the loop while off screen
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      visible.current = !!e?.isIntersecting;
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Keyboard (only while the demo has focus, so the page still scrolls normally)
  const onKey = useCallback(
    (down: boolean) => (e: React.KeyboardEvent) => {
      const k = keys.current;
      const map: Record<string, keyof Keys> = {
        ArrowUp: 'fwd',
        w: 'fwd',
        W: 'fwd',
        ArrowLeft: 'left',
        a: 'left',
        A: 'left',
        ArrowRight: 'right',
        d: 'right',
        D: 'right',
      };
      const key = map[e.key];
      if (!key) return;
      e.preventDefault();
      k[key] = down;
      if (down) begin('manual');
    },
    [begin],
  );

  const hold = (key: keyof Keys) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      keys.current[key] = true;
      begin('manual');
    },
    onPointerUp: () => {
      keys.current[key] = false;
    },
    onPointerCancel: () => {
      keys.current[key] = false;
    },
    onLostPointerCapture: () => {
      keys.current[key] = false;
    },
  });

  const onMapClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    walkTo(simRef.current, toLatLng(pt.x, pt.y));
    rootRef.current?.focus({ preventScroll: true });
  };

  const s = simRef.current;
  const hiker = toXY(s.pos);
  const goto = s.goto ? toXY(s.goto) : null;
  const hand = arrowAngle(s);
  const offRoute = s.started && s.isOffRoute;
  const nextIn = Math.max(0, s.nextFixAt - s.t);
  const baseline = Math.max(1, Math.floor(s.t) + 1);
  const saved = s.started && s.t > 5 ? Math.round((1 - s.fixCount / baseline) * 100) : null;
  const walkingAuto = s.mode === 'auto' || s.resumeAutoAt !== null;
  // Where the device's arrow points on the map: it's relative to the way you face.
  const ray = hand !== null && s.started && !s.arrived ? toXY(movePosition(s.pos, s.heading + hand, ARROW_RAY_M)) : null;

  let status = 'Press “Walk the route”, then try “Take a wrong turn”.';
  if (s.arrived) status = 'Route done.';
  else if (offRoute) status = `Off route by ${Math.round(offRouteM(s))} m. The arrow points back to the route.`;
  else if (s.mode === 'wrong') status = 'Wrong turn! The arrow reacts at the next GPS checks.';
  else if (s.started && hand === null) status = 'The arrow appears once the GPS sees which way you walk.';
  else if (s.started && hand !== null)
    status = Math.abs(hand) < 12 ? 'On track. Keep going.' : hand > 0 ? 'Route is to the right.' : 'Route is to the left.';

  const btn =
    'inline-flex h-11 items-center justify-center gap-2 rounded-md border border-line-strong bg-bg px-4 text-sm font-medium text-ink transition-colors hover:border-muted active:bg-raised select-none touch-none disabled:opacity-40 disabled:hover:border-line-strong';
  const btnPrimary =
    'inline-flex h-11 items-center justify-center gap-2 rounded-md border border-accent bg-accent px-4 text-sm font-semibold text-bg transition-opacity hover:opacity-90 select-none touch-none';

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKey(true)}
      onKeyUp={onKey(false)}
      onBlur={() => (keys.current = { fwd: false, left: false, right: false })}
      className="rounded-xl border border-line bg-raised outline-none focus-visible:ring-2 focus-visible:ring-accent"
      aria-label="GPS arrow demo. Use the arrow keys to walk and turn."
    >
      <div className="grid gap-0 md:grid-cols-[1fr_17rem]">
        {/* Map */}
        <div className="relative border-b border-line md:border-b-0 md:border-r">
          <WatchDial hand={hand} offRoute={offRoute} className="pointer-events-none absolute left-3 top-3 w-20 md:hidden" />
          <svg
            ref={svgRef}
            viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
            className="block h-auto w-full cursor-crosshair"
            onClick={onMapClick}
            role="img"
            aria-label="Map of the demo route with the hiker's position"
          >
            {grid.xs.map((x) => (
              <line key={`x${x}`} x1={x} y1={vb.y} x2={x} y2={vb.y + vb.h} stroke="var(--color-line)" strokeWidth={0.8 * k} />
            ))}
            {grid.ys.map((y) => (
              <line key={`y${y}`} x1={vb.x} y1={y} x2={vb.x + vb.w} y2={y} stroke="var(--color-line)" strokeWidth={0.8 * k} />
            ))}

            {segments.map((seg, i) => (
              <line
                key={i}
                x1={seg.a.x}
                y1={seg.a.y}
                x2={seg.b.x}
                y2={seg.b.y}
                stroke={TIER_COLOR[seg.tier]}
                strokeWidth={4 * k}
                strokeLinecap="round"
              />
            ))}

            {s.fixes.map((f, i) => {
              const p = toXY(f.pos);
              const age = (s.fixes.length - 1 - i) / s.fixes.length;
              return (
                <circle key={`${f.t}`} cx={p.x} cy={p.y} r={4.5 * k} fill="none" stroke="var(--color-ink)" strokeWidth={1.4 * k} opacity={0.85 - age * 0.75} />
              );
            })}

            {ray && (
              <line
                x1={hiker.x}
                y1={hiker.y}
                x2={ray.x}
                y2={ray.y}
                stroke={offRoute ? 'var(--color-accent)' : 'var(--color-ink)'}
                strokeWidth={1.4 * k}
                strokeDasharray={`${3 * k} ${4 * k}`}
              />
            )}

            {goto && (
              <g transform={`translate(${goto.x} ${goto.y}) scale(${k})`} stroke="var(--color-muted)" strokeWidth={1.5}>
                <line x1={-6} y1={-6} x2={6} y2={6} />
                <line x1={-6} y1={6} x2={6} y2={-6} />
              </g>
            )}

            <g transform={`translate(${hiker.x} ${hiker.y}) rotate(${s.heading}) scale(${k})`}>
              <circle r={13} fill="var(--color-ink)" opacity={0.12} />
              <path d="M0 -10 L7 8 L0 4 L-7 8 Z" fill="var(--color-ink)" />
            </g>

            {/* scale bar */}
            <g transform={`translate(${vb.x + 16 * k} ${vb.y + vb.h - 16 * k})`}>
              <line x1={0} y1={0} x2={scaleBarM} y2={0} stroke="var(--color-muted)" strokeWidth={1.5 * k} />
              <line x1={0} y1={-4 * k} x2={0} y2={0} stroke="var(--color-muted)" strokeWidth={1.5 * k} />
              <line x1={scaleBarM} y1={-4 * k} x2={scaleBarM} y2={0} stroke="var(--color-muted)" strokeWidth={1.5 * k} />
              <text x={scaleBarM / 2} y={-8 * k} textAnchor="middle" fill="var(--color-muted)" fontSize={8 * k} fontFamily="var(--font-mono)">
                {scaleBarM} m
              </text>
            </g>
          </svg>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 font-mono text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 bg-accent" /> GPS every 1 s
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 bg-faint" /> slower checks, up to 12 s
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full border border-ink" /> GPS reading
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 border-t border-dashed border-ink" /> where the arrow points
            </span>
          </div>
          {/* Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-4">
            <div className="flex gap-2">
              <button type="button" className={btn} aria-label="Turn left" {...hold('left')}>
                ↺
              </button>
              <button type="button" className={btn} aria-label="Walk forward" {...hold('fwd')}>
                ↑ Walk
              </button>
              <button type="button" className={btn} aria-label="Turn right" {...hold('right')}>
                ↻
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={walkingAuto ? `${btn} border-accent text-accent` : btnPrimary}
                onClick={() => (walkingAuto ? pause(s) : begin('auto'))}
              >
                {walkingAuto ? 'Pause' : s.arrived ? 'Walk again' : offRoute ? 'Back to the route' : 'Walk the route'}
              </button>
              <button type="button" className={btn} onClick={() => wrongTurn(s)} disabled={s.arrived || s.mode === 'wrong'}>
                Take a wrong turn
              </button>
              <button type="button" className={btn} onClick={reset}>
                Reset
              </button>
            </div>
            <p className="w-full font-mono text-xs text-faint">
              Hold the buttons, or click here and use ← ↑ → / WASD. Tap the map to walk somewhere.
            </p>
          </div>
        </div>

        {/* Watch */}
        <div className="flex flex-col items-center gap-5 p-5 md:p-6">
          <WatchDial hand={hand} offRoute={offRoute} className="hidden w-44 md:block" />

          <p className="text-center text-sm md:min-h-[2.75rem] leading-snug text-ink" aria-live="polite">
            {status}
          </p>

          <dl className="w-full divide-y divide-line border-y border-line font-mono text-xs">
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-muted">Next GPS check</dt>
              <dd className="tabular-nums text-ink">{s.started ? `${nextIn.toFixed(0)} s` : '–'}</dd>
            </div>
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-muted">Why</dt>
              <dd className="text-right text-ink">{s.started ? s.reason : '–'}</dd>
            </div>
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-muted">Checks so far</dt>
              <dd className="tabular-nums text-ink">
                {s.fixCount}
                {saved !== null && saved > 0 && <span className="text-accent"> · {saved}% fewer</span>}
              </dd>
            </div>
          </dl>
          <p className="-mt-2 text-center font-mono text-xs leading-relaxed text-faint">
            Demo time runs {SIM_SPEED}× faster, so a check every 1 s shows up about {SIM_SPEED} times a second. “Fewer” is
            compared with checking every second.
          </p>
        </div>
      </div>
    </div>
  );
}

function WatchDial({ hand, offRoute, className = '' }: { hand: number | null; offRoute: boolean; className?: string }) {
  return (
    <div
      className={`aspect-square rounded-full p-[4.5%] transition-shadow duration-500 ${offRoute ? 'shadow-[0_0_0_2px_var(--color-accent)]' : 'shadow-[0_0_0_1px_var(--color-line-strong)]'} ${className}`}
      style={{ background: '#1b1a17' }}
      aria-hidden="true"
    >
      <div className="relative h-full w-full rounded-full bg-[#0b0b0a]">
        <svg viewBox="0 0 100 100" className="h-full w-full">
          <g style={{ transform: `rotate(${hand ?? 0}deg)`, transformOrigin: '50px 50px' }} opacity={hand === null ? 0.35 : 1}>
            <path d="M50 16 L64 58 L50 50 L36 58 Z" fill={offRoute ? 'var(--color-accent)' : 'var(--color-ink)'} />
          </g>
        </svg>
      </div>
    </div>
  );
}
