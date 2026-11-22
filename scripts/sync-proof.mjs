// Builds src/data/proof.json (what the site's proof panel shows) from the
// pipeline's real outputs:
//   - eval/run.json            (Managed Agents run)
//   - eval/fast_run.json       (fast pass + dispatch call timing, optional until W1 lands)
//   - eval/investigations.json (parallel investigator agents, optional until W2 lands)
//   - eval/decisions_run.json  (Gemini Decisions API dispatch mapping, optional)
// Usage: node scripts/sync-proof.mjs [path/to/run.json]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const candidates = [
  process.argv[2],
  resolve(app, 'pipeline/eval/run.json'),
  resolve(app, '../pipeline/eval/run.json'),
].filter(Boolean);
const src = candidates.find((p) => existsSync(p));
if (!src) {
  console.log('run.json not found; keeping the bundled src/data/proof.json.');
  process.exit(0);
}

const evalDir = dirname(src);
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

// Read fast_run.json if present (W1)
const fastPath = resolve(evalDir, 'fast_run.json');
let fastRun = {
  pending: true,
  source: null,
  time_to_model_s: null,
  time_to_checker_s: null,
  dispatch_call_s: null,
  stitch_ms: null,
  cost_usd: null,
};
if (existsSync(fastPath)) {
  const f = JSON.parse(readFileSync(fastPath, 'utf8'));
  fastRun = {
    pending: false,
    source: 'pipeline/eval/fast_run.json',
    mode: f.mode ?? 'live',
    time_to_model_s: f.time_to_model_s ?? f.model_seconds ?? f.wall_seconds ?? f.fast?.time_to_model_s ?? null,
    time_to_checker_s: f.time_to_checker_s ?? f.checker_seconds ?? f.fast?.time_to_checker_s ?? null,
    dispatch_call_s: f.dispatch_call_s ?? f.dispatch_seconds ?? f.dispatch_call?.seconds ?? f.dispatch?.seconds ?? null,
    dispatch_text: f.dispatch_call?.text ?? null,
    dispatch_reports: (f.dispatch_call?.result?.reports ?? []).map((r) => ({ space_id: r.space_id, kind: r.kind, text: r.text })),
    stitch_ms: f.stitch_and_invariants_ms ?? f.stitch_ms ?? f.fast?.stitch_ms ?? null,
    cost_usd: f.cost_usd ?? f.totals?.cost_usd ?? f.fast?.cost_usd ?? null,
    lanes: Object.entries(f.per_agent ?? {})
      .filter(([k]) => k.startsWith('reader:'))
      .map(([agent, v]) => ({ agent, seconds: v.seconds })),
  };
}

// Read investigations.json if present (W2)
const invPath = resolve(evalDir, 'investigations.json');
let investigations = {
  pending: true,
  source: null,
  count: null,
  wall_seconds: null,
  cost_usd: null,
  note7: null,
};
if (existsSync(invPath)) {
  const inv = JSON.parse(readFileSync(invPath, 'utf8'));
  const list = inv.investigations ?? inv.results ?? inv.items ?? (Array.isArray(inv) ? inv : []);
  const note7Entry =
    list.find((x) => x.element_id === 'door-f4-stair-c' || x.reply?.element_id === 'door-f4-stair-c' || x.element_ids?.includes('door-f4-stair-c')) ??
    list.find((x) => String(x.reply?.question ?? x.question ?? '').toLowerCase().includes('note 7')) ??
    null;
  const note7Reply = note7Entry?.reply ?? note7Entry;
  const totalCost = inv.cost_usd ?? inv.totals?.cost_usd ?? list.reduce((acc, x) => acc + (x.cost_usd ?? 0), 0);
  investigations = {
    pending: false,
    source: 'pipeline/eval/investigations.json',
    count: list.length,
    wall_seconds: inv.wall_seconds ?? inv.totals?.wall_seconds ?? null,
    cost_usd: Math.round(totalCost * 10000) / 10000,
    note7: note7Reply
      ? {
          element_id: note7Reply.element_id ?? 'door-f4-stair-c',
          question: note7Reply.question ?? null,
          probable_meaning: note7Reply.probable_meaning ?? null,
          evidence: note7Reply.evidence ?? [],
          confidence: note7Reply.confidence ?? null,
          keep_status: note7Reply.keep_status ?? 'drafted_awaiting_review',
          seconds: note7Entry?.agent_seconds ?? note7Reply.seconds ?? null,
          cost_usd: note7Entry?.cost_usd ?? note7Reply.cost_usd ?? null,
        }
      : null,
  };
}

// Read decisions_run.json if present (Decisions API dispatch mapping)
const decPath = resolve(evalDir, 'decisions_run.json');
let decisions = { pending: true, source: null };
if (existsSync(decPath)) {
  const d = JSON.parse(readFileSync(decPath, 'utf8'));
  const ok = (d.calls ?? []).filter((c) => !c.error);
  const ex = (c) => ({
    case: c.case,
    text: c.text,
    latency_ms: c.latency_ms,
    needs_confirmation: c.needs_confirmation,
    target: { choice: c.answers.target.choice, probability: c.answers.target.probability },
    condition: { choice: c.answers.condition.choice, probability: c.answers.condition.probability },
    kind: { choice: c.answers.kind.choice, probability: c.answers.kind.probability },
  });
  decisions = {
    pending: false,
    source: 'pipeline/eval/decisions_run.json',
    status: d.status,
    model: d.model,
    threshold: d.threshold,
    started: d.started,
    median_ms: d.latency_ms?.median ?? null,
    min_ms: d.latency_ms?.min ?? null,
    max_ms: d.latency_ms?.max ?? null,
    baseline_ms: d.baseline?.latency_ms ?? null,
    baseline_model: d.baseline?.model ?? null,
    examples: ok.map(ex),
  };
}

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
  fast_run: fastRun,
  investigations,
  decisions,
};

writeFileSync(resolve(app, 'src/data/proof.json'), JSON.stringify(proof, null, 1) + '\n');
console.log(
  'Wrote src/data/proof.json from',
  src,
  `(fast_run: ${fastRun.pending ? 'pending' : 'synced'}, investigations: ${investigations.pending ? 'pending' : 'synced'}, decisions: ${decisions.pending ? 'pending' : 'synced'})`,
);
