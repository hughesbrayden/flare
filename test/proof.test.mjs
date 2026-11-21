import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const proof = JSON.parse(readFileSync(resolve(here, '../src/data/proof.json'), 'utf8'));

test('pipeline data on the site comes from a live run', () => {
  assert.equal(proof.mode, 'live');
  assert.equal(proof.mock, false);
});

test('the four sheet readers start together, then stitcher, then checker', () => {
  const readers = proof.lanes.filter((l) => l.role === 'reader');
  assert.equal(readers.length, 4);
  for (const r of readers) assert.equal(r.start_s, 0);
  const lastReader = Math.max(...readers.map((r) => r.end_s));
  const stitch = proof.lanes.find((l) => l.role === 'stitcher');
  const check = proof.lanes.find((l) => l.role === 'checker');
  assert.ok(stitch.start_s >= lastReader);
  assert.ok(check.start_s >= stitch.end_s);
});

test('stated total cost equals the sum of the agents', () => {
  const sum = proof.lanes.reduce((a, l) => a + l.cost_usd, 0);
  assert.ok(Math.abs(sum - proof.totals.cost_usd) < 0.01);
});

test('the missing note 7 is among the checker flags', () => {
  assert.ok(proof.checker_flags.some((f) => f.check === 'missing_referenced_note' && f.sheet === 'A-4'));
});
