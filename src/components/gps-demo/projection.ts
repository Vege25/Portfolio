import type { LatLng } from './core/types';
import routeData from './route.json';

export const ROUTE: LatLng[] = routeData.points;
export const ROUTE_LENGTH_M: number = routeData.lengthM;

const R = 6_371_000;
const RAD = Math.PI / 180;

const lat0 = ROUTE.reduce((s, p) => s + p.lat, 0) / ROUTE.length;
const lng0 = ROUTE.reduce((s, p) => s + p.lng, 0) / ROUTE.length;
const cosLat0 = Math.cos(lat0 * RAD);

/** Local flat metres around the route centre. x = east, y = SOUTH (screen space). */
export function toXY(p: LatLng): { x: number; y: number } {
  return {
    x: (p.lng - lng0) * RAD * R * cosLat0,
    y: -(p.lat - lat0) * RAD * R,
  };
}

export function toLatLng(x: number, y: number): LatLng {
  return {
    lat: lat0 + -y / (RAD * R),
    lng: lng0 + x / (RAD * R * cosLat0),
  };
}

const xy = ROUTE.map(toXY);
const minX = Math.min(...xy.map((p) => p.x));
const maxX = Math.max(...xy.map((p) => p.x));
const minY = Math.min(...xy.map((p) => p.y));
const maxY = Math.max(...xy.map((p) => p.y));

/** Padded view box (metres) that fits the whole route */
export function viewBox(pad = 60) {
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

export function routePath(): string {
  return xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}
