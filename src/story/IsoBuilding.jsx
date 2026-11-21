import React, { useMemo } from 'react';
import { model } from '../geometry.js';
import { findRoutes } from '../engine/routing.js';

// A flat isometric drawing of Marlowe House, made from the same building model as the demo.
// Model: x east (0..24 m), y north (0..14 m). Viewer stands south-west; Marlowe St is the lower-right edge.
const K = 12; // px per meter
const GAP = 6.2; // drawn meters between floors once the stack is exploded
const C = Math.cos(Math.PI / 6);
const S = Math.sin(Math.PI / 6);
const L = model.layout;
const W = model.building.footprint_m.w;
const D = model.building.footprint_m.d;
const TARGET = 'f4-apt-4c';

const p = (x, y, z = 0) => [(x - y) * C * K, -(x + y) * S * K - z * K];
const pts = (arr) => arr.map((q) => q.map((n) => n.toFixed(1)).join(',')).join(' ');
const rect = ([x0, y0, x1, y1], z = 0) => pts([p(x0, y0, z), p(x1, y0, z), p(x1, y1, z), p(x0, y1, z)]);
const zOf = (floor) => (floor - 1) * GAP;
const center = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

const ROUTES = findRoutes(model, TARGET, []).routes;
const pick = (entrance, firstStair, rides) =>
  ROUTES.find((r) => r.entrance_id === entrance && r.verticals[0].id === firstStair && r.verticals.length === rides);
export const ROUTE_144 = pick('ent-144', 'stair-b', 1);
export const ROUTE_142 = pick('ent-142', 'stair-a', 1);
export const ROUTE_ALLEY = pick('ent-alley', 'stair-c', 1);
export const ROUTE_CROSS = pick('ent-144', 'stair-b', 2);

const verticalById = new Map(L.verticals.map((v) => [v.id, v]));

function routePath(route) {
  const lift = 0.25;
  const out = [];
  const rides = [...route.verticals];
  const q = route.points;
  out.push(p(q[0].x, q[0].y, zOf(q[0].floor) + lift));
  for (let i = 1; i < q.length; i++) {
    const a = q[i - 1];
    const b = q[i];
    if (a.floor !== b.floor) {
      const v = verticalById.get(rides.shift()?.id);
      const sa = v.stops.find((s) => s.floor === a.floor);
      const sb = v.stops.find((s) => s.floor === b.floor);
      const [ax, ay] = center(sa.bbox_m);
      const [bx, by] = center(sb.bbox_m);
      out.push(p(ax, ay, zOf(a.floor) + lift));
      out.push(p(bx, by, zOf(b.floor) + lift));
    }
    out.push(p(b.x, b.y, zOf(b.floor) + lift));
  }
  const t = L.spaces.find((s) => s.id === TARGET);
  const [tx, ty] = center(t.bbox_m);
  out.push(p(tx, ty, zOf(4) + lift));
  return 'M' + out.map((q2) => q2.map((n) => n.toFixed(1)).join(' ')).join(' L');
}

const PATHS = {
  r144: routePath(ROUTE_144),
  r142: routePath(ROUTE_142),
  alley: routePath(ROUTE_ALLEY),
  cross: routePath(ROUTE_CROSS),
};

// Bounds of the exploded drawing, plus room for labels.
const minX = p(0, D)[0] - 70;
const maxX = p(W, 0)[0] + 70;
const minY = p(W, D, zOf(5) + 1)[1] - 40;
const maxY = p(0, 0)[1] + 46;

function Label({ at, text, sub, tone = 'ink', anchor = 'middle', dy = 0 }) {
  const [x, y] = at;
  return (
    <g className={`iso-label tone-${tone}`} transform={`translate(${x.toFixed(1)} ${(y + dy).toFixed(1)})`}>
      <text textAnchor={anchor}>{text}</text>
      {sub && (
        <text className="sub" textAnchor={anchor} y={12}>
          {sub}
        </text>
      )}
    </g>
  );
}

/**
 * stage: 0 = sheets flat (collapsed stack), 1 = floors extruded, 2 = front routes,
 *        3 = shared lobby called out, 4 = rear route via Stair C.
 */
export default function IsoBuilding({ stage = 1 }) {
  const extruded = stage >= 1;
  const floors = useMemo(() => [...L.floors].sort((a, b) => a.floor - b.floor), []);
  const lobby = L.spaces.find((s) => s.id === 'f4-east-lobby');
  const target = L.spaces.find((s) => s.id === TARGET);
  const [lx, ly] = center(lobby.bbox_m);
  const [tx, ty] = center(target.bbox_m);
  const stairs = L.verticals.filter((v) => v.kind === 'stair');
  const doorC = L.openings.find((o) => o.id === 'door-f4-stair-c');
  const ent = Object.fromEntries(L.entrances.map((e) => [e.id, e]));

  return (
    <svg
      className={`iso stage-${stage}`}
      viewBox={`${minX.toFixed(0)} ${minY.toFixed(0)} ${(maxX - minX).toFixed(0)} ${(maxY - minY).toFixed(0)}`}
      role="img"
      aria-label="Isometric drawing of Marlowe House, five floors stacked apart, with routes from the entrances to apartment 4C"
    >
      <defs>
        <pattern id="iso-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" stroke="#5d5a55" strokeWidth="0.8" />
        </pattern>
      </defs>

      {floors.map((f) => {
        const lift = extruded ? zOf(f.floor) * K : 0;
        const spaces = L.spaces.filter((s) => s.floor === f.floor);
        return (
          <g
            key={f.floor}
            className={`iso-floor f${f.floor} ${stage >= 2 && f.floor !== 1 && f.floor !== 4 ? 'dim' : ''}`}
            style={{ transform: `translateY(${-lift}px)`, transitionDelay: `${(f.floor - 1) * 90}ms` }}
          >
            <polygon className="plate" points={rect([0, 0, W, D])} />
            {spaces.map((s) => (
              <polygon
                key={s.id}
                points={rect(s.bbox_m)}
                className={`room ${s.id === TARGET ? 'target' : ''} ${s.type === 'apartment' ? 'apt' : ''} ${
                  s.id === 'f4-east-lobby' && stage >= 3 ? 'shared' : ''
                }`}
              />
            ))}
            {stairs.map((v) => {
              const st = v.stops.find((x) => x.floor === f.floor);
              return st ? <polygon key={v.id} className="stair-landing" points={rect(st.bbox_m)} /> : null;
            })}
            <text className="floor-no" x={p(0, D)[0] - 14} y={p(0, D)[1] + 4} textAnchor="end">
              F{f.floor}
            </text>
          </g>
        );
      })}

      {/* stair shafts, drawn once the stack is apart */}
      <g className="shafts">
        {stairs.map((v) => {
          const b = v.stops[0].bbox_m;
          const corners = [
            [b[0], b[1]],
            [b[2], b[1]],
            [b[2], b[3]],
            [b[0], b[3]],
          ];
          return corners.map(([x, y], i) => {
            const [x0, y0] = p(x, y, 0);
            const [, y1] = p(x, y, zOf(5));
            return <line key={v.id + i} x1={x0} y1={y0} x2={x0} y2={y1} className="shaft-line" />;
          });
        })}
      </g>

      {/* routes */}
      <path className="route r-front" d={PATHS.r144} pathLength="1" data-on={stage >= 2} />
      <path className="route r-front delay" d={PATHS.r142} pathLength="1" data-on={stage >= 2} />
      <path className="route r-rear" d={PATHS.alley} pathLength="1" data-on={stage >= 4} />
      <path className="route r-cross delay" d={PATHS.cross} pathLength="1" data-on={stage >= 4} />

      {/* labels */}
      <g className="labels" data-on={extruded}>
        <Label at={p(tx, ty, zOf(4) + 0.9)} text="4C" tone="target" />
        <Label at={p(ent['ent-142'].pos_m[0], -1.6, 0)} text="142" sub="Stair A" dy={14} />
        <Label at={p(ent['ent-144'].pos_m[0], -1.6, 0)} text="144" sub="Stair B" dy={14} />
        <Label at={p(11.5, 12, zOf(5) + 3)} text="STAIR A / B" sub="scissor stairs, one shaft" />
        <Label at={p(22.75, 12, zOf(5) + 3)} text="STAIR C" sub="rear" />
      </g>
      <g className="labels" data-on={stage >= 3}>
        <Label at={p(lx, ly, zOf(4) + 1)} text="EAST LOBBY" sub="both front stairs open here" tone="shared" anchor="end" dy={-4} />
      </g>
      <g className="labels" data-on={stage >= 4}>
        <Label at={p(18, 7, zOf(3) + 0.6)} text="floor-3 crossover" tone="muted" anchor="start" dy={18} />
        <circle className="gate-mark" cx={p(22.75, 14, 0.25)[0]} cy={p(22.75, 14, 0.25)[1]} r="5" />
        <Label at={p(ent['ent-alley'].pos_m[0] + 1.2, D + 1.5, 0)} text="ALLEY GATE" sub="access unconfirmed" tone="amber" anchor="start" />
        <Label at={p(doorC.pos_m[0] + 1.6, doorC.pos_m[1], zOf(4) + 0.6)} text="“F.D. — see note 7”" sub="note 7 is missing" tone="amber" anchor="start" />
      </g>
    </svg>
  );
}
