import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoutes } from '../src/engine/routing.js';

const here = dirname(fileURLToPath(import.meta.url));
const canonical = resolve(here, '../data/marlowe/true_model.json');
const bundled = resolve(here, '../src/data/marlowe.json');
const modelPath = existsSync(canonical) ? canonical : bundled;
const model = JSON.parse(readFileSync(modelPath, 'utf8'));
const TARGET = 'f4-apt-4c';

const assume = (id, target) => ({
  condition_id: id,
  target_id: target,
  kind: 'assumed_unavailable',
  timestamp: '2026-11-21T02:17:05-05:00',
  source: { actor: 'Officer', trigger: 'tap', prompt: `Assume ${target} unavailable` },
});
const clear = (id, clears) => ({
  condition_id: id,
  target_id: null,
  kind: 'assumption_cleared',
  timestamp: '2026-11-21T02:18:00-05:00',
  source: { actor: 'Officer', clears_condition_id: clears },
});
const report = (id, target) => ({
  condition_id: id,
  target_id: target,
  kind: 'reported',
  timestamp: '2026-11-21T02:16:00-05:00',
  source: { actor: 'Caller', channel: '911', verbatim: 'smoke in the hallway by the elevator' },
});

const strip = (r) => JSON.parse(JSON.stringify(r));

test('model under test is true_model.json', () => {
  assert.equal(model.building.id, 'marlowe-house');
  assert.deepEqual(model.conditions, []);
});

test('no conditions: routes from 142, 144 and the alley; front chokepoint is the east lobby; no elevator', () => {
  const r = findRoutes(model, TARGET, []);
  assert.equal(r.status, 'ok');
  const entrances = new Set(r.routes.map((x) => x.entrance_id));
  for (const e of ['ent-142', 'ent-144', 'ent-alley']) assert.ok(entrances.has(e), `route from ${e}`);
  assert.ok(r.routes.length <= 6);
  assert.equal(r.chokepoints.confirmed.primary.id, 'f4-east-lobby');
  assert.deepEqual(r.chokepoints.confirmed.entrances.sort(), ['ent-142', 'ent-144']);
  for (const route of r.routes) {
    assert.ok(!route.elements.includes('elevator-e1'), `${route.id} avoids elevator`);
    assert.ok(!route.nodes.some((n) => n.startsWith('elevator-e1')));
    assert.ok(!route.elements.some((id) => id.includes('elevator')));
  }
  assert.ok(r.excluded.some((x) => x.id === 'elevator-e1'));
  // the lobby is bypassable, so it is not a global chokepoint
  assert.ok(!r.chokepoints.global.elements.some((e) => e.id === 'f4-east-lobby'));
  // ranking: the two front routes (no open questions) come first
  assert.deepEqual(r.routes.slice(0, 2).map((x) => x.open_questions), [0, 0]);
  assert.deepEqual(new Set(r.routes.slice(0, 2).map((x) => x.entrance_id)), new Set(['ent-142', 'ent-144']));
  for (let i = 1; i < r.routes.length; i++) {
    assert.ok(r.routes[i - 1].open_questions <= r.routes[i].open_questions, 'sorted by open questions');
  }
});

test('east lobby assumed unavailable: all remaining routes pass door-f4-stair-c, the new chokepoint, flagged unclear', () => {
  const r = findRoutes(model, TARGET, [assume('cond-001', 'f4-east-lobby')]);
  assert.equal(r.status, 'ok');
  assert.ok(r.routes.length >= 2);
  for (const route of r.routes) {
    assert.ok(route.elements.includes('door-f4-stair-c'), `${route.id} passes Stair C floor-4 door`);
    assert.ok(!route.elements.includes('f4-east-lobby'));
    const viaAlley = route.entrance_id === 'ent-alley';
    const viaF3Crossover = route.elements.includes('f3-east-corr') && route.elements.includes('door-f3-stair-c');
    assert.ok(viaAlley || viaF3Crossover, `${route.id} is via the alley or the floor-3 crossover`);
  }
  assert.ok(r.routes.some((x) => x.entrance_id === 'ent-alley'));
  assert.ok(r.routes.some((x) => x.entrance_id !== 'ent-alley'));
  for (const scope of ['confirmed', 'global']) {
    const cp = r.chokepoints[scope];
    assert.equal(cp.primary.id, 'door-f4-stair-c', `${scope} chokepoint`);
    assert.ok(cp.primary.flags.some((f) => f.type === 'unclear_drawing'), `${scope} chokepoint flagged unclear`);
  }
  for (const route of r.routes) {
    assert.ok(route.flags.some((f) => f.type === 'unclear_drawing' && f.element_id === 'door-f4-stair-c'));
  }
  assert.ok(r.closed.some((c) => c.id === 'f4-east-lobby'));
});

test('east lobby and door-f4-stair-c both assumed unavailable: no documented route', () => {
  const r = findRoutes(model, TARGET, [assume('cond-001', 'f4-east-lobby'), assume('cond-002', 'door-f4-stair-c')]);
  assert.equal(r.status, 'no_route');
  assert.equal(r.routes.length, 0);
  assert.match(r.message, /No documented route/);
});

test('reported condition on the east lobby: routes still pass it, flagged', () => {
  const base = findRoutes(model, TARGET, []);
  const r = findRoutes(model, TARGET, [report('cond-003', 'f4-east-lobby')]);
  assert.equal(r.status, 'ok');
  const through = r.routes.filter((x) => x.elements.includes('f4-east-lobby'));
  assert.ok(through.length >= 2, 'front routes still pass the lobby');
  for (const route of through) {
    assert.ok(route.flags.some((f) => f.type === 'reported' && f.element_id === 'f4-east-lobby'));
  }
  assert.deepEqual(r.routes.map((x) => x.nodes), base.routes.map((x) => x.nodes), 'a report does not change the routes');
  assert.equal(r.chokepoints.confirmed.primary.id, 'f4-east-lobby');
  assert.ok(r.chokepoints.confirmed.primary.flags.some((f) => f.type === 'reported'));
  assert.ok(r.flagged.some((f) => f.id === 'f4-east-lobby'));
});

test('assumption_cleared restores the earlier result', () => {
  const before = strip(findRoutes(model, TARGET, []));
  const after = strip(findRoutes(model, TARGET, [assume('cond-001', 'f4-east-lobby'), clear('cond-002', 'cond-001')]));
  assert.deepEqual(after, before);

  const one = strip(findRoutes(model, TARGET, [assume('cond-001', 'f4-east-lobby')]));
  const twoThenUndo = strip(
    findRoutes(model, TARGET, [
      assume('cond-001', 'f4-east-lobby'),
      assume('cond-002', 'door-f4-stair-c'),
      clear('cond-003', 'cond-002'),
    ]),
  );
  assert.deepEqual(twoThenUndo, one);
});

test('verified_blocked closes; verified_clear supersedes the report', () => {
  const blocked = findRoutes(model, TARGET, [
    report('cond-003', 'f4-east-lobby'),
    { condition_id: 'cond-004', target_id: 'f4-east-lobby', kind: 'verified_blocked', source: { unit: 'Engine 7', actor: 'Lt.' } },
  ]);
  assert.ok(blocked.routes.every((x) => !x.elements.includes('f4-east-lobby')));
  assert.equal(blocked.chokepoints.global.primary.id, 'door-f4-stair-c');

  const cleared = findRoutes(model, TARGET, [
    report('cond-003', 'f4-east-lobby'),
    { condition_id: 'cond-004', target_id: 'f4-east-lobby', kind: 'verified_clear', source: { unit: 'Engine 7', actor: 'Lt.' } },
  ]);
  const through = cleared.routes.filter((x) => x.elements.includes('f4-east-lobby'));
  assert.ok(through.length >= 2);
  assert.ok(through.every((x) => !x.flags.some((f) => f.type === 'reported')));
});

test('a landing-scoped condition closes only that landing', () => {
  const r = findRoutes(model, TARGET, [
    { condition_id: 'cond-010', target_id: 'stair-c', target_floor: 4, kind: 'assumed_unavailable', source: { actor: 'Officer' } },
  ]);
  assert.ok(r.routes.every((x) => !x.landings.includes('stair-c@4')));
  assert.ok(r.routes.some((x) => x.entrance_id === 'ent-142'));
});

test('sortBy distance ranks shortest mapped distance first while keeping flags', () => {
  const r = findRoutes(model, TARGET, [], { sortBy: 'distance' });
  assert.equal(r.routes[0].entrance_id, 'ent-alley');
  for (let i = 1; i < r.routes.length; i++) {
    assert.ok(r.routes[i - 1].distance_m <= r.routes[i].distance_m);
  }
});
