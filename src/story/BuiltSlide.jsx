import React from 'react';
import proof from '../data/proof.json';
import { model } from '../geometry.js';
import './built.css';

// Slide 04: how Flare builds the map (agents) and routes (code). Plain-English actions, one-line subtitles.
// Every number comes from proof.json or the model data.
const BASE = import.meta.env.BASE_URL;
const FAST = proof.fast_run && !proof.fast_run.pending ? proof.fast_run : null;
const INV = proof.investigations && !proof.investigations.pending ? proof.investigations : null;
const RENDER = proof.readers?.['A-4']?.render_match ?? [];
const L = model.layout;
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const money = (x) => `$${x.toFixed(2)}`;
const fmtTime = (s) => {
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m} min ${r} s`;
};
const STITCH = FAST?.stitch_ms != null ? `${Math.max(1, Math.round(FAST.stitch_ms))} ms` : null;
const PARSE = FAST?.dispatch_call_s != null ? `${FAST.dispatch_call_s.toFixed(1)} s` : null;
const NOTE7_SHEETS = (INV?.note7?.evidence ?? []).filter((e) => e.sheet !== 'A-4' && e.quote.includes('GENERAL NOTES')).map((e) => e.sheet);

// A real report from the dispatch call (fast_run.json), with the space it was mapped to.
const LOBBY_REPORT = (() => {
  const r = (FAST?.dispatch_reports ?? []).find((x) => x.space_id && x.space_id.includes('lobby')) ?? FAST?.dispatch_reports?.[0];
  if (!r) return null;
  const space = L.spaces.find((s) => s.id === r.space_id);
  const label = (space?.label ?? r.space_id).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return { text: r.text, place: label };
})();

const STEPS = [
  { no: '01', verb: 'Read plans', sub: 'Managed Agents read each sheet in parallel: rooms, doors, stairs' },
  { no: '02', verb: 'Stack in 3D', sub: `Plain code connects stairs and shafts across floors${STITCH ? ` (${STITCH})` : ''}` },
  {
    no: '03',
    verb: 'Self-check',
    sub: `Checker + ${INV?.count != null ? `${INV.count} ` : ''}investigator Managed Agents fix misreads and cite missing notes`,
    hi: true,
  },
  { no: '04', verb: 'Route live', sub: `Gemini parses updates${PARSE ? ` (${PARSE})` : ''} · browser code computes paths in milliseconds` },
];

function RenderCompare() {
  const spaces = L.spaces.filter((s) => s.floor === 4 && s.source_ref?.sheet === 'A-4' && s.source_ref.region_norm);
  const H = 1300 / 2000;
  return (
    <div className="bt-rc">
      <div className="bt-sheet" role="img" aria-label="Sheet A-4 with the agent's redrawn rooms overlaid (illustrative)">
        <img src={`${BASE}sheets/A-4.png`} alt="" />
        <svg viewBox={`0 0 1 ${H}`} preserveAspectRatio="none" aria-hidden="true">
          {spaces.map((s) => {
            const [x0, y0, x1, y1] = s.source_ref.region_norm;
            return <rect key={s.id} x={x0} y={y0 * H} width={x1 - x0} height={(y1 - y0) * H} />;
          })}
        </svg>
      </div>
      {RENDER.length > 0 && (
        <div className="bt-passes" aria-label="Render match per pass on sheet A-4">
          <span className="muted">Render match · A-4 · illustrative overlay</span>
          {RENDER.map((v, i) => (
            <div className="bt-pass" key={i}>
              <span>Pass {i + 1}</span>
              <div className="bar">
                <i style={{ width: `${v * 100}%` }} />
              </div>
              <b>{pct(v)}</b>
            </div>
          ))}
          <span className="muted">Agents redraw what they read over the sheet and fix misalignments.</span>
        </div>
      )}
    </div>
  );
}

export default function BuiltSlide() {
  return (
    <div className="built">
      <header className="bt-head">
        <h2>How Flare builds the map with Gemini, and routes in milliseconds with code.</h2>
      </header>

      <ol className="bt-line">
        {STEPS.map((s) => (
          <li key={s.no} className={s.hi ? 'hi' : ''}>
            <span className="dot" aria-hidden="true" />
            <span className="bt-k">
              <span className="n">{s.no}</span>
              {s.verb}
            </span>
            <span className="bt-sub">{s.sub}</span>
          </li>
        ))}
      </ol>

      <div className="bt-cards">
        <section className="bt-card">
          <h3 className="bt-card-t">1. Managed Agents verify each sheet, and flag gaps instead of guessing.</h3>
          <p className="muted">
            Verified build: {fmtTime(proof.wall_seconds)} ({money(proof.totals.cost_usd)})
            {FAST?.time_to_model_s != null &&
              ` · Unmapped fast draft: ${Math.round(FAST.time_to_model_s)} s${FAST.cost_usd != null ? ` (${money(FAST.cost_usd)})` : ''}`}
          </p>
          <RenderCompare />
          <p className="bt-n7">
            <span className="muted">Missing info:</span> A-4: “see note 7” (missing)
            <span className="sep">→</span>
            Investigator finds note 7 on {NOTE7_SHEETS.length ? NOTE7_SHEETS.join(', ') : 'other sheets'}
            <span className="sep">→</span>
            Attaches quote · stays <span className="ochre">“unverified”</span>
          </p>
        </section>
        <section className="bt-card">
          <h3 className="bt-card-t">2. AI translates the radio and chat; plain code owns the routes.</h3>
          <ul className="bt-inputs">
            <li>
              <b>3D building map</b>
              <span className="muted">stairs and halls, no elevators</span>
            </li>
            <li>
              <b className="nowrap">Radio / call{PARSE ? ` · ${PARSE}` : ''}</b>
              <span className="muted">{LOBBY_REPORT ? `e.g. “${LOBBY_REPORT.text}” → ${LOBBY_REPORT.place}` : 'a report mapped onto the model'}</span>
            </li>
            <li>
              <b>Officer chat</b>
              <span className="muted">“lobby not available” → what-if</span>
            </li>
          </ul>
          <i className="bt-conn" aria-hidden="true" />
          <p className="bt-code">
            <b>Plain code computes routes in milliseconds</b> <span className="muted">· AI never picks a path or cuts through apartments</span>
          </p>
          <i className="bt-conn" aria-hidden="true" />
          <ul className="bt-outs">
            <li className="open">
              <b>Open</b> <span className="muted">clear route</span>
            </li>
            <li className="flag">
              <b>Flagged</b> <span className="muted">unverified report, warns but stays open</span>
            </li>
            <li className="closed">
              <b>Closed</b> <span className="muted">what-if or verified blocked</span>
            </li>
          </ul>
        </section>
      </div>

    </div>
  );
}
