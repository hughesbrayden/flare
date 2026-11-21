import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import App from '../App.jsx';
import IsoBuilding from './IsoBuilding.jsx';
import { ClockFigure, LanesFigure, PinSectionFigure } from './Figures.jsx';
import FlareSlide, { FLARE_BEATS } from './FlareSlide.jsx';
import BuiltSlide from './BuiltSlide.jsx';
import { SOURCES, SOURCE_ORDER } from './sources.js';
import proof from '../data/proof.json';
import { StairIcon, ReportPinIcon } from '../NfpaSymbols.jsx';

const BASE = import.meta.env.BASE_URL;
const CHAPTERS = [
  { id: 'problem', no: '01', title: 'The problem' },
  { id: 'solution', no: '02', title: 'Flare' },
  { id: 'landscape', no: '03', title: 'What exists today' },
  { id: 'built', no: '04', title: 'How we built it' },
];

const DeckCtx = createContext({ showSource: () => {}, onNavigate: null, demoReady: false, engaged: false, setEngaged: () => {} });

/* ---------- numbers, all from proof.json ---------- */

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m} min ${r} s`;
}

const FAST = proof.fast_run && !proof.fast_run.pending ? proof.fast_run : null;
const INV = proof.investigations && !proof.investigations.pending ? proof.investigations : null;
const READERS = proof.lanes.filter((l) => l.role === 'reader');
const N = {
  wall: fmtTime(proof.wall_seconds),
  cost: `$${proof.totals.cost_usd.toFixed(2)}`,
  flags: proof.checker_flags.length,
  readersMin: Math.round(Math.min(...READERS.map((l) => l.seconds))),
  readersMax: Math.round(Math.max(...READERS.map((l) => l.seconds))),
  model: FAST?.time_to_model_s ? `${Math.round(FAST.time_to_model_s)} s` : 'about 35 s',
  checkerBg: FAST?.time_to_checker_s ? `${Math.round(FAST.time_to_checker_s)} s` : null,
  dispatch: FAST?.dispatch_call_s ? `${FAST.dispatch_call_s.toFixed(1)} s` : 'about 5 s',
  stitch: FAST?.stitch_ms != null ? `${Math.round(FAST.stitch_ms)} ms` : '4 ms',
  runDate: proof.started.slice(0, 10),
};

/* ---------- small helpers ---------- */

function Cite({ id }) {
  const { showSource } = useContext(DeckCtx);
  const s = SOURCES[id];
  return (
    <a
      className="cite"
      href={`#src-${id}`}
      title={s.full}
      onClick={(e) => {
        e.preventDefault();
        showSource(id);
      }}
    >
      {s.short}
    </a>
  );
}

function Cites({ ids }) {
  return (
    <>
      Source{ids.length > 1 ? 's' : ''}:{' '}
      {ids.map((id, i) => (
        <React.Fragment key={id}>
          {i > 0 && ' · '}
          <Cite id={id} />
        </React.Fragment>
      ))}
    </>
  );
}

function DemoLink({ children, className }) {
  const { onNavigate } = useContext(DeckCtx);
  return (
    <a
      className={className}
      href="/demo"
      onClick={(e) => {
        if (onNavigate) {
          e.preventDefault();
          onNavigate('/demo');
        }
      }}
    >
      {children}
    </a>
  );
}

function Big({ value, children, tone }) {
  return (
    <div className={`big ${tone || ''}`}>
      <span className="big-v">{value}</span>
      <small>{children}</small>
    </div>
  );
}

function Crop({ sheet, region, box, label }) {
  const [x0, y0, x1, y1] = region;
  const cw = x1 - x0;
  const ch = y1 - y0;
  const aspect = 2000 / 1300;
  return (
    <figure className="crop-fig">
      <div className="crop" style={{ paddingTop: `${(ch / cw / aspect) * 100}%` }}>
        <div className="crop-inner">
          <img
            src={`${BASE}sheets/${sheet}.png`}
            alt={`Detail of sheet ${sheet}`}
            loading="lazy"
            style={{ width: `${100 / cw}%`, height: `${100 / ch}%`, left: `${(-x0 / cw) * 100}%`, top: `${(-y0 / ch) * 100}%` }}
          />
          {box && (
            <div
              className="crop-box amber"
              style={{
                left: `${((box[0] - x0) / cw) * 100}%`,
                top: `${((box[1] - y0) / ch) * 100}%`,
                width: `${((box[2] - box[0]) / cw) * 100}%`,
                height: `${((box[3] - box[1]) / ch) * 100}%`,
              }}
            />
          )}
        </div>
      </div>
      {label && <figcaption>{label}</figcaption>}
    </figure>
  );
}

function Legend({ items }) {
  return (
    <div className="legend-b">
      {items.map(([kind, text]) => (
        <span key={kind}>
          <i className={`lk ${kind}`} />
          {text}
        </span>
      ))}
    </div>
  );
}

/* ---------- figures specific to the deck ---------- */

function Note7Figure() {
  const note7 = INV?.note7;
  const others = (note7?.evidence ?? []).filter((e) => e.sheet !== 'A-4' && e.quote.includes('GENERAL NOTES'));
  return (
    <div className="note7">
      <Crop
        sheet="A-4"
        region={[0.62, 0.05, 0.99, 0.45]}
        box={[0.7245, 0.3108, 0.7605, 0.3662]}
        label="Sheet A-4: the Stair C door callout (dashed box) and the general notes, which skip 7."
      />
      <div className="card">
        <div className="card-head">Investigator agent · note 7</div>
        {others.length > 0 ? (
          others.map((ev) => (
            <div className="row" key={ev.sheet}>
              <div className="sh">{ev.sheet}</div>
              <div>“{ev.quote.split('GENERAL NOTES: ')[1] ?? ev.quote}”</div>
            </div>
          ))
        ) : (
          <div className="row">
            <div className="sh">Sheets</div>
            <div>Checks whether note 7 appears on another sheet, and attaches the exact citation.</div>
          </div>
        )}
        <div className="row">
          <div className="sh">A-4</div>
          <div>General notes 1–6, then 8. No note 7.</div>
        </div>
        <div className="row">
          <div className="sh">Status</div>
          <div>
            <span className="tag-check">Still unverified · check the door on scene</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DemoFigure() {
  const { onNavigate, demoReady, engaged, setEngaged } = useContext(DeckCtx);
  const ref = useRef(null);
  return (
    <div
      className={`demo-frame ${engaged ? 'engaged' : ''}`}
      ref={ref}
      tabIndex={-1}
      onFocus={() => setEngaged(true)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setEngaged(false);
          if (document.activeElement && ref.current?.contains(document.activeElement)) document.activeElement.blur();
        }
      }}
    >
      {demoReady ? <App embedded onNavigate={onNavigate} /> : <div className="demo-wait">Loading the Marlowe House model…</div>}
      {engaged && <div className="demo-engaged">Arrow keys are with the demo · Esc to hand them back</div>}
    </div>
  );
}

function RunFigure() {
  const total = proof.wall_seconds;
  return (
    <div className="run-fig">
      <div className="fig-head">Managed Agents run · real times and estimated cost</div>
      <LanesFigure proof={proof} />
      {INV && (
        <div className="gantt inv-gantt">
          <div className="gantt-row">
            <div className="gantt-label">Investigators ×{INV.count}</div>
            <div className="gantt-track">
              <div className="gantt-bar role-investigator" style={{ left: 0, width: `${(INV.wall_seconds / total) * 100}%` }} />
            </div>
            <div className="gantt-meta">
              {Math.round(INV.wall_seconds)} s · ${INV.cost_usd.toFixed(2)}
            </div>
          </div>
        </div>
      )}
      <p className="src">
        Total {N.wall} · about {N.cost} · run of {N.runDate}
        {INV ? ' · investigators ran as a separate step, in parallel with each other' : ''}
      </p>
    </div>
  );
}

const COMPARE_COLS = ['Ready at dispatch', 'Small residential', 'Interactive what-ifs', 'Where the gap is'];
const COMPARE_ROWS = [
  {
    name: 'CAD & dispatch map pins',
    label: 'Our reading',
    cells: ['Yes', 'Address only', 'No', 'Stops at the street pin. No interior stairways, shared choke points, or floor-level routing.'],
  },
  {
    name: 'Paper or PDF pre-plans',
    label: 'Our reading',
    cells: ['Where filed', 'Rarely', 'No', 'Built mainly for high-risk sites; slow to read under time pressure and cannot recompute routes.'],
  },
  {
    name: 'Commercial 3D / BIM pre-plan tools',
    label: 'Our reading of the category',
    cells: ['Where scanned', 'Rarely', 'Limited', 'Requires site walks or BIM models that do not exist for most residential buildings.'],
  },
  {
    name: 'Indoor mapping research',
    label: 'Source: OGC 18-089',
    cells: ['Pilot only', 'Not the focus', 'Not the focus', 'Demonstrated scans-to-routes for pre-planning; not interactive call rehearsal.'],
  },
  {
    name: 'Flare',
    label: 'Prototype: one fictional building',
    cells: [
      'Pre-built from plans',
      'Built for them; not yet tried on a real one',
      'Yes (one-tap undo)',
      'Requires source drawings or permits; does not replace physical verification on scene.',
    ],
    ours: true,
  },
];

function CompareTable() {
  return (
    <div className="table-figure">
      <div className="fig-head">Our reading of each category · not a benchmark</div>
      <table className="compare">
        <thead>
          <tr>
            <th scope="col" />
            {COMPARE_COLS.map((c) => (
              <th key={c} scope="col">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARE_ROWS.map((r) => (
            <tr key={r.name} className={r.ours ? 'ours' : ''}>
              <th scope="row">
                {r.name}
                <span className="label">{r.label}</span>
              </th>
              {r.cells.map((c, i) => (
                <td key={i} data-col={COMPARE_COLS[i]}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="src">“Our reading” means our judgment from public material, not a measurement or a review of any one product.</p>
    </div>
  );
}

const GRID_COLS = ['No site walk needed', '3D floor-to-floor view', 'Finds routes and choke points', 'Reroutes when a path is blocked'];
const GRID_ROWS = [
  { name: 'Dispatch map pins (every call)', cells: ['yes', 'no', 'no', 'no'] },
  { name: '2D pre-plans (PDFs and apps)', cells: ['part', 'no', 'no', 'no'] },
  { name: '3D scan walkthroughs (LiDAR / BIM)', cells: ['no', 'yes', 'no', 'no'] },
  { name: 'Flare (on top of existing 2D plans)', ours: true, cells: ['yes', 'yes', 'yes', 'yes'] },
];
const MARK = { yes: '✓', part: '~', no: '✕' };
const MARK_LABEL = { yes: 'Yes', part: 'Partly', no: 'No' };

function CompareGrid() {
  return (
    <div className="cgrid">
      <table className="xtable">
        <thead>
          <tr>
            <th scope="col" />
            {GRID_COLS.map((c) => (
              <th key={c} scope="col">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {GRID_ROWS.map((r) => (
            <tr key={r.name} className={r.ours ? 'ours' : ''}>
              <th scope="row">{r.name}</th>
              {r.cells.map((c, i) => (
                <td key={i} className={c} aria-label={MARK_LABEL[c]}>{MARK[c]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="src">✓ yes · ~ partly · ✕ no. Flare still needs existing drawings or permit plans; most single-family homes don’t have them on file. Our reading of each category from public material, not a benchmark.</p>
    </div>
  );
}

/* ---------- the four slides ---------- */

const SLIDES = [
  // 01 · The problem (one screen)
  [
    {
      layout: 'single',
      noKicker: true,
      centerEvidence: true,
      h1: true,
      title: 'Once a fire starts, firefighters have minutes to react.',
      body: (
        <>
          <p>Inside, smoke cuts visibility and spreads through shared stairs beyond the burning unit.</p>
          <p>Crews enter a building they’ve never seen with an address, a unit, and little information on the layout.</p>
        </>
      ),
      visual: () => <ClockFigure />,
      evidence: [
        { v: '< 5 min', t: 'to flashover in rooms with modern furnishings (UL tests, 3:20–4:45)', ids: ['E7'] },
        { v: '3,920', t: 'people died in US fires in 2024. Home fires accounted for 75% of civilian fire deaths and injuries.', ids: ['E15'] },
        { v: '62%', t: 'of US civilian fire deaths happen in one- and two-family homes, which rarely get pre-plans', ids: ['E11', 'E12'] },
      ],
    },
  ],
  // 02 · Flare (one persistent view; beats play in place, see FlareSlide.jsx)
  [
    {
      layout: 'flare',
      beats: FLARE_BEATS,
      title: 'Flare',
    },
  ],
  // 03 · What exists today (one screen)
  [
    {
      layout: 'single-wide',
      noKicker: true,
      centerEvidence: true,
      title: 'Existing tools display static spaces. Flare works out how to get through them.',
      body: null,
      visual: () => <CompareGrid />,
      evidence: [
        { v: '9 units', t: 'inside one converted house, where a firefighter died disoriented in 2025, prompting federal calls to share layout changes with crews', ids: ['E8'] },
        { v: '81', t: 'firefighters in a randomized study rated 3D views above 2D plans alone for showing how to navigate (perception ratings)', ids: ['E4'] },
      ],
    },
  ],
  // 04 · How we built it (one screen, three zones; see BuiltSlide.jsx)
  [
    {
      layout: 'built',
      title: 'How we built it',
    },
  ],
];

/* ---------- frames ---------- */

const FRAMES = (() => {
  const out = [];
  SLIDES.forEach((steps, slide) => steps.forEach((st, step) => out.push({ slide, step, st, beats: st.beats || 1 })));
  out.push({ slide: CHAPTERS.length, step: 0, sources: true });
  return out;
})();
const FIRST_OF = CHAPTERS.map((_, k) => FRAMES.findIndex((f) => f.slide === k));
const DEMO_INDEX = FRAMES.findIndex((f) => f.beats > 1);
const SOURCES_INDEX = FRAMES.length - 1;

function hashOf(i, beat = 0) {
  const f = FRAMES[i];
  if (f.sources) return 'sources';
  if (f.beats > 1) return `${CHAPTERS[f.slide].id}-${beat + 1}`;
  return SLIDES[f.slide].length > 1 ? `${CHAPTERS[f.slide].id}-${f.step + 1}` : CHAPTERS[f.slide].id;
}
function posFromHash(hash) {
  const h = (hash || '').replace(/^#/, '');
  if (!h) return { index: 0, beat: 0 };
  if (h === 'sources' || h.startsWith('src-')) return { index: SOURCES_INDEX, beat: 0 };
  if (h === 'demo') return { index: DEMO_INDEX, beat: 1 };
  const [id, n] = h.split('-');
  const k = CHAPTERS.findIndex((c) => c.id === id);
  if (k < 0) return { index: 0, beat: 0 };
  const i = FIRST_OF[k];
  const nth = (parseInt(n, 10) || 1) - 1;
  if (FRAMES[i].beats > 1) return { index: i, beat: Math.max(0, Math.min(FRAMES[i].beats - 1, nth)) };
  return { index: i + Math.max(0, Math.min(SLIDES[k].length - 1, nth)), beat: 0 };
}

// Citations on a slide are numbered in order of appearance; each stat carries its number(s) and the slide ends with
// one compact "Sources:" row. Entries are read from sources.js.
function refsOf(st) {
  return [...new Set((st.evidence ?? []).flatMap((e) => e.ids ?? []))].filter((id) => SOURCES[id]);
}

function RefMarks({ ids, refs }) {
  const { showSource } = useContext(DeckCtx);
  const nums = (ids ?? []).filter((id) => refs.includes(id));
  if (!nums.length) return null;
  return (
    <sup className="ref">
      {nums.map((id, i) => (
        <React.Fragment key={id}>
          {i > 0 && ','}
          <a
            href={`#src-${id}`}
            title={SOURCES[id].full}
            onClick={(e) => {
              e.preventDefault();
              showSource(id);
            }}
          >
            {refs.indexOf(id) + 1}
          </a>
        </React.Fragment>
      ))}
    </sup>
  );
}

function SourceRow({ refs }) {
  const { showSource } = useContext(DeckCtx);
  if (!refs.length) return null;
  return (
    <p className="src-row">
      <span>Sources:</span>
      {refs.map((id, i) => {
        const s = SOURCES[id];
        const label = `[${i + 1}] ${s.short}`;
        return s.url ? (
          <a key={id} href={s.url} target="_blank" rel="noreferrer" title={s.full}>
            {label}
          </a>
        ) : (
          <a
            key={id}
            href={`#src-${id}`}
            title={s.full}
            onClick={(e) => {
              e.preventDefault();
              showSource(id);
            }}
          >
            {label}
          </a>
        );
      })}
    </p>
  );
}

function Evidence({ items, note, center, refs = [] }) {
  return (
    <div className={`evidence${center ? ' center' : ''}`} style={center ? { gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` } : undefined}>
      {items.map((e, i) => (
        <div className="ev" key={i}>
          {e.q ? <div className="ev-q">{e.q}</div> : <div className={`ev-v ${e.red === false ? '' : 'red'}`}>{e.v}</div>}
          <p>
            {e.q ? null : e.t}
            <RefMarks ids={e.ids} refs={refs} />
            {e.label && <span className="label">{e.label}</span>}
          </p>
        </div>
      ))}
      {note && <p className="ev-note">{note}</p>}
    </div>
  );
}

function StepFrame({ f, on, beat, onBeat }) {
  const c = CHAPTERS[f.slide];
  const st = f.st;
  if (st.layout === 'flare') return <FlareFrame on={on} beat={beat} onBeat={onBeat} label={c.title} />;
  if (st.layout === 'built')
    return (
      <section className={`frame layout-built ${on ? 'on' : ''}`} aria-hidden={!on} inert={on ? undefined : ''} aria-label={c.title}>
        <BuiltSlide />
      </section>
    );
  const layout = st.demo ? 'demo' : st.layout || 'split';
  const multi = SLIDES[f.slide].length > 1;
  const refs = refsOf(st);
  return (
    <section
      className={`frame layout-${layout} ${on ? 'on' : ''}`}
      aria-hidden={!on}
      inert={on ? undefined : ''}
      aria-label={multi ? `${c.title}, step ${f.step + 1} of ${SLIDES[f.slide].length}` : c.title}
    >
      <div className="frame-inner">
        <div className="text">
          {false && (
            <p className="kicker">
              <span className="n">{c.no}</span>
              {c.title}
              {st.kicker ? ` · ${st.kicker}` : ''}
            </p>
          )}
          {st.h1 ? <h1>{st.title}</h1> : <h2>{st.title}</h2>}
          {st.body && <div className="lede">{st.body}</div>}
          {st.src && <p className="src">{st.src}</p>}
        </div>
        {st.statsRight ? (
          <div className="visual stats-right">
            <Evidence items={st.evidence} note={st.evidenceNote} refs={refs} />
          </div>
        ) : (
          <>
            <div className="visual">
              {st.visualTitle && <p className="vis-title">{st.visualTitle}</p>}
              {st.visual(on)}
            </div>
            {st.evidence && <Evidence items={st.evidence} note={st.evidenceNote} center={st.centerEvidence} refs={refs} />}
          </>
        )}
        <SourceRow refs={refs} />
      </div>
    </section>
  );
}

function FlareFrame({ on, beat, onBeat, label }) {
  const { demoReady } = useContext(DeckCtx);
  return (
    <section className={`frame layout-flare ${on ? 'on' : ''}`} aria-hidden={!on} inert={on ? undefined : ''} aria-label={label}>
      <FlareSlide
        beat={beat}
        on={on}
        ready={demoReady}
        onBeat={onBeat}
      />
    </section>
  );
}

function SourcesFrame({ on, highlight }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!on || !highlight || !ref.current) return undefined;
    const t = setTimeout(() => {
      const el = ref.current.querySelector(`#src-${highlight}`);
      if (el) ref.current.scrollTo({ top: Math.max(0, el.offsetTop - ref.current.clientHeight / 2), behavior: 'smooth' });
    }, 350);
    return () => clearTimeout(t);
  }, [on, highlight]);
  return (
    <section ref={ref} className={`frame layout-sources ${on ? 'on' : ''}`} aria-hidden={!on} inert={on ? undefined : ''} aria-label="Sources">
      <div className="frame-inner">
        <p className="kicker">Sources</p>
        <h2>Where every number comes from.</h2>
        <ol className="sources">
          {SOURCE_ORDER.map((id) => {
            const s = SOURCES[id];
            return (
              <li key={id} id={`src-${id}`} className={highlight === id ? 'hi' : ''}>
                <span className="sid">{id}</span>
                <span>
                  {s.full}{' '}
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noreferrer">
                      link
                    </a>
                  )}
                  {s.url2 && (
                    <>
                      {' · '}
                      <a href={s.url2} target="_blank" rel="noreferrer">
                        second link
                      </a>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="src foot-note">
          FLARE · A hackathon prototype. Not for operational use. Marlowe House is fictional. <DemoLink>Open the demo</DemoLink>
        </p>
      </div>
    </section>
  );
}

/* ---------- chrome ---------- */

function TopBar({ index, goTo, onSources }) {
  const slide = FRAMES[index].slide;
  return (
    <header className="topbar">
      <button type="button" className="wordmark" onClick={() => goTo(0)}>
        FLARE
      </button>
      <nav className="chapter-nav" aria-label="Chapters">
        {CHAPTERS.map((c, k) => (
          <button
            type="button"
            key={c.id}
            className={k === slide ? 'on' : ''}
            aria-current={k === slide ? 'step' : undefined}
            onClick={() => goTo(FIRST_OF[k])}
          >
            <span className="n">{c.no}</span>
            <span className="lbl">{c.title}</span>
          </button>
        ))}
      </nav>
      <button type="button" className={`tb-link ${index === SOURCES_INDEX ? 'on' : ''}`} onClick={onSources}>
        Sources
      </button>
      <DemoLink className="tb-demo">Full-screen demo</DemoLink>
    </header>
  );
}

export default function Story({ onNavigate }) {
  const [pos, setPos] = useState(() => posFromHash(typeof window !== 'undefined' ? window.location.hash : ''));
  const index = Math.max(0, Math.min(FRAMES.length - 1, pos.index));
  const beat = Math.max(0, Math.min((FRAMES[index].beats || 1) - 1, pos.beat || 0));
  const [demoReady, setDemoReady] = useState(false);
  const [srcHi, setSrcHi] = useState(null);
  // The demo keeps the arrow keys once the reader has clicked or tabbed into it (focus can drop to <body>
  // when a demo button re-renders, so this is tracked by pointer and focus, not by document.activeElement).
  const [engaged, setEngaged] = useState(false);
  const engagedRef = useRef(false);
  engagedRef.current = engaged && index === DEMO_INDEX;
  const touch = useRef(null);

  const goTo = useCallback((i, b = 0) => setPos({ index: Math.max(0, Math.min(FRAMES.length - 1, i)), beat: b }), []);
  const setBeat = useCallback((b) => setPos((p) => ({ index: p.index, beat: b })), []);
  // One step: within a beat slide, move a beat; past its ends, move a frame (entering a beat slide backwards lands on its last beat).
  const go = useCallback(
    (d) =>
      setPos((p) => {
        const i = Math.max(0, Math.min(FRAMES.length - 1, p.index));
        const nb = FRAMES[i].beats || 1;
        const b = Math.max(0, Math.min(nb - 1, p.beat || 0));
        if (b + d >= 0 && b + d < nb) return { index: i, beat: b + d };
        const ni = Math.max(0, Math.min(FRAMES.length - 1, i + d));
        if (ni === i) return p;
        return { index: ni, beat: d < 0 ? (FRAMES[ni].beats || 1) - 1 : 0 };
      }),
    [],
  );
  const showSource = useCallback(
    (id) => {
      setSrcHi(id);
      goTo(SOURCES_INDEX);
    },
    [goTo],
  );

  // Keep the URL in step so a reload (or a shared link) lands on the same step.
  useEffect(() => {
    const h = `#${hashOf(index, beat)}`;
    if (window.location.hash !== h) window.history.replaceState(null, '', h);
  }, [index, beat]);
  useEffect(() => {
    const onHash = () => setPos(posFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Engage the demo on a pointer press inside it; release it on a press anywhere else or when leaving the step.
  useEffect(() => {
    const onDown = (e) => {
      const inside = e.target instanceof Element && !!e.target.closest('.demo-frame');
      setEngaged(inside);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);
  useEffect(() => {
    if (index !== DEMO_INDEX) setEngaged(false);
  }, [index]);

  // Mount the live demo once the reader is near it, then keep it (and its state).
  useEffect(() => {
    if (Math.abs(index - DEMO_INDEX) <= 1) setDemoReady(true);
  }, [index]);

  // Keys: → / PageDown / space forward, ← / PageUp back. Focus inside the demo keeps its keys.
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('.demo-frame') || engagedRef.current) return;
      if (t?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
      let d = 0;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') d = 1;
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') d = -1;
      else if (e.key === ' ' || e.key === 'Spacebar') {
        if (t?.closest('button, a, summary')) return;
        d = e.shiftKey ? -1 : 1;
      } else if (e.key === 'Home' && !t?.closest('button, a')) {
        e.preventDefault();
        goTo(0);
        return;
      } else if (e.key === 'End' && !t?.closest('button, a')) {
        e.preventDefault();
        goTo(SOURCES_INDEX);
        return;
      }
      if (!d) return;
      e.preventDefault();
      go(d);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, goTo]);

  const onTouchStart = (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (t?.closest('.demo-frame, [data-noswipe]') || e.touches.length !== 1) {
      touch.current = null;
      return;
    }
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e) => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - s.x;
    const dy = p.clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
  };

  const cur = FRAMES[index];
  const nSteps = cur.sources ? 1 : cur.beats > 1 ? cur.beats : SLIDES[cur.slide].length;
  const curStep = cur.beats > 1 ? beat : cur.step;
  const ctx = useMemo(() => ({ showSource, onNavigate, demoReady, engaged, setEngaged }), [showSource, onNavigate, demoReady, engaged]);

  return (
    <DeckCtx.Provider value={ctx}>
      <div className="story deck">
        <div className="progress" aria-hidden="true">
          <i style={{ width: `${((index + 1) / FRAMES.length) * 100}%` }} />
        </div>
        <main className="viewport" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} aria-roledescription="slide deck">
          <div className="track" style={{ transform: `translateX(${-index * 100}%)` }}>
            {FRAMES.map((f, i) =>
              f.sources ? (
                <SourcesFrame key="sources" on={i === index} highlight={srcHi} />
              ) : (
                <StepFrame key={`${f.slide}-${f.step}`} f={f} on={i === index} beat={i === index ? beat : f.beats > 1 && i > index ? 0 : (f.beats || 1) - 1} onBeat={setBeat} />
              ),
            )}
          </div>
        </main>
        <div className="deck-controls">
          <div className="dots" aria-hidden={cur.sources}>
            {!cur.sources &&
              nSteps > 1 &&
              Array.from({ length: nSteps }).map((_, j) => (
                <button
                  type="button"
                  key={j}
                  className={j === curStep ? 'on' : j < curStep ? 'done' : ''}
                  aria-label={`Step ${j + 1}`}
                  onClick={() => (cur.beats > 1 ? setBeat(j) : goTo(FIRST_OF[cur.slide] + j))}
                />
              ))}
            <span className="count" aria-live="polite">
              {cur.sources
                ? 'Sources'
                : nSteps > 1
                  ? `${CHAPTERS[cur.slide].no} · ${curStep + 1} / ${nSteps}`
                  : `${CHAPTERS[cur.slide].no} · ${CHAPTERS[cur.slide].title}`}
            </span>
          </div>
          <div className="arrows">
            <button type="button" onClick={() => go(-1)} disabled={index === 0 && beat === 0} aria-label="Previous step">
              ←
            </button>
            <button type="button" onClick={() => go(1)} disabled={index === FRAMES.length - 1} aria-label="Next step">
              →
            </button>
          </div>
        </div>
      </div>
    </DeckCtx.Provider>
  );
}
