import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const proof = JSON.parse(readFileSync(resolve(here, '../src/data/proof.json'), 'utf8'));
const evalDir = resolve(here, '../pipeline/eval');

test('pipeline data on the site comes from a live run', () => {
  assert.equal(proof.mode, 'live');
  assert.equal(proof.mock, false);
});

test('the four sheet readers start together, then checker follows', () => {
  const readers = proof.lanes.filter((l) => l.role === 'reader');
  assert.equal(readers.length, 4);
  for (const r of readers) assert.equal(r.start_s, 0);
  const lastReader = Math.max(...readers.map((r) => r.end_s));
  const stitch = proof.lanes.find((l) => l.role === 'stitcher');
  const check = proof.lanes.find((l) => l.role === 'checker');
  if (stitch) {
    assert.ok(stitch.start_s >= lastReader);
    assert.ok(check.start_s >= stitch.end_s);
  } else {
    assert.ok(check.start_s >= lastReader);
  }
});

test('stated total cost equals the sum of the agents', () => {
  const sum = proof.lanes.reduce((a, l) => a + l.cost_usd, 0);
  assert.ok(Math.abs(sum - proof.totals.cost_usd) < 0.01);
});

test('the missing note 7 is among the checker flags', () => {
  assert.ok(proof.checker_flags.some((f) => f.check === 'missing_referenced_note' && f.sheet === 'A-4'));
});

test('fast_run metadata is synced when pipeline/eval/fast_run.json exists', () => {
  assert.ok(proof.fast_run && typeof proof.fast_run.pending === 'boolean');
  const fastPath = resolve(evalDir, 'fast_run.json');
  if (existsSync(fastPath)) {
    const raw = JSON.parse(readFileSync(fastPath, 'utf8'));
    assert.equal(proof.fast_run.pending, false, 'run node scripts/sync-proof.mjs to sync fast_run.json');
    const expectedModel = raw.time_to_model_s ?? raw.model_seconds ?? raw.wall_seconds ?? raw.fast?.time_to_model_s ?? null;
    assert.equal(proof.fast_run.time_to_model_s, expectedModel);
  }
});

test('investigations metadata is synced and preserves drafted_awaiting_review when investigations.json exists', () => {
  assert.ok(proof.investigations && typeof proof.investigations.pending === 'boolean');
  const invPath = resolve(evalDir, 'investigations.json');
  if (existsSync(invPath)) {
    assert.equal(proof.investigations.pending, false, 'run node scripts/sync-proof.mjs to sync investigations.json');
    assert.ok(proof.investigations.note7, 'expected door-f4-stair-c note 7 investigation');
    assert.equal(proof.investigations.note7.keep_status, 'drafted_awaiting_review');
  }
});

test('decisions metadata is synced and low confidence is never applied when decisions_run.json exists', () => {
  assert.ok(proof.decisions && typeof proof.decisions.pending === 'boolean');
  const decPath = resolve(evalDir, 'decisions_run.json');
  if (existsSync(decPath)) {
    const raw = JSON.parse(readFileSync(decPath, 'utf8'));
    assert.equal(proof.decisions.pending, false, 'run node scripts/sync-proof.mjs to sync decisions_run.json');
    assert.equal(proof.decisions.model, raw.model);
    assert.equal(proof.decisions.median_ms, raw.latency_ms.median);
    for (const e of proof.decisions.examples) {
      const low = [e.target, e.condition, e.kind].some((a) => a.probability < proof.decisions.threshold);
      assert.equal(e.needs_confirmation, low);
    }
  }
});
