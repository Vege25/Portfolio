/**
 * Shared geometry for the arrow dial, used by the Astro ArrowDial and the
 * React demo so every arrow on the site looks the same.
 *
 * The arrow is the one the device draws (gps repo, firmware/esp32_display/
 * main/arrow_view.c): a head from (70,8) to (110,65)/(30,65) and a 20-wide
 * shaft down to y=110, in a 140×140 box rotated about its centre. Here it is
 * scaled into a 200×200 dial centred on 100,100.
 */
const SCALE = 0.85;
const pt = (x: number, y: number) => `${100 + (x - 70) * SCALE} ${100 + (y - 70) * SCALE}`;

export const ARROW_PATH = `M${pt(70, 8)} L${pt(110, 65)} L${pt(80, 65)} L${pt(80, 110)} L${pt(60, 110)} L${pt(60, 65)} L${pt(30, 65)} Z`;

export interface Tick {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  major: boolean;
}

/** 60 ticks round the bezel, longer every 5 and longest every 15. */
export const DIAL_TICKS: Tick[] = Array.from({ length: 60 }, (_, i) => {
  const major = i % 15 === 0;
  const a = (i / 60) * Math.PI * 2;
  const r1 = 96 - (major ? 9 : i % 5 === 0 ? 6 : 3);
  const r2 = 93;
  return {
    x1: 100 + Math.sin(a) * r1,
    y1: 100 - Math.cos(a) * r1,
    x2: 100 + Math.sin(a) * r2,
    y2: 100 - Math.cos(a) * r2,
    major,
  };
});
