// Builds src/data/proof.json (what the site's proof panel shows) from the
// pipeline's real output, eval/run.json. Only the fields the page needs are kept.
// Usage: node scripts/sync-proof.mjs [path/to/run.json]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const candidates = [
  process.argv[2],
  resolve(app, '../pipeline/eval/run.json'),
  resolve(app, 'pipeline/eval/run.json'),
].filter(Boolean);
const src = candidates.find((p) => existsSync(p));
if (!src) {
  console.log('run.json not found; keeping the bundled src/data/proof.json.');
  process.exit(0);
}

const run = JSON.parse(readFileSync(src, 'utf8'));
const t0 = Date.parse(run.started);
const sec = (iso) => Math.round(((Date.parse(iso) - t0) / 1000) * 10) / 10;
const pick = (a) => ({
  spaces_true: a.spaces_true,
  spaces_matched: a.spaces_matched,
  spaces_extra: a.spaces_extra,
  spaces_recall: a.spaces_recall,
  spaces_precision: a.spaces_precision,
  openings_true: a.openings_true,
  openings_correct: a.openings_correct,
  openings_correct_rate: a.openings_correct_rate,
  connections_true: a.connections_true,
  connections_correct: a.connections_correct,
  connections_f1: a.connections_f1,
  stops_true: a.stops_true,
  stops_correct: a.stops_correct,
  stops_rate: a.stops_rate,
  trap_holds: a.trap?.holds ?? null,
  stair_c_f4_door_status: a.stair_c_f4_door_status,
  overall: a.overall,
});

const proof = {
  source: 'pipeline eval/run.json (latest live run)',
  mode: run.mode,
  mock: run.mock,
  agent: run.agent,
  started: run.started,
  ended: run.ended,
  wall_seconds: run.wall_seconds,
  pricing_basis: run.pricing?.basis,
  lanes: run.timeline.map((t) => ({
    agent: t.agent,
    role: t.role,
    step: t.step,
    start_s: sec(t.start),
    end_s: sec(t.end),
    seconds: t.seconds,
    tokens: t.usage?.total_tokens ?? null,
    cost_usd: t.cost_usd,
    status: t.status,
  })),
  readers: Object.fromEntries(
    Object.entries(run.readers).map(([k, r]) => [
      k,
      { render_match: r.render_match?.pass_scores ?? [], passes: r.render_match?.passes ?? 0, counts: r.counts },
    ]),
  ),
  checker_rounds: run.checker_rounds,
  checker_flags: run.checker_catches.map((c) => ({
    round: c.round,
    severity: c.severity,
    action: c.action,
    check: c.finding.check,
    owner: c.finding.owner,
    element_ids: c.finding.element_ids,
    message: c.finding.message,
    sheet: c.finding.evidence?.sheet ?? null,
  })),
  final_invariant_findings: run.final_invariant_findings.length,
  accuracy: { before_checker: pick(run.accuracy.before_checker), after_checker: pick(run.accuracy.after_checker) },
  totals: run.totals,
};

writeFileSync(resolve(app, 'src/data/proof.json'), JSON.stringify(proof, null, 1) + '\n');
console.log('Wrote src/data/proof.json from', src);
