import React, { useMemo, useState } from 'react';
import Scene, { TARGET } from './Scene.jsx';
import { findRoutes, resolveConditions } from './engine/routing.js';
import { model, elementOf } from './geometry.js';
import { narrate, routeSummary, flagText, placeName } from './narrate.js';
import { ElevatorExcludedIcon, FireDoorIcon, ReportPinIcon, StairIcon } from './NfpaSymbols.jsx';

const SHEET_FILE = (id) => `${import.meta.env.BASE_URL}sheets/${id}.png`;
// Where the general-notes list sits on every sheet (same title block on all sheets).
const NOTES_REGION = [0.815, 0.185, 0.99, 0.475];

const STEPS = [
  { title: 'Dispatch', time: '2:14 AM' },
  { title: 'Orient', time: '2:15 AM' },
  { title: 'What if', time: '2:15 AM' },
  { title: 'Where it comes out', time: '2:15 AM' },
  { title: 'And that door?', time: '2:16 AM' },
  { title: 'Report arrives', time: '2:16 AM' },
  { title: 'Drop the what-ifs', time: '2:17 AM' },
  { title: 'Verified', time: '2:21 AM' },
];

const FOCUS = {
  overview: { anchor: null, zoom: 17 },
  floor4: { anchor: { x: 15, y: 7, floor: 4 }, zoom: 26 },
  nehall: { anchor: { x: 20.5, y: 8.5, floor: 4 }, zoom: 42 },
  lobby: { anchor: { x: 12, y: 7, floor: 4 }, zoom: 36 },
};

const INITIAL = { step: 0, conditions: [], focus: FOCUS.overview, sheet: null, seq: 0, clock: '2:14 AM' };

function makeCondition(state, kind, target_id, source, extra = {}) {
  const seq = state.seq + 1;
  return {
    seq,
    cond: {
      condition_id: `cond-${String(seq).padStart(3, '0')}`,
      target_id,
      kind,
      timestamp: state.clock,
      source,
      ...extra,
    },
  };
}

export default function App({ embedded = false, onNavigate }) {
  const [history, setHistory] = useState([INITIAL]);
  const [exploded, setExploded] = useState(true);
  const [sortBy, setSortBy] = useState('default');
  const [selected, setSelected] = useState(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const state = history[history.length - 1];

  const push = (next) => {
    setHistory((h) => [...h, { ...h[h.length - 1], ...next }]);
    setVerifyOpen(false);
  };
  const undo = () => {
    setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
    setVerifyOpen(false);
    setSelected(null);
  };
  const reset = () => {
    setHistory([INITIAL]);
    setSortBy('default');
    setSelected(null);
    setVerifyOpen(false);
  };

  const append = (kind, target_id, source, next = {}, extra = {}) => {
    const { seq, cond } = makeCondition({ ...state, clock: next.clock ?? state.clock }, kind, target_id, source, extra);
    push({ ...next, seq, conditions: [...state.conditions, cond] });
  };

  const result = useMemo(() => findRoutes(model, TARGET, state.conditions, { sortBy }), [state.conditions, sortBy]);
  const baseline = useMemo(() => findRoutes(model, TARGET, []), []);
  const story = narrate(result);

  // Current, folded view of every condition, for the three separate lanes.
  const folded = useMemo(() => resolveConditions(state.conditions), [state.conditions]);
  const lanes = useMemo(() => {
    const assumptions = [];
    const reports = [];
    const verified = [];
    for (const [key, s] of folded) {
      for (const a of s.assumptions.values()) assumptions.push({ ...a, key });
      for (const r of s.reports) reports.push({ ...r, key });
      if (s.blocked) verified.push({ ...s.blocked, key, state: 'blocked' });
      if (s.verifiedClear) verified.push({ ...s.verifiedClear, key, state: 'clear' });
    }
    return { assumptions, reports, verified };
  }, [folded]);

  const conditionsView = [
    ...lanes.assumptions.map((c) => ({ ...c, state: 'assumed', time: c.timestamp })),
    ...lanes.reports.map((c) => ({ ...c, state: 'reported', time: c.timestamp })),
    ...lanes.verified.map((c) => ({ ...c, time: c.timestamp })),
  ];

  const unclearIds = model.layout.openings.filter((o) => o.layout_status === 'drafted_awaiting_review').map((o) => o.id);

  // ---- scripted actions ----
  const go = {
    open: () => push({ step: 1, focus: FOCUS.overview, clock: '2:15 AM' }),
    assumeLobby: () =>
      append(
        'assumed_unavailable',
        'f4-east-lobby',
        { actor: 'Officer', trigger: 'tap', prompt: 'Assume east lobby unavailable' },
        { step: 2, focus: FOCUS.floor4 },
      ),
    whereOut: () => push({ step: 3, focus: FOCUS.nehall, sheet: 'door-f4-stair-c' }),
    assumeDoor: () =>
      append(
        'assumed_unavailable',
        'door-f4-stair-c',
        { actor: 'Officer', trigger: 'tap', prompt: 'Assume that door unavailable too' },
        { step: 4, focus: FOCUS.floor4, sheet: null, clock: '2:16 AM' },
      ),
    report: () =>
      append(
        'reported',
        'f4-east-lobby',
        {
          actor: 'Caller',
          channel: '911 relay',
          verbatim: 'smoke in the hallway by the elevator',
          pinned_note: 'Elevator E1 opens into the floor-4 east lobby',
        },
        { step: 5, focus: FOCUS.lobby, clock: '2:16 AM' },
      ),
    dropAssumptions: () => {
      let seq = state.seq;
      const extra = lanes.assumptions.map((a) => {
        seq += 1;
        return {
          condition_id: `cond-${String(seq).padStart(3, '0')}`,
          target_id: a.target_id,
          kind: 'assumption_cleared',
          timestamp: '2:17 AM',
          source: { actor: 'Officer', clears_condition_id: a.condition_id },
        };
      });
      push({ step: 6, seq, conditions: [...state.conditions, ...extra], focus: FOCUS.floor4, clock: '2:17 AM' });
    },
    verify: (kind) =>
      append(
        kind,
        'f4-east-lobby',
        {
          unit: 'Engine 7',
          actor: 'Engine 7 officer',
          note: kind === 'verified_blocked' ? 'Heavy smoke, lobby not passable' : 'Light haze only, passable',
        },
        { step: 7, focus: FOCUS.floor4, clock: '2:21 AM' },
      ),
  };

  const clearAssumption = (a) =>
    append('assumption_cleared', a.target_id, { actor: 'Officer', clears_condition_id: a.condition_id });

  const assumeSelected = () => {
    if (!selected) return;
    append('assumed_unavailable', selected.split('@')[0], {
      actor: 'Officer',
      trigger: 'tap',
      prompt: `Assume ${placeName(selected)} unavailable`,
    });
    setSelected(null);
  };

  const chips = (() => {
    switch (state.step) {
      case 0:
        return [{ label: 'Open Marlowe House', on: go.open, primary: true }];
      case 1:
        return [{ label: 'Assume east lobby unavailable', on: go.assumeLobby, assume: true }];
      case 2:
        return [{ label: 'Show me where it comes out', on: go.whereOut, primary: true }];
      case 3:
        return [{ label: 'Assume that door unavailable too', on: go.assumeDoor, assume: true }];
      case 4:
        return [{ label: 'Next: radio traffic, 2:16 AM', on: go.report, primary: true }];
      case 5:
        return lanes.assumptions.length
          ? [{ label: 'Drop the what-ifs', on: go.dropAssumptions, primary: true }]
          : [{ label: 'Tap the report to verify it', on: () => setVerifyOpen(true), primary: true }];
      case 6:
        return [
          { label: '✕ Engine 7: lobby verified blocked', on: () => go.verify('verified_blocked'), blocked: true },
          { label: '✓ Engine 7: lobby verified clear', on: () => go.verify('verified_clear'), primary: true },
        ];
      default:
        return [{ label: 'Start over', on: reset }];
    }
  })();

  const stepText = (() => {
    switch (state.step) {
      case 0:
        return null;
      case 3:
        return {
          headline: 'Stair C comes out into the floor-4 north-east hall, then the east corridor, then 4C.',
          body: 'The door is drawn on sheet A-4, but it is annotated "F.D. — see note 7", and note 7 is missing from the sheet. The notes go 6, then 8. Verify this door on arrival.',
        };
      case 5:
        return {
          headline: 'Caller, 2:16 AM: "smoke in the hallway by the elevator."',
          body: 'Pinned to the floor-4 east lobby (elevator E1 opens there) as unverified. A report does not close anything; it flags the routes that pass it. It stays separate from your assumptions.',
        };
      default:
        return story;
    }
  })();

  const sheetEl = state.sheet ? elementOf(state.sheet) : null;
  const selectedEl = selected ? elementOf(selected) : null;
  const reportForVerify = lanes.reports[0];

  return (
    <div className={`app${embedded ? ' embedded' : ''}`}>
      <header className="titlebar">
        <div className="brand">
          {embedded ? (
            <strong>FLARE</strong>
          ) : (
            <a
              className="brand-link"
              href="/"
              onClick={(e) => {
                if (onNavigate) {
                  e.preventDefault();
                  onNavigate('/');
                }
              }}
            >
              <strong>FLARE</strong>
            </a>
          )}{' '}
          <span>Marlowe House · 142–144 Marlowe St · fictional test building</span>
        </div>
        <div className="tools">
          <label className="toggle">
            <input type="checkbox" checked={exploded} onChange={(e) => setExploded(e.target.checked)} /> Exploded floor stack
          </label>
          <button className="btn" onClick={undo} disabled={history.length < 2}>
            ↶ Undo
          </button>
          <button className="btn ghost" onClick={reset}>
            Reset
          </button>
          {embedded ? (
            <a
              className="btn ghost"
              href="/demo"
              onClick={(e) => {
                if (onNavigate) {
                  e.preventDefault();
                  onNavigate('/demo');
                }
              }}
            >
              Full screen
            </a>
          ) : (
            <a
              className="btn ghost"
              href="/"
              onClick={(e) => {
                if (onNavigate) {
                  e.preventDefault();
                  onNavigate('/');
                }
              }}
            >
              Story
            </a>
          )}
        </div>
      </header>

      <div className="lanes">
        <div className="lane lane-facts">
          <h4>Facts · from the drawings</h4>
          <span className="chip fact">
            <StairIcon size={12} /> 3 entrances · 3 stairs · E1 excluded
          </span>
          {result.chokepoints.confirmed.primary && result.status === 'ok' && (
            <span className="chip fact">Shared: {placeName(result.chokepoints.confirmed.primary.id)}</span>
          )}
          <span className="chip unclear">
            <FireDoorIcon size={12} /> Unclear drawing: Stair C floor-4 door
          </span>
        </div>
        <div className="lane lane-reports">
          <h4>Reports &amp; field verifications</h4>
          {lanes.reports.length === 0 && lanes.verified.length === 0 && <span className="empty">none yet</span>}
          {lanes.reports.map((r) => (
            <button key={r.condition_id} className="chip report" onClick={() => setVerifyOpen(true)}>
              <ReportPinIcon size={12} color="#b45309" /> “{r.source.verbatim}” · {r.source.actor}, {r.timestamp} (unverified)
            </button>
          ))}
          {lanes.verified.map((v) => (
            <span key={v.condition_id} className={`chip ${v.state === 'blocked' ? 'vblocked' : 'vclear'}`}>
              {v.state === 'blocked' ? '✕ Verified blocked' : '✓ Verified clear'}: {placeName(v.key)} · {v.source.unit}, {v.timestamp}
            </span>
          ))}
        </div>
        <div className="lane lane-assume">
          <h4>Assumptions · what-ifs</h4>
          {lanes.assumptions.length === 0 && <span className="empty">none</span>}
          {lanes.assumptions.map((a) => (
            <span key={a.condition_id} className="chip assume">
              IF {placeName(a.key)} unavailable
              <button title="Undo this assumption" onClick={() => clearAssumption(a)}>
                undo ✕
              </button>
            </span>
          ))}
        </div>
      </div>

      <main className="stage">
        <div className="canvas-wrap">
          <Scene
            result={result}
            baseline={baseline}
            conditionsView={conditionsView}
            exploded={exploded}
            focus={state.focus}
            selected={selected}
            onSelect={setSelected}
            onPin={() => setVerifyOpen(true)}
            unclearIds={unclearIds}
            embedded={embedded}
          />
          <div className="legend">
            <div><i className="sw ink" /> documented route</div>
            <div><i className="sw grey" /> closed by a condition</div>
            <div><i className="sw amber" /> unverified report / unclear drawing</div>
            <div><i className="sw assume" /> assumption (what-if)</div>
            <div><i className="sw blocked" /> verified blocked (heavy ink X)</div>
          </div>

          {selectedEl && (
            <div className="popover">
              <div className="pop-title">{placeName(selected)}</div>
              <div className="pop-meta">
                Sheet {selectedEl.source_ref?.sheet ?? '—'} ·{' '}
                {selectedEl.layout_status === 'drafted_awaiting_review' ? 'drawing unclear' : 'on plan'}
                {selectedEl.kind === 'elevator' && ' · not for fire service use, excluded from routes'}
              </div>
              {selectedEl.review_note && <div className="pop-note">{selectedEl.review_note}</div>}
              <div className="pop-actions">
                {selectedEl.kind !== 'elevator' && selected !== TARGET && (
                  <button className="chip-btn assume" onClick={assumeSelected}>
                    Assume unavailable
                  </button>
                )}
                {selectedEl.source_ref && (
                  <button className="chip-btn" onClick={() => push({ sheet: selected.split('@')[0] })}>
                    Show on sheet
                  </button>
                )}
                <button className="chip-btn ghost" onClick={() => setSelected(null)}>
                  Close
                </button>
              </div>
            </div>
          )}

          {verifyOpen && reportForVerify && (
            <div className="popover verify">
              <div className="pop-title">Report · unverified</div>
              <div className="pop-note">
                “{reportForVerify.source.verbatim}” · {reportForVerify.source.actor}, {reportForVerify.timestamp}. Pinned to{' '}
                {placeName(reportForVerify.key)}.
              </div>
              <div className="pop-actions">
                <button className="chip-btn blocked" onClick={() => go.verify('verified_blocked')}>
                  ✕ Verified blocked
                </button>
                <button className="chip-btn" onClick={() => go.verify('verified_clear')}>
                  ✓ Verified clear
                </button>
                <button className="chip-btn ghost" onClick={() => setVerifyOpen(false)}>
                  Not yet
                </button>
              </div>
            </div>
          )}
        </div>

        <aside className="panel">
          <div className="steps">
            {STEPS.map((s, i) => (
              <span
                key={i}
                className={`dot ${i === state.step ? 'on' : ''} ${i < state.step ? 'done' : ''}`}
                title={s.title}
              />
            ))}
            <span className="step-label">
              {state.step + 1}/{STEPS.length} · {STEPS[state.step].title}
            </span>
          </div>

          {state.step === 0 ? (
            <div className="dispatch">
              <div className="dispatch-head">DISPATCH · 2:14 AM</div>
              <div className="dispatch-body">Smoke reported near 4C, Marlowe House, 2:14 AM.</div>
              <div className="dispatch-meta">142–144 Marlowe St · 5 stories · Apartment 4C, floor 4</div>
            </div>
          ) : (
            <div className={`answer ${result.status === 'no_route' ? 'no-route' : ''}`}>
              <div className="answer-head">{stepText.headline}</div>
              {stepText.body && <p>{stepText.body}</p>}
            </div>
          )}

          <div className="chips">
            {chips.map((c) => (
              <button
                key={c.label}
                className={`chip-btn ${c.assume ? 'assume' : ''} ${c.blocked ? 'blocked' : ''} ${c.primary ? 'primary' : ''}`}
                onClick={c.on}
              >
                {c.assume && 'IF · '}
                {c.label}
              </button>
            ))}
          </div>

          {state.sheet && sheetEl?.source_ref && (
            <div className="sheet-panel">
              <div className="sheet-head">
                Sheet {sheetEl.source_ref.sheet} · {sheetEl.source_ref.callout || placeName(state.sheet)}
                <button className="x" onClick={() => push({ sheet: null })}>
                  ✕
                </button>
              </div>
              {sheetEl.layout_status === 'drafted_awaiting_review' ? (
                <>
                  <div className="sheet-crops-grid">
                    <SheetCrop
                      sheet={sheetEl.source_ref.sheet}
                      region={sheetEl.source_ref.region_norm}
                      highlight
                      unclear
                    />
                    <SheetCrop sheet={sheetEl.source_ref.sheet} region={NOTES_REGION} pad={[0, 0]} />
                  </div>
                  <div className="sheet-caption amber">
                    “F.D. — see note 7.” General notes on this sheet go 6, then 8: note 7 is missing.
                  </div>
                </>
              ) : (
                <SheetCrop sheet={sheetEl.source_ref.sheet} region={sheetEl.source_ref.region_norm} highlight />
              )}
            </div>
          )}

          {state.step > 0 && (
            <div className="routes">
              <div className="routes-head">
                <h4>Routes to 4C</h4>
                <div className="sort-toggle" role="group" aria-label="Sort routes">
                  <button
                    type="button"
                    className={sortBy === 'default' ? 'is-active' : ''}
                    onClick={() => setSortBy('default')}
                  >
                    Fewest unknowns
                  </button>
                  <button
                    type="button"
                    className={sortBy === 'distance' ? 'is-active' : ''}
                    onClick={() => setSortBy('distance')}
                  >
                    Shortest
                  </button>
                </div>
              </div>
              {result.routes.length === 0 && <div className="no-route-box">No documented route.</div>}
              {result.routes.map((r) => (
                <div key={r.id} className="route">
                  <div className="route-line">
                    <b>{r.rank}.</b> {routeSummary(r)}
                  </div>
                  <div className="route-meta">
                    {r.distance_m} m · {r.floor_changes} floors ·{' '}
                    {r.open_questions === 0
                      ? 'no open questions'
                      : `${r.open_questions} open question${r.open_questions > 1 ? 's' : ''}`}
                  </div>
                  {r.flags.map((f, i) => (
                    <div key={i} className={`flag flag-${f.type}`}>
                      {flagText(f)}
                    </div>
                  ))}
                </div>
              ))}
              <div className="excluded">
                <ElevatorExcludedIcon size={14} />{' '}
                <span>Elevator E1 is shown but never routed: not for fire service use (sheet A-4, note 3).</span>
              </div>
            </div>
          )}
        </aside>
      </main>
      <footer className="foot">
        Routes are computed in your browser from the building model. Tap a room, door or stair to inspect it or assume it unavailable.
      </footer>
    </div>
  );
}

function SheetCrop({ sheet, region, highlight, unclear, pad = [0.11, 0.2] }) {
  const meta = model.sheets.find((s) => s.id === sheet);
  const aspect = meta.width_px / meta.height_px;
  const x0 = Math.max(0, region[0] - pad[0]);
  const y0 = Math.max(0, region[1] - pad[1]);
  const x1 = Math.min(1, region[2] + pad[0]);
  const y1 = Math.min(1, region[3] + pad[1]);
  const cw = x1 - x0;
  const ch = y1 - y0;
  const ratio = ch / cw / aspect;
  return (
    <div className="crop" style={{ paddingTop: `${ratio * 100}%` }}>
      <div className="crop-inner">
        <img
          src={SHEET_FILE(sheet)}
          alt={`Sheet ${sheet}`}
          style={{
            width: `${100 / cw}%`,
            left: `${(-x0 / cw) * 100}%`,
            top: `${(-y0 / ch) * 100}%`,
            height: `${100 / ch}%`,
          }}
        />
        {highlight && (
          <div
            className={`crop-box ${unclear ? 'amber' : ''}`}
            style={{
              left: `${((region[0] - x0) / cw) * 100}%`,
              top: `${((region[1] - y0) / ch) * 100}%`,
              width: `${((region[2] - region[0]) / cw) * 100}%`,
              height: `${((region[3] - region[1]) / ch) * 100}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}
