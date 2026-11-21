// Deterministic routing engine for the D5 building model.
// Plain JavaScript, no UI dependencies. Works in the browser and in Node.

export const FLOOR_CLIMB_M = 6;
export const MAX_ROUTES = 6;

const round1 = (n) => Math.round(n * 10) / 10;
const landingId = (verticalId, floor) => `${verticalId}@${floor}`;

// ---------------------------------------------------------------------------
// Conditions: fold the append-only log into a per-element state.
// Vertical conditions may carry target_floor to scope them to one landing.
// ---------------------------------------------------------------------------
export function resolveConditions(conditions = []) {
  const states = new Map(); // key: element id or landing id
  const byId = new Map();
  const get = (key) => {
    if (!states.has(key)) {
      states.set(key, {
        reports: [],
        blocked: null,
        verifiedClear: null,
        assumptions: new Map(),
      });
    }
    return states.get(key);
  };
  const keyFor = (c) =>
    c.target_floor != null ? landingId(c.target_id, c.target_floor) : c.target_id;

  for (const c of conditions) {
    byId.set(c.condition_id, c);
    switch (c.kind) {
      case 'reported':
        get(keyFor(c)).reports.push(c);
        break;
      case 'verified_clear': {
        const s = get(keyFor(c));
        s.reports = [];
        s.blocked = null;
        s.verifiedClear = c;
        break;
      }
      case 'verified_blocked': {
        const s = get(keyFor(c));
        s.blocked = c;
        s.verifiedClear = null;
        break;
      }
      case 'assumed_unavailable':
        get(keyFor(c)).assumptions.set(c.condition_id, c);
        break;
      case 'assumption_cleared': {
        const original = byId.get(c.source?.clears_condition_id ?? c.clears_condition_id);
        if (original) get(keyFor(original)).assumptions.delete(original.condition_id);
        break;
      }
      default:
        break;
    }
  }
  return states;
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------
export function buildGraph(model) {
  const L = model.layout;
  const nodes = new Map();
  const edges = new Map(); // node -> [{to, via, kind}]
  const elements = new Map(); // element id -> {kind, data}
  const excluded = [];

  const addNode = (id, info) => {
    nodes.set(id, info);
    if (!edges.has(id)) edges.set(id, []);
  };
  const addEdge = (a, b, via, kind) => {
    edges.get(a).push({ to: b, via, kind });
    edges.get(b).push({ to: a, via, kind });
  };

  for (const s of L.spaces) {
    addNode(s.id, { kind: 'space', floor: s.floor, element: s.id, data: s });
    elements.set(s.id, { kind: 'space', data: s });
  }

  const verticalById = new Map();
  for (const v of L.verticals) {
    verticalById.set(v.id, v);
    elements.set(v.id, { kind: 'vertical', data: v });
    if (v.kind === 'elevator') {
      excluded.push({
        id: v.id,
        label: v.label,
        reason: 'elevator',
        note: 'Not for fire service use; excluded from routes.',
      });
      continue;
    }
    for (const stop of v.stops) {
      addNode(landingId(v.id, stop.floor), {
        kind: 'landing',
        floor: stop.floor,
        element: v.id,
        vertical: v.id,
        data: stop,
      });
    }
    const floors = [...v.floors_connected].sort((a, b) => a - b);
    for (let i = 0; i + 1 < floors.length; i++) {
      addEdge(landingId(v.id, floors[i]), landingId(v.id, floors[i + 1]), v.id, 'ride');
    }
  }

  const resolveEnd = (id, floor) => (verticalById.has(id) ? landingId(id, floor) : id);
  for (const o of L.openings) {
    elements.set(o.id, { kind: 'opening', data: o });
    const [a, b] = o.connects.map((id) => resolveEnd(id, o.floor));
    if (!nodes.has(a) || !nodes.has(b)) continue; // elevator doors and the like
    addEdge(a, b, o.id, 'opening');
  }

  for (const e of L.entrances) {
    elements.set(e.id, { kind: 'entrance', data: e });
    addNode(e.id, { kind: 'entrance', floor: e.floor, element: e.id, data: e });
    addEdge(e.id, e.connects_to_space_id, e.id, 'entry');
  }

  return { nodes, edges, elements, verticalById, excluded };
}

// Element state given the folded conditions.
function elementStatus(graph, states, elementId) {
  const el = graph.elements.get(elementId);
  const s = states.get(elementId);
  const closedBy = [];
  if (s?.blocked) closedBy.push({ reason: 'verified_blocked', condition: s.blocked });
  if (s) for (const a of s.assumptions.values()) closedBy.push({ reason: 'assumed_unavailable', condition: a });

  const flags = [];
  if (s && s.reports.length) {
    for (const r of s.reports) flags.push({ type: 'reported', element_id: elementId, condition_id: r.condition_id, condition: r });
  }
  const data = el?.data;
  if (el?.kind === 'entrance' && data.access_confirmed === false && !s?.verifiedClear) {
    flags.push({ type: 'unconfirmed_access', element_id: elementId, open_question: true });
  }
  if (data?.layout_status === 'drafted_awaiting_review') {
    if (s?.verifiedClear) {
      flags.push({ type: 'unclear_drawing_verified_on_site', element_id: elementId, note: data.review_note });
    } else {
      flags.push({ type: 'unclear_drawing', element_id: elementId, open_question: true, note: data.review_note });
    }
  }
  if (s?.verifiedClear) flags.push({ type: 'verified_clear', element_id: elementId, condition_id: s.verifiedClear.condition_id, condition: s.verifiedClear });
  return { closed: closedBy.length > 0, closedBy, flags };
}

function landingStatus(states, landing) {
  const s = states.get(landing);
  const closedBy = [];
  if (s?.blocked) closedBy.push({ reason: 'verified_blocked', condition: s.blocked });
  if (s) for (const a of s.assumptions.values()) closedBy.push({ reason: 'assumed_unavailable', condition: a });
  const flags = (s?.reports ?? []).map((r) => ({ type: 'reported', element_id: landing, condition_id: r.condition_id, condition: r }));
  return { closed: closedBy.length > 0, closedBy, flags };
}

// ---------------------------------------------------------------------------
// Route enumeration
// Rules (beyond D6):
//  - simple paths only; floors never go down and never go above the target floor;
//  - other apartments are never passed through;
//  - each stair is ridden at most once (one continuous ride);
//  - a stair change is kept only if the new stair arrives somewhere an earlier
//    stair on the route does not also serve (drops pointless A <-> B swaps).
// ---------------------------------------------------------------------------
function enumeratePaths(graph, startNode, target, isClosed) {
  const targetFloor = graph.nodes.get(target).floor;
  const out = [];
  const visited = new Set([startNode]);
  const path = [{ node: startNode, via: null, kind: 'start' }];

  const ridden = []; // verticals used, in order
  const stopSpace = (vid, floor) =>
    graph.verticalById.get(vid).stops.find((s) => s.floor === floor)?.space_id;

  function dfs(node) {
    if (out.length > 5000) return;
    if (node === target) {
      out.push(path.map((p) => ({ ...p })));
      return;
    }
    const info = graph.nodes.get(node);
    for (const e of graph.edges.get(node)) {
      const next = e.to;
      if (visited.has(next)) continue;
      const ninfo = graph.nodes.get(next);
      if (ninfo.floor < info.floor || ninfo.floor > targetFloor) continue;
      if (ninfo.kind === 'space' && ninfo.data.type === 'apartment' && next !== target) continue;
      if (isClosed(e.via, next)) continue;

      let pushedVertical = false;
      if (ninfo.kind === 'landing' && info.kind !== 'landing') {
        // boarding a stair
        const vid = ninfo.vertical;
        if (ridden.includes(vid)) continue;
        ridden.push(vid);
        pushedVertical = true;
      }
      if (info.kind === 'landing' && ninfo.kind !== 'landing') {
        // leaving a stair: dominance check against earlier stairs on the route
        const vid = info.vertical;
        const exitSpace = stopSpace(vid, info.floor);
        const earlier = ridden.slice(0, -1);
        if (earlier.some((u) => stopSpace(u, info.floor) === exitSpace)) continue;
      }

      visited.add(next);
      path.push({ node: next, via: e.via, kind: e.kind });
      dfs(next);
      path.pop();
      visited.delete(next);
      if (pushedVertical) ridden.pop();
    }
  }
  dfs(startNode);
  return out;
}

function describeRoute(graph, model, statusOf, steps, target) {
  const entrance = graph.elements.get(steps[0].node).data;
  const elements = []; // ordered, unique element ids the route depends on
  const push = (id) => { if (!elements.includes(id)) elements.push(id); };
  const verticals = [];
  const points = []; // [x, y, floor] for distance and drawing

  points.push({ x: entrance.pos_m[0], y: entrance.pos_m[1], floor: entrance.floor, element: entrance.id });
  push(entrance.id);
  const landings = [];
  let rideStart = null;

  for (let i = 1; i < steps.length; i++) {
    const st = steps[i];
    const info = graph.nodes.get(st.node);
    if (st.kind === 'opening') {
      push(st.via);
      const o = graph.elements.get(st.via).data;
      points.push({ x: o.pos_m[0], y: o.pos_m[1], floor: o.floor, element: o.id });
    }
    if (info.kind === 'space') push(st.node);
    if (info.kind === 'landing') {
      landings.push(st.node);
      push(info.vertical);
      if (rideStart === null) rideStart = info.floor;
      const nextInfo = steps[i + 1] ? graph.nodes.get(steps[i + 1].node) : null;
      if (!nextInfo || nextInfo.kind !== 'landing') {
        verticals.push({ id: info.vertical, from_floor: rideStart, to_floor: info.floor });
        rideStart = null;
      }
    }
  }

  let distance = 0;
  let floorChanges = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const df = Math.abs(b.floor - a.floor);
    distance += Math.hypot(b.x - a.x, b.y - a.y) + FLOOR_CLIMB_M * df;
    floorChanges += df;
  }

  const flags = [];
  for (const id of elements) flags.push(...statusOf(id).flags);
  for (const l of landings) flags.push(...landingStatusCache(l).flags);
  const openQuestions = flags.filter((f) => f.open_question).length;

  const targetFloor = graph.nodes.get(target).floor;
  const lastRide = verticals[verticals.length - 1];
  const arrivalOpening = (() => {
    // first opening on the target floor after the last ride
    for (let i = steps.length - 1; i >= 1; i--) {
      const st = steps[i];
      if (st.kind === 'opening') {
        const o = graph.elements.get(st.via).data;
        if (o.connects.includes(lastRide?.id) && o.floor === targetFloor) return o.id;
      }
    }
    return null;
  })();
  const arrivalSpace = lastRide
    ? graph.verticalById.get(lastRide.id).stops.find((s) => s.floor === targetFloor)?.space_id ?? null
    : null;

  return {
    entrance_id: entrance.id,
    entrance_label: entrance.label,
    nodes: steps.map((s) => s.node),
    elements,
    landings,
    verticals,
    points,
    arrival_space: arrivalSpace,
    arrival_opening: arrivalOpening,
    switch_floors: verticals.slice(1).map((v) => v.from_floor),
    distance_m: round1(distance),
    floor_changes: floorChanges,
    open_questions: openQuestions,
    flags,
  };

  function landingStatusCache(l) {
    return statusOf.landing(l);
  }
}

export function compareRoutes(a, b) {
  if (a.open_questions !== b.open_questions) return a.open_questions - b.open_questions;
  if (a.distance_m !== b.distance_m) return a.distance_m - b.distance_m;
  if (a.floor_changes !== b.floor_changes) return a.floor_changes - b.floor_changes;
  // tie: prefer the crossover nearest the target floor (the floor-below tactic)
  const sa = Math.max(-1, ...a.switch_floors);
  const sb = Math.max(-1, ...b.switch_floors);
  if (sa !== sb) return sb - sa;
  return a.nodes.join('>') < b.nodes.join('>') ? -1 : 1;
}

export function compareRoutesByDistance(a, b) {
  if (a.distance_m !== b.distance_m) return a.distance_m - b.distance_m;
  if (a.floor_changes !== b.floor_changes) return a.floor_changes - b.floor_changes;
  if (a.open_questions !== b.open_questions) return a.open_questions - b.open_questions;
  const sa = Math.max(-1, ...a.switch_floors);
  const sb = Math.max(-1, ...b.switch_floors);
  if (sa !== sb) return sb - sa;
  return a.nodes.join('>') < b.nodes.join('>') ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Chokepoints: elements every route in a set depends on, in the order the
// routes meet them. Skips the target, its door(s) and the corridor it opens on.
// ---------------------------------------------------------------------------
function trivialElements(model, target) {
  const skip = new Set([target]);
  for (const o of model.layout.openings) {
    if (o.connects.includes(target)) {
      skip.add(o.id);
      for (const c of o.connects) skip.add(c);
    }
  }
  return skip;
}

function sharedElements(graph, routes, skip) {
  if (!routes.length) return [];
  const [first, ...rest] = routes;
  const common = first.elements.filter((id) => !skip.has(id) && rest.every((r) => r.elements.includes(id)));
  return common.map((id) => {
    const el = graph.elements.get(id);
    return {
      id,
      kind: el.kind,
      label: el.data.label ?? el.data.source_ref?.callout ?? id,
      layout_status: el.data.layout_status,
    };
  });
}

function chokepointSummary(graph, routes, skip, scope, statusOf) {
  const elements = sharedElements(graph, routes, skip);
  // headline: the first place the routes converge that is a door or a room
  // (a whole stair shaft is listed but is not the convergence point)
  const primary = elements.find((e) => e.kind !== 'vertical' && e.kind !== 'entrance') ?? null;
  return {
    scope,
    route_count: routes.length,
    entrances: [...new Set(routes.map((r) => r.entrance_id))],
    elements: elements.map((e) => ({ ...e, flags: statusOf(e.id).flags })),
    primary: primary ? { ...primary, flags: statusOf(primary.id).flags } : null,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export function findRoutes(model, target, conditions = model.conditions ?? [], options = {}) {
  const maxRoutes = options.maxRoutes ?? MAX_ROUTES;
  const graph = buildGraph(model);
  if (!graph.nodes.has(target)) throw new Error(`Unknown target: ${target}`);
  const states = resolveConditions(conditions);

  const cache = new Map();
  const statusOf = (id) => {
    if (!cache.has(id)) cache.set(id, elementStatus(graph, states, id));
    return cache.get(id);
  };
  statusOf.landing = (l) => {
    const k = `landing:${l}`;
    if (!cache.has(k)) cache.set(k, landingStatus(states, l));
    return cache.get(k);
  };

  const isClosed = (via, nextNode) => {
    if (via && statusOf(via).closed) return true;
    const info = graph.nodes.get(nextNode);
    if (info.kind === 'landing') return statusOf.landing(nextNode).closed || statusOf(info.vertical).closed;
    return statusOf(nextNode).closed;
  };

  const all = [];
  for (const e of model.layout.entrances) {
    if (statusOf(e.id).closed) continue;
    for (const steps of enumeratePaths(graph, e.id, target, isClosed)) {
      all.push(describeRoute(graph, model, statusOf, steps, target));
    }
  }
  const cmp = options.sortBy === 'distance' ? compareRoutesByDistance : compareRoutes;
  all.sort(cmp);

  // Distinct = a different entrance or a different way onto the target floor.
  const seen = new Set();
  const distinct = [];
  for (const r of all) {
    const key = `${r.entrance_id}|${r.arrival_space}`;
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(r);
  }
  const routes = distinct.slice(0, maxRoutes).map((r, i) => ({ id: `route-${i + 1}`, rank: i + 1, ...r }));

  // Chokepoints
  const skip = trivialElements(model, target);
  const confirmedEntrance = (id) => {
    const e = graph.elements.get(id).data;
    return e.access_confirmed === true || !!states.get(id)?.verifiedClear;
  };
  const fromConfirmed = all.filter((r) => confirmedEntrance(r.entrance_id));
  const bestTier = fromConfirmed.length ? Math.min(...fromConfirmed.map((r) => r.open_questions)) : 0;
  const primaryApproaches = fromConfirmed.filter((r) => r.open_questions === bestTier);

  const chokepoints = {
    confirmed: chokepointSummary(graph, primaryApproaches, skip, 'confirmed_front_approaches', statusOf),
    global: chokepointSummary(graph, all, skip, 'all_documented_routes', statusOf),
  };
  chokepoints.confirmed.open_questions_tier = bestTier;

  // Closed and flagged elements for the UI
  const closed = [];
  const flagged = [];
  for (const [key, s] of states) {
    const closedBy = [];
    if (s.blocked) closedBy.push({ reason: 'verified_blocked', condition_id: s.blocked.condition_id });
    for (const a of s.assumptions.values()) closedBy.push({ reason: 'assumed_unavailable', condition_id: a.condition_id });
    if (closedBy.length) closed.push({ id: key, closed_by: closedBy });
    if (s.reports.length && !closedBy.length) flagged.push({ id: key, reports: s.reports.map((r) => r.condition_id) });
  }

  const targetSpace = graph.elements.get(target).data;
  return {
    target,
    target_label: targetSpace.label,
    status: routes.length ? 'ok' : 'no_route',
    message: routes.length ? null : `No documented route reaches ${targetSpace.label}.`,
    routes,
    candidate_count: all.length,
    chokepoints,
    closed,
    flagged,
    excluded: graph.excluded,
  };
}

// Small helpers the UI uses to phrase results.
export function labelOf(model, id) {
  const L = model.layout;
  const [base, floor] = id.split('@');
  const all = [...L.spaces, ...L.openings, ...L.verticals, ...L.entrances];
  const el = all.find((x) => x.id === base);
  if (!el) return id;
  const label = (el.label ?? el.source_ref?.callout ?? el.id).replace(/\n/g, ' ');
  if (floor) return `${label}, floor ${floor}`;
  if (el.floor != null && L.spaces.includes(el)) return `${label}, floor ${el.floor}`;
  return label;
}
