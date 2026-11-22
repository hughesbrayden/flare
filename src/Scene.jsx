import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera, OrbitControls, Edges, Line, Html } from '@react-three/drei';
import * as THREE from 'three';
import gsap from 'gsap';
import {
  model,
  toScene,
  floorY,
  anchorOf,
  routePolyline,
  verticalById,
  W,
  D,
  FLOOR_GAP,
  EXPLODED_GAP,
} from './geometry.js';
import { ElevatorExcludedIcon, EntranceIcon, ReportPinIcon, StairIcon } from './NfpaSymbols.jsx';

// Option B palette: white paper, ink edges, signal red for routes, ochre for unverified, gray for closed.
export const INK = '#111111';
export const GRAPHITE = '#6b6b6b';
export const GRAPHITE_LIGHT = '#c4c4c4';
export const PAPER = '#ffffff';
export const PAPER_DARK = '#f2f2ef';
export const AMBER = '#D98E04';
export const ASSUME = '#3a3a3a';
export const RED = '#C8102E';
export const CLOSED = '#9a9a9a';

const TARGET = 'f4-apt-4c';
const L = model.layout;

function Space({ space, floorGap, emphasis, onSelect }) {
  const [x0, y0, x1, y1] = space.bbox_m;
  const w = x1 - x0;
  const d = y1 - y0;
  const h = 0.12;
  const [cx, cy, cz] = toScene((x0 + x1) / 2, (y0 + y1) / 2, space.floor, floorGap, h / 2);
  const isTarget = space.id === TARGET;
  const fill = isTarget ? '#f6d5da' : space.type === 'apartment' ? PAPER_DARK : PAPER;
  return (
    <mesh
      position={[cx, cy, cz]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(space.id);
      }}
    >
      <boxGeometry args={[w - 0.04, h, d - 0.04]} />
      <meshBasicMaterial color={fill} transparent opacity={emphasis ? 0.92 : 0.45} depthWrite={emphasis} />
      <Edges color={isTarget ? RED : emphasis ? INK : GRAPHITE_LIGHT} />
    </mesh>
  );
}

function Shaft({ v, floorGap, onSelect, minimal, showTag = true }) {
  const stops = [...v.stops].sort((a, b) => a.floor - b.floor);
  const b = stops[0].bbox_m;
  const bottom = floorY(stops[0].floor, floorGap);
  const top = floorY(stops[stops.length - 1].floor, floorGap) + 0.6;
  const h = top - bottom;
  const [cx, , cz] = toScene((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, 1, floorGap);
  const isElevator = v.kind === 'elevator';

  // Combine STAIR A and STAIR B into one crisp scissor-core label centered over their shared shaft
  const showLabel = showTag && v.id !== 'stair-b' && !(minimal && isElevator);
  const labelX = v.id === 'stair-a' ? b[2] : (b[0] + b[2]) / 2;
  const labelPos = toScene(labelX, (b[1] + b[3]) / 2, stops[stops.length - 1].floor, floorGap, 1.5);

  return (
    <group>
      <mesh
        position={[cx, bottom + h / 2, cz]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(v.id);
        }}
      >
        <boxGeometry args={[b[2] - b[0] - 0.15, h, b[3] - b[1] - 0.15]} />
        <meshBasicMaterial
          color={isElevator ? '#f4f4f4' : '#ececea'}
          transparent
          opacity={isElevator ? 0.25 : 0.4}
          depthWrite={false}
        />
        <Edges color={isElevator ? GRAPHITE_LIGHT : GRAPHITE} />
      </mesh>
      {/* landings */}
      {stops.map((s) => {
        const [lx, ly, lz] = toScene(
          (s.bbox_m[0] + s.bbox_m[2]) / 2,
          (s.bbox_m[1] + s.bbox_m[3]) / 2,
          s.floor,
          floorGap,
          0.08,
        );
        return (
          <mesh key={s.floor} position={[lx, ly, lz]}>
            <boxGeometry args={[s.bbox_m[2] - s.bbox_m[0] - 0.3, 0.06, s.bbox_m[3] - s.bbox_m[1] - 0.3]} />
            <meshBasicMaterial color={PAPER} transparent opacity={0.6} />
            <Edges color={isElevator ? GRAPHITE_LIGHT : GRAPHITE} />
          </mesh>
        );
      })}
      {showLabel && (
        <Html position={labelPos} center zIndexRange={[10, 0]}>
          {isElevator ? (
            <div className="tag tag-excluded">
              <span className="tag-row">
                <ElevatorExcludedIcon size={12} /> E1 · not for fire service use
              </span>
              <span>Sheet A-4, note 3 · excluded from routes</span>
            </div>
          ) : (
            <div className="tag tag-stair">
              <span className="tag-row">
                <StairIcon size={12} /> {v.id === 'stair-a' ? 'STAIR A / B · SCISSOR' : 'STAIR C (REAR)'}
              </span>
            </div>
          )}
        </Html>
      )}
    </group>
  );
}

function Rect({ anchor, floorGap, color, dashed, lift = 0.25, pad = 0.25, lineWidth = 2 }) {
  const { x, y, floor, w, d } = anchor;
  const hw = w / 2 + pad;
  const hd = d / 2 + pad;
  const pts = [
    [x - hw, y - hd],
    [x + hw, y - hd],
    [x + hw, y + hd],
    [x - hw, y + hd],
    [x - hw, y - hd],
  ].map(([a, b]) => toScene(a, b, floor, floorGap, lift));
  return <Line points={pts} color={color} lineWidth={lineWidth} dashed={dashed} dashSize={0.45} gapSize={0.3} />;
}

function Hatch({ anchor, floorGap, color, lift = 0.22 }) {
  const { x, y, floor, w, d } = anchor;
  const segs = [];
  const step = 0.7;
  for (let t = -d; t < w; t += step) {
    const xa = Math.max(0, t);
    const ya = xa - t;
    const xb = Math.min(w, t + d);
    const yb = xb - t;
    if (xb > xa) {
      segs.push([
        toScene(x - w / 2 + xa, y - d / 2 + ya, floor, floorGap, lift),
        toScene(x - w / 2 + xb, y - d / 2 + yb, floor, floorGap, lift),
      ]);
    }
  }
  return segs.map((s, i) => <Line key={i} points={s} color={color} lineWidth={1.1} transparent opacity={0.75} />);
}

function ConditionMarks({ conditionsView, floorGap, onPin }) {
  // Group active conditions by anchor key so co-located badges stack cleanly without overlapping
  const groups = useMemo(() => {
    const map = new Map();
    for (const c of conditionsView) {
      const key = c.target_id + (c.target_floor ? `@${c.target_floor}` : '');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    }
    return Array.from(map.entries());
  }, [conditionsView]);

  return groups.map(([key, items]) => {
    const anchor = anchorOf(key);
    if (!anchor) return null;
    const top = toScene(anchor.x, anchor.y, anchor.floor, floorGap, 2.5);
    const { x, y, floor, w, d } = anchor;

    return (
      <group key={key}>
        {/* 3D floor marks */}
        {items.map((c) => {
          if (c.state === 'assumed') {
            return (
              <group key={c.condition_id}>
                <Rect anchor={anchor} floorGap={floorGap} color={ASSUME} dashed lineWidth={2.6} />
                <Hatch anchor={anchor} floorGap={floorGap} color={ASSUME} />
              </group>
            );
          }
          if (c.state === 'reported') {
            return (
              <Rect
                key={c.condition_id}
                anchor={anchor}
                floorGap={floorGap}
                color={AMBER}
                dashed
                lineWidth={2.6}
                pad={0.45}
              />
            );
          }
          if (c.state === 'blocked') {
            // Heavy ink X (red pencil strictly reserved for checker corrections per DECISIONS.md)
            const a = toScene(x - w / 2, y - d / 2, floor, floorGap, 0.34);
            const b = toScene(x + w / 2, y + d / 2, floor, floorGap, 0.34);
            const c1 = toScene(x - w / 2, y + d / 2, floor, floorGap, 0.34);
            const d1 = toScene(x + w / 2, y - d / 2, floor, floorGap, 0.34);
            return (
              <group key={c.condition_id}>
                <Rect anchor={anchor} floorGap={floorGap} color={INK} lineWidth={4} pad={0.14} lift={0.3} />
                <Line points={[a, b]} color={INK} lineWidth={4.5} />
                <Line points={[c1, d1]} color={INK} lineWidth={4.5} />
              </group>
            );
          }
          if (c.state === 'clear') {
            return <Rect key={c.condition_id} anchor={anchor} floorGap={floorGap} color={INK} lineWidth={2.2} pad={0.1} />;
          }
          return null;
        })}

        {/* Stacked HTML badges (never collide) */}
        <Html position={top} center zIndexRange={[25, 0]}>
          <div className="tag-stack">
            {items.map((c) => {
              if (c.state === 'assumed') {
                return (
                  <div key={c.condition_id} className="tag tag-assume">
                    IF · assumed unavailable
                  </div>
                );
              }
              if (c.state === 'reported') {
                return (
                  <button key={c.condition_id} className="tag tag-report" onClick={() => onPin?.(c)}>
                    <span className="tag-row">
                      <ReportPinIcon size={12} color="#8a5a00" /> “{c.source?.verbatim}”
                    </span>
                    <span>
                      {c.source?.actor}, {c.time} · unverified · tap to verify
                    </span>
                  </button>
                );
              }
              if (c.state === 'blocked') {
                return (
                  <div key={c.condition_id} className="tag tag-blocked">
                    ✕ VERIFIED BLOCKED · {c.source?.unit}, {c.time}
                  </div>
                );
              }
              if (c.state === 'clear') {
                return (
                  <div key={c.condition_id} className="tag tag-clear">
                    ✓ VERIFIED CLEAR · {c.source?.unit}, {c.time}
                  </div>
                );
              }
              return null;
            })}
          </div>
        </Html>
      </group>
    );
  });
}

// Let one-finger vertical swipes scroll the page when the scene is embedded on a touch screen.
function TouchScroll({ on }) {
  const { gl } = useThree();
  useEffect(() => {
    if (!on) return undefined;
    const t = setTimeout(() => {
      gl.domElement.style.touchAction = 'pan-y';
    }, 0);
    return () => clearTimeout(t);
  }, [on, gl]);
  return null;
}

function CameraRig({ focus, exploded }) {
  const { camera, controls, size } = useThree();
  // Narrow screens (phones) see the same framing, scaled to fit.
  // Phone-sized canvases (< 560px wide) get extra margin so the whole exploded stack stays in frame.
  const fit = Math.min(1, size.width / 760, size.height / 620) * (size.width < 560 ? 0.8 : 1);

  useEffect(() => {
    if (!controls) return;
    const t = focus.anchor;
    const gap = exploded ? EXPLODED_GAP : FLOOR_GAP;
    const target = t ? new THREE.Vector3(...toScene(t.x, t.y, t.floor, gap, 0)) : new THREE.Vector3(0, floorY(3, gap), 0);
    const offset = camera.position.clone().sub(controls.target);

    gsap.killTweensOf(controls.target);
    gsap.killTweensOf(camera);

    gsap.to(controls.target, {
      x: target.x,
      y: target.y,
      z: target.z,
      duration: 0.7,
      ease: 'power2.inOut',
      onUpdate: () => {
        camera.position.copy(controls.target).add(offset);
        controls.update();
      },
    });
    gsap.to(camera, {
      zoom: focus.zoom * fit,
      duration: 0.7,
      ease: 'power2.inOut',
      onUpdate: () => camera.updateProjectionMatrix(),
    });
  }, [focus, exploded, camera, controls, fit]);

  return null;
}

// Build-up (story slide): each floor rises a few units and fades in, edges a beat after the slab.
// `buildAt` is a performance.now() timestamp for floor 1; -Infinity = already built. Runs in the render loop, so it's
// driven by elapsed time and costs no React renders.
const BUILD = { DUR: 850, STAGGER: 340, RISE: 2.4 };
export const buildEndMs = (n = 6) => (n - 1) * BUILD.STAGGER + BUILD.DUR;
const easeOutExpo = (k) => (k >= 1 ? 1 : 1 - 2 ** (-10 * k));
function BuildGroup({ index, buildAt, children }) {
  const ref = useRef(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const k = buildAt === -Infinity ? 1 : Math.max(0, Math.min(1, (performance.now() - buildAt - index * BUILD.STAGGER) / BUILD.DUR));
    if (g.userData.k === k) return;
    g.userData.k = k;
    const e = easeOutExpo(k);
    const edge = easeOutExpo(Math.max(0, Math.min(1, (k - 0.3) / 0.7)));
    g.position.y = -(1 - e) * BUILD.RISE;
    g.visible = k > 0;
    g.traverse((o) => {
      const m = o.material;
      if (!m || Array.isArray(m)) return;
      if (m.userData.base == null) m.userData.base = m.opacity ?? 1;
      if (!m.transparent) {
        m.transparent = true;
        m.needsUpdate = true;
      }
      m.opacity = m.userData.base * (m.isLineMaterial || o.isLineSegments ? edge : e);
    });
  });
  return <group ref={ref}>{children}</group>;
}

// The first `fraction` of a polyline by length (null when nothing is left to draw).
function slicePolyline(pts, fraction) {
  if (fraction >= 1) return pts;
  if (!(fraction > 0)) return null;
  const seg = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    seg.push(d);
    total += d;
  }
  let left = total * fraction;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const d = seg[i - 1];
    if (left >= d) {
      out.push(pts[i]);
      left -= d;
    } else {
      const k = d > 0 ? left / d : 0;
      const a = pts[i - 1];
      const b = pts[i];
      out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
      break;
    }
  }
  return out.length >= 2 ? out : null;
}

export default function Scene({
  result,
  baseline,
  conditionsView,
  exploded,
  focus,
  selected,
  onSelect,
  onPin,
  unclearIds,
  embedded = false,
  minimal = false,
  routeAnim = null, // { routes: [{ r, progress 0..1 }] } draws only these, each cut to its progress (story slide)
  showClosed = true, // gray dashes for routes closed by a condition
  showFlags = true, // ochre for unclear drawings and unconfirmed entrances
  buildAt = -Infinity, // story slide: null = empty, a timestamp = building up, -Infinity = built
  labelsOn = true, // story slide: labels fade in after the geometry
  showStairTags = true,
  entranceIds = null, // which entrances to draw (null = all)
  emphasize = [], // [{ id, label }] outlined in red with a small label (story slide)
}) {
  // Inside the story page, the wheel scrolls the page and one-finger drags on touch screens
  // scroll too; taps still select. Full-screen /demo keeps zoom and rotate.
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  // Smooth GSAP floor-stack explode/collapse
  const gapProxy = useRef({ value: exploded ? EXPLODED_GAP : FLOOR_GAP });
  const [floorGap, setFloorGap] = useState(exploded ? EXPLODED_GAP : FLOOR_GAP);

  useEffect(() => {
    gsap.to(gapProxy.current, {
      value: exploded ? EXPLODED_GAP : FLOOR_GAP,
      duration: 0.55,
      ease: 'power2.inOut',
      onUpdate: () => setFloorGap(gapProxy.current.value),
    });
  }, [exploded]);

  const activeKeys = new Set(result.routes.map((r) => r.nodes.join('>')));
  const closedIds = new Set(result.closed.map((c) => c.id));
  const greyed = baseline.routes.filter(
    (r) => !activeKeys.has(r.nodes.join('>')) && r.elements.some((id) => closedIds.has(id)),
  );
  const routeLines = useMemo(
    () => result.routes.map((r) => ({ r, pts: routePolyline(r, TARGET, floorGap) })),
    [result, floorGap],
  );
  const greyLines = useMemo(
    () => greyed.map((r) => ({ r, pts: routePolyline(r, TARGET, floorGap) })),
    [greyed, floorGap],
  );
  const animLines = routeAnim
    ? routeAnim.routes
        .map(({ r, progress }) => ({ r, pts: slicePolyline(routePolyline(r, TARGET, floorGap), progress) }))
        .filter((l) => l.pts)
    : null;
  const emphasisFloor = (f) => f === 4 || f === 1;
  const target = anchorOf(TARGET);

  return (
    <Canvas
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      onPointerMissed={() => onSelect?.(null)}
      style={{ background: 'transparent' }}
    >
      <OrthographicCamera
        makeDefault
        position={[40, 34, 40]}
        zoom={18 * Math.min(1, (typeof window !== 'undefined' ? window.innerWidth : 1000) / 760)}
        near={-500}
        far={500}
      />
      <OrbitControls
        makeDefault
        enableDamping={false}
        enableZoom={!embedded}
        enableRotate={!(embedded && coarse)}
        enablePan={!embedded}
        minZoom={8}
        maxZoom={120}
        maxPolarAngle={Math.PI / 2.2}
      />
      <CameraRig focus={focus} exploded={exploded} />
      <TouchScroll on={embedded && coarse} />

      {/* floors: plate, rooms and doors per floor, so the story slide can raise them one by one */}
      {buildAt !== null &&
        L.floors.map((f) => {
          const y = floorY(f.floor, floorGap);
          return (
            <BuildGroup key={f.floor} index={f.floor - 1} buildAt={buildAt}>
              <mesh position={[0, y - 0.03, 0]}>
                <boxGeometry args={[W + 0.6, 0.04, D + 0.6]} />
                <meshBasicMaterial
                  color={PAPER}
                  transparent
                  opacity={emphasisFloor(f.floor) ? 0.52 : 0.22}
                  depthWrite={false}
                />
                <Edges color={GRAPHITE_LIGHT} />
              </mesh>
              {labelsOn && (!minimal || f.floor === 4) && (
                <Html position={[-W / 2 - 2.2, y, D / 2]} center zIndexRange={[5, 0]}>
                  <div className={`floor-tag ${f.floor === 4 ? 'is-target' : ''}`}>F{f.floor}</div>
                </Html>
              )}
              {L.spaces
                .filter((sp) => sp.floor === f.floor)
                .map((sp) => (
                  <Space key={sp.id} space={sp} floorGap={floorGap} emphasis={emphasisFloor(sp.floor)} onSelect={onSelect} />
                ))}
              {L.openings
                .filter((o) => o.floor === f.floor && o.kind !== 'elevator_door' && o.kind !== 'open_passage')
                .map((o) => {
                  const p = toScene(o.pos_m[0], o.pos_m[1], o.floor, floorGap, 0.15);
                  return (
                    <mesh
                      key={o.id}
                      position={p}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect?.(o.id);
                      }}
                    >
                      <boxGeometry args={[0.55, 0.3, 0.55]} />
                      <meshBasicMaterial color={selected === o.id ? INK : PAPER} />
                      <Edges color={GRAPHITE} />
                    </mesh>
                  );
                })}
            </BuildGroup>
          );
        })}
      {buildAt !== null && (
        <BuildGroup index={5} buildAt={buildAt}>
          {L.verticals.map((v) => (
            <Shaft key={v.id} v={v} floorGap={floorGap} onSelect={onSelect} minimal={minimal} showTag={showStairTags && labelsOn} />
          ))}
        </BuildGroup>
      )}

      {/* unclear drawings: dashed amber */}
      {showFlags && buildAt !== null && unclearIds.map((id) => (
        <Rect
          key={id}
          anchor={anchorOf(id)}
          floorGap={floorGap}
          color={AMBER}
          dashed
          pad={0.35}
          lineWidth={2.8}
          lift={0.3}
        />
      ))}

      {/* entrances */}
      {buildAt !== null && (
      <BuildGroup index={0} buildAt={buildAt}>
      {L.entrances.filter((e) => !entranceIds || entranceIds.includes(e.id)).map((e) => {
        const p = toScene(e.pos_m[0], e.pos_m[1] + (e.pos_m[1] === 0 ? -1.4 : 1.4), 1, floorGap, 0.2);
        const flagged = !e.access_confirmed && showFlags;
        return (
          <group key={e.id}>
            <mesh position={p} rotation={[0, Math.PI / 4, 0]}>
              <coneGeometry args={[0.6, 0.6, 4]} />
              <meshBasicMaterial color={e.access_confirmed ? INK : PAPER} />
              <Edges color={flagged ? AMBER : INK} />
            </mesh>
            {labelsOn && (
            <Html position={[p[0], p[1] - 0.9, p[2]]} center zIndexRange={[10, 0]}>
              <div className={`tag ${flagged ? 'tag-unconfirmed' : 'tag-entrance'}`}>
                <span className="tag-row">
                  <EntranceIcon size={11} /> {e.id === 'ent-alley' ? 'REAR ALLEY GATE' : e.label.split(' (')[0].toUpperCase()}
                </span>
                {flagged && <span>access unconfirmed</span>}
              </div>
            </Html>
            )}
          </group>
        );
      })}
      </BuildGroup>
      )}

      {/* the reported unit */}
      {buildAt !== null && labelsOn && (
        <Html position={toScene(target.x, target.y + 1.5, 4, floorGap, 0.6)} center zIndexRange={[15, 0]}>
          <div className="tag tag-target">4C · DISPATCH</div>
        </Html>
      )}
      {emphasize.map(({ id, label }) => {
        const a = anchorOf(id);
        if (!a || buildAt === null) return null;
        return (
          <group key={`em-${id}`}>
            <Rect anchor={a} floorGap={floorGap} color={RED} lineWidth={1.6} pad={0.12} lift={0.3} />
            {labelsOn && (
              <Html position={toScene(a.x - a.w / 2, a.y + a.d / 2 + 0.6, a.floor, floorGap, 0.4)} center zIndexRange={[12, 0]}>
                <div className="tag tag-emph">{label}</div>
              </Html>
            )}
          </group>
        );
      })}
      {selected && anchorOf(selected) && (
        <Rect anchor={anchorOf(selected)} floorGap={floorGap} color={INK} lineWidth={1.8} pad={0.15} lift={0.35} />
      )}

      {/* routes: dashed grey = closed by a condition, heavy ink = documented and open */}
      {showClosed && !animLines && greyLines.map(({ r, pts }) => (
        <Line
          key={`g-${r.nodes.join('>')}`}
          points={pts}
          color={CLOSED}
          lineWidth={3}
          dashed
          dashSize={0.45}
          gapSize={0.3}
        />
      ))}
      {(animLines ?? routeLines).map(({ r, pts }) => (
        <Line
          key={r.nodes.join('>')}
          points={pts}
          color={RED}
          lineWidth={r.open_questions === 0 ? 4.6 : 3.2}
          transparent
          opacity={r.rank <= 3 ? 1 : 0.78}
        />
      ))}

      <ConditionMarks conditionsView={conditionsView} floorGap={floorGap} onPin={onPin} />
    </Canvas>
  );
}

export { TARGET, verticalById };
