// Model-to-scene coordinates. Model: x east (0..24), y north (0..14), meters.
// Scene: X = x - 12, Z = -(y - 7), Y = floor elevation (scaled when exploded).
import model from './data/marlowe.json';

export const W = model.building.footprint_m.w;
export const D = model.building.footprint_m.d;
export const FLOOR_GAP = 3;
export const EXPLODED_GAP = 7.5;

export const floorY = (floor, explodedOrGap) => {
  const gap = typeof explodedOrGap === 'number' ? explodedOrGap : explodedOrGap ? EXPLODED_GAP : FLOOR_GAP;
  return (floor - 1) * gap;
};
export const toScene = (x, y, floor, explodedOrGap, lift = 0) => [
  x - W / 2,
  floorY(floor, explodedOrGap) + lift,
  -(y - D / 2),
];

const L = model.layout;
export const spaceById = new Map(L.spaces.map((s) => [s.id, s]));
export const openingById = new Map(L.openings.map((o) => [o.id, o]));
export const verticalById = new Map(L.verticals.map((v) => [v.id, v]));
export const entranceById = new Map(L.entrances.map((e) => [e.id, e]));

export function elementOf(id) {
  const base = id.split('@')[0];
  return spaceById.get(base) ?? openingById.get(base) ?? verticalById.get(base) ?? entranceById.get(base) ?? null;
}

const center = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

// Model-space anchor {x, y, floor, w, d} for any element id (landings as "stair-c@4").
export function anchorOf(id) {
  const [base, f] = id.split('@');
  if (spaceById.has(base)) {
    const s = spaceById.get(base);
    const [x, y] = center(s.bbox_m);
    return { x, y, floor: s.floor, w: s.bbox_m[2] - s.bbox_m[0], d: s.bbox_m[3] - s.bbox_m[1] };
  }
  if (openingById.has(base)) {
    const o = openingById.get(base);
    return { x: o.pos_m[0], y: o.pos_m[1], floor: o.floor, w: 1.1, d: 1.1 };
  }
  if (entranceById.has(base)) {
    const e = entranceById.get(base);
    return { x: e.pos_m[0], y: e.pos_m[1], floor: e.floor, w: 1.4, d: 1.4 };
  }
  if (verticalById.has(base)) {
    const v = verticalById.get(base);
    const floor = f ? Number(f) : 4;
    const stop = v.stops.find((s) => s.floor === floor) ?? v.stops[0];
    const [x, y] = center(stop.bbox_m);
    return { x, y, floor, w: stop.bbox_m[2] - stop.bbox_m[0], d: stop.bbox_m[3] - stop.bbox_m[1] };
  }
  return null;
}

// Polyline (scene coords) for a route from the engine.
export function routePolyline(route, target, exploded) {
  const lift = 0.35;
  const pts = [];
  const rides = [...route.verticals];
  const p = route.points;
  pts.push(toScene(p[0].x, p[0].y, p[0].floor, exploded, lift));
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1];
    const b = p[i];
    if (a.floor !== b.floor) {
      const ride = rides.shift();
      const v = ride && verticalById.get(ride.id);
      if (v) {
        const sa = v.stops.find((s) => s.floor === a.floor) ?? v.stops[0];
        const sb = v.stops.find((s) => s.floor === b.floor) ?? v.stops[0];
        const [ax, ay] = center(sa.bbox_m);
        const [bx, by] = center(sb.bbox_m);
        pts.push(toScene(ax, ay, a.floor, exploded, lift));
        pts.push(toScene(bx, by, b.floor, exploded, lift));
      }
    }
    pts.push(toScene(b.x, b.y, b.floor, exploded, lift));
  }
  const t = anchorOf(target);
  pts.push(toScene(t.x, t.y, t.floor, exploded, lift));
  return pts;
}

export { model };
