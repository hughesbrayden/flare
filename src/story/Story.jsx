import React, { useEffect, useRef, useState } from 'react';
import App from '../App.jsx';
import IsoBuilding from './IsoBuilding.jsx';
import { ClockFigure, PinFigure, TrapFigure, SanbornMap, LanesFigure, PipelineFigure } from './Figures.jsx';
import { SOURCES, SOURCE_ORDER } from './sources.js';
import proof from '../data/proof.json';
import { StairIcon, FireDoorIcon, ReportPinIcon } from '../NfpaSymbols.jsx';

const BASE = import.meta.env.BASE_URL;
const CHAPTERS = [
  { id: 'problem', no: '01', title: 'The problem' },
  { id: 'solution', no: '02', title: 'Flare' },
  { id: 'landscape', no: '03', title: 'What exists today' },
  { id: 'built', no: '04', title: 'How we built it' },
];

/* ---------- small helpers ---------- */

function Cite({ id }) {
  const s = SOURCES[id];
  return (
    <a className="cite" href={`#src-${id}`} title={s.full}>
      Source: {s.short}
    </a>
  );
}

// Adds "seen" once an element scrolls into view (used for draw-in transitions).
function useSeen(threshold = 0.25) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return undefined;
    if (!('IntersectionObserver' in window)) {
      setSeen(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen];
}

function Scene({ children, className = '' }) {
  const [ref, seen] = useSeen(0.2);
  return (
    <section ref={ref} className={`scene ${className} ${seen ? 'seen' : ''}`}>
      {children}
    </section>
  );
}

// Sticky figure on one side, text steps scrolling past it. The step nearest the middle of the screen is active.
function Scrolly({ steps, renderFigure, className = '' }) {
  const [active, setActive] = useState(0);
  const refs = useRef([]);
  useEffect(() => {
    // The active step is the last one whose top has passed a reading line: mid-screen on desktop,
    // lower on phones, where the figure is pinned over the top half.
    const update = () => {
      const line = window.innerHeight * (window.matchMedia('(max-width: 860px)').matches ? 0.66 : 0.5);
      let next = 0;
      refs.current.forEach((el, i) => {
        if (el && el.getBoundingClientRect().top < line) next = i;
      });
      setActive(next);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [steps.length]);
  return (
    <div className={`scrolly ${className}`}>
      <div className="scrolly-figure">
        <div className="scrolly-figure-inner">{renderFigure(active)}</div>
      </div>
      <div className="scrolly-steps">
        {steps.map((s, i) => (
          <div
            key={i}
            ref={(el) => (refs.current[i] = el)}
            data-step={i}
            className={`step ${i === active ? 'is-active' : ''}`}
          >
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}

function Crop({ sheet, region, box, label, amber }) {
  // region: normalized [x0, y0, x1, y1] to show; box: normalized region to outline.
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
              className={`crop-box ${amber ? 'amber' : ''}`}
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

/* ---------- page chrome ---------- */

function TopBar({ onNavigate }) {
  const [current, setCurrent] = useState(null);
  useEffect(() => {
    const update = () => {
      const line = window.innerHeight * 0.35;
      let next = null;
      for (const c of CHAPTERS) {
        const el = document.getElementById(c.id);
        if (el && el.getBoundingClientRect().top <= line) next = c.id;
      }
      setCurrent(next);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  const cur = CHAPTERS.find((c) => c.id === current);
  return (
    <header className="topbar">
      <a href="#top" className="wordmark">FLARE</a>
      <span className="chapter-pin" aria-live="polite">
        {cur ? (
          <>
            <b>{cur.no}</b> {cur.title}
          </>
        ) : (
          'Marlowe House · 2:14 AM'
        )}
      </span>
      <nav className="chapter-nav" aria-label="Chapters">
        {CHAPTERS.map((c) => (
          <a key={c.id} href={`#${c.id}`} className={c.id === current ? 'on' : ''}>
            <b>{c.no}</b> <span>{c.title}</span>
          </a>
        ))}
      </nav>
      <a
        className="demo-link"
        href="/demo"
        onClick={(e) => {
          if (onNavigate) {
            e.preventDefault();
            onNavigate('/demo');
          }
        }}
      >
        Open the demo
      </a>
    </header>
  );
}

function ChapterHead({ c, kicker }) {
  return (
    <div className="chapter-head">
      <div className="chapter-no">{c.no}</div>
      <div>
        <div className="chapter-title">{c.title}</div>
        {kicker && <p className="chapter-kicker">{kicker}</p>}
      </div>
    </div>
  );
}

/* ---------- chapter 1 ---------- */

function Problem() {
  return (
    <div className="chapter" id={CHAPTERS[0].id}>
      <ChapterHead
        c={CHAPTERS[0]}
        kicker="A street address does not tell a crew how a building connects."
      />

      <Scene className="split">
        <div className="text">
          <h2>Fires in homes kill people at night, in bedrooms.</h2>
          <p className="stat">
            Half of US residential fire deaths occur in bedrooms, and 49% between 11 p.m. and 7 a.m.
          </p>
          <Cite id="E10" />
          <p>
            So the call often comes in the middle of the night, from a building the crew has never been inside. Our
            example starts at 2:14 AM.
          </p>
        </div>
        <div className="figure dispatch-figure">
          <div className="dispatch-card">
            <div className="mono small">DISPATCH · 2:14 AM</div>
            <div className="dispatch-line">Smoke reported near apartment 4C.</div>
            <div className="mono small">Marlowe House · 142–144 Marlowe St · 5 stories</div>
          </div>
          <p className="fig-note">Marlowe House is a fictional building. We drew its plans for this project.</p>
        </div>
      </Scene>

      <Scene className="split">
        <div className="text">
          <h2>The crew has minutes, and the fire moves fast.</h2>
          <p className="stat">
            NFPA 1710 sets an 80-second turnout and a 240-second travel time for the first engine, on 90% of incidents.
          </p>
          <Cite id="E6" />
          <p className="stat">
            In UL tests, rooms with modern furnishings flashed over in under 5 minutes (3:20–4:45). Rooms with legacy
            furnishings took about 30.
          </p>
          <Cite id="E7" />
          <p>
            These are two different clocks with different starting points, so they don’t add up to one number. Both
            are measured in minutes. The drive over is when the officer can think about the building.
          </p>
        </div>
        <div className="figure">
          <ClockFigure />
        </div>
      </Scene>

      <Scene className="split">
        <div className="text">
          <h2>The fire is in one apartment. The smoke isn’t.</h2>
          <p className="stat">
            Twin Parks, Bronx, January 2022: a faulty space heater started the fire. It stayed largely in the apartment
            and the hallway next to it, but the apartment door didn’t close and stair doors also failed to self-close.
            All 17 deaths were from smoke inhalation.
          </p>
          <Cite id="E1" />
          <p className="stat">
            UL FSRI ran 13 experiments in three-story apartment buildings with a shared enclosed stair. With the
            apartment door left open, heat and carbon monoxide rose throughout the stairwell. Controlling the door
            limited what got into the stair.
          </p>
          <Cite id="E2" />
          <p>A pin on the reported apartment only tells part of the story. The stairs and halls everyone shares matter just as much.</p>
        </div>
        <div className="figure">
          <PinFigure />
          <p className="fig-note">
            Two separate street entrances can still depend on the same fourth-floor lobby. Illustration, not a
            simulation.
          </p>
        </div>
      </Scene>

      <Scene className="split">
        <div className="text">
          <h2>Buildings don’t always work the way their signs say.</h2>
          <p className="stat">
            FDNY procedures warn about dead-end hallways and confusing apartment numbers (“Apartment 2E could be on the
            second floor or on the fifth”), and that “mislabeled scissor stairs will cause confusion during fire
            operations.”
          </p>
          <Cite id="E3" />
          <p className="stat">
            Hawaii, January 2025: a firefighter died after becoming disoriented in a nine-apartment building that was
            originally built as a single-family house. NIOSH listed the change of occupancy as a contributing factor and
            recommended sharing occupancy-change data with fire departments.
          </p>
          <Cite id="E8" />
          <p className="stat soft">
            In early Project Mayday data, becoming lost or separated from the hoseline was the top mayday cause for career
            departments (25%). <span className="label">Preliminary data, trade press</span>
          </p>
          <Cite id="E9" />
        </div>
        <div className="figure">
          <TrapFigure />
          <p className="fig-note">Two signs, two stairs, one lobby. In Marlowe House both front stairs open into the same room on floor 4.</p>
        </div>
      </Scene>
    </div>
  );
}

/* ---------- chapter 2 ---------- */

const SHEETS = [
  { id: 'A-1', label: 'A-1 · floor 1', detail: '142 & 144 street entries + keyed rear alley gate' },
  { id: 'A-2', label: 'A-2 · floors 2, 3, 5', detail: 'Scissor core + floor-3 corridor to Stair C' },
  { id: 'A-4', label: 'A-4 · floor 4', detail: 'East Lobby chokepoint + Stair C "SEE NOTE 7"' },
  { id: 'A-301', label: 'A-301 · stair section', detail: 'Vertical shaft stops across floors 1–5' },
];


function flagLines(flags) {
  const note7 = flags.find((f) => f.check === 'missing_referenced_note');
  const noDoor = flags.filter((f) => f.check === 'enclosed_space_no_door');
  const unlabeled = flags.filter((f) => f.check === 'unlabeled_enclosed_space');
  const lines = [];
  if (note7) lines.push({ key: 'n7', amber: true, sheet: note7.sheet, text: 'Stair C’s floor-4 door says “F.D. — see note 7.” The notes on sheet A-4 go 6, then 8.' });
  if (noDoor.length)
    lines.push({
      key: 'nd',
      sheet: [...new Set(noDoor.map((f) => f.sheet))].join(', '),
      text: 'Rooms drawn with no door: the mechanical room on floor 1 and the refuse room on each of floors 2–5.',
    });
  if (unlabeled.length)
    lines.push({
      key: 'ul',
      sheet: [...new Set(unlabeled.map((f) => f.sheet))].join(', '),
      text: `${unlabeled.length} enclosed areas on floor 1 with no label and no door.`,
    });
  return lines;
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m} min ${r} s`;
}

function SheetsFigure() {
  return (
    <div className="sheets-figure">
      {SHEETS.map((s, i) => (
        <figure key={s.id} className="sheet-thumb" style={{ transitionDelay: `${i * 80}ms` }}>
          <img src={`${BASE}sheets/${s.id}.png`} alt={`Plan sheet ${s.label}`} loading="lazy" />
          <figcaption>
            <strong>{s.label}</strong>
            <span className="sheet-detail">{s.detail}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function FlagsFigure() {
  return (
    <div className="flags-figure">
      <Crop
        sheet="A-4"
        region={[0.62, 0.05, 0.99, 0.45]}
        box={[0.7245, 0.3108, 0.7605, 0.3662]}
        amber
        label="Sheet A-4: the Stair C door callout (dashed box) and the general notes, which skip 7."
      />
      <ul className="flag-list">
        {flagLines(proof.checker_flags).map((l) => (
          <li key={l.key} className={l.amber ? 'amber' : ''}>
            <FireDoorIcon size={14} /> <span>{l.text}</span> <em>Sheet {l.sheet}</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Solution({ onNavigate }) {
  const readers = proof.lanes.filter((l) => l.role === 'reader');
  const slowest = Math.max(...readers.map((l) => l.seconds));
  const fastest = Math.min(...readers.map((l) => l.seconds));
  const stitch = proof.lanes.find((l) => l.role === 'stitcher');
  const check = proof.lanes.find((l) => l.role === 'checker');
  const nFlags = proof.checker_flags.length;

  const steps = [
    <>
      <div className="mono small">2:14 AM · DISPATCH</div>
      <h3>The call names an apartment. The plans are four sheets.</h3>
      <p>
        Marlowe House has drawings: a floor-1 plan, a typical plan for floors 2, 3 and 5, a floor-4 plan, and a stair
        section. They were never meant to be read in a moving truck. Flare turns them into one model ahead of time,
        long before any call.
      </p>
    </>,
    <>
      <div className="mono small">BEFORE ANY CALL · STEP 1</div>
      <h3>Four agents read the four sheets at the same time.</h3>
      <p>
        Each sheet reader is a Gemini Managed Agent with its own sandbox. It writes down every room, door and stair on
        its sheet, with the spot on the sheet each one came from. Then it redraws what it wrote and compares that with
        the sheet, and fixes what doesn’t line up.
      </p>
      <p className="mono small">
        Real run: readers took {Math.round(fastest)}–{Math.round(slowest)} s, side by side.
      </p>
    </>,
    <>
      <div className="mono small">STEP 2 AND 3</div>
      <h3>A stitcher joins the floors. A checker flags what a person should look at.</h3>
      <p>
        The stair stitcher copies the typical plan to floors 2, 3 and 5 and connects each stair from floor to floor
        ({Math.round(stitch.seconds)} s). The checker then runs fixed rule checks and compares the model against the
        sheets ({Math.round(check.seconds)} s). It can send a mistake back to the reader that made it. Anything the
        drawings themselves leave open, it keeps and marks for review.
      </p>
      <p>
        In this run it marked {nFlags} things for review. The one that matters for the call: Stair C’s floor-4 door
        points to a note that isn’t on the sheet.
      </p>
    </>,
    <>
      <div className="mono small">THE MODEL</div>
      <h3>One building model: five floors, three stairs, three entrances.</h3>
      <p>
        Every element keeps the sheet it came from and whether the drawing was clear. The full run took{' '}
        {fmtTime(proof.wall_seconds)} and cost about ${proof.totals.cost_usd.toFixed(2)}. That happens once per
        building, not once per call.
      </p>
    </>,
    <>
      <div className="mono small">2:15 AM · EN ROUTE</div>
      <h3>Two front doors. Two stairs. One lobby.</h3>
      <p>
        142 Marlowe leads to Stair A. 144 Marlowe leads to Stair B. From the street they look like two separate ways
        up. They are scissor stairs in one shaft, and on floor 4 both open into the east lobby. Go straight up
        either one and you reach 4C through that lobby.
      </p>
      <p>That lobby is a fact about the layout, taken from sheet A-4. Whether it’s passable tonight is a different question.</p>
    </>,
    <>
      <div className="mono small">2:15 AM · WHAT IF</div>
      <h3>Every way around that lobby uses Stair C.</h3>
      <p>
        You can reach Stair C from the rear alley gate, or by crossing over on floor 3 from either front stair. Both
        ways come out through the same door: Stair C’s door on floor 4, which points to a note that is missing.
      </p>
      <p>
        That leaves two things to check on arrival: does the alley gate open (nobody has confirmed it), and is that
        floor-4 door usable. If the lobby and that door are both out, there is no documented route.
      </p>
    </>,
  ];

  const figure = (i) => {
    if (i === 0) return <SheetsFigure />;
    if (i === 1)
      return (
        <div className="lanes-wrap">
          <div className="mono small fig-head">Pipeline run · real times</div>
          <LanesFigure proof={proof} />
          <p className="fig-note mono">
            Total {fmtTime(proof.wall_seconds)} · about ${proof.totals.cost_usd.toFixed(2)} · run of {proof.started.slice(0, 10)}
          </p>
        </div>
      );
    if (i === 2) return <FlagsFigure />;
    return <IsoBuilding stage={i === 3 ? 1 : i === 4 ? 3 : 4} />;
  };

  return (
    <div className="chapter" id={CHAPTERS[1].id}>
      <ChapterHead
        c={CHAPTERS[1]}
        kicker="Flare is an interactive model of a building that a crew can question on the way to the call: how it connects, where routes share a choke point, and what still needs checking."
      />
      <Scrolly steps={steps} renderFigure={figure} className="solution-scrolly" />

      <section className="demo-section" id="demo">
        <div className="demo-intro">
          <h2>Try it: the Marlowe House call</h2>
          <p>
            Step through the call with the dark buttons on the right. Try the what-ifs, then undo them. Tap any room,
            door or stair to see it on the original sheet or assume it unavailable. A caller’s report arrives at 2:16 AM;
            notice that it stays a report until a unit verifies it.
          </p>
          <ul className="key">
            <li><span className="chip fact"><StairIcon size={12} /> Fact</span> comes from the drawings, with the sheet it’s on.</li>
            <li><span className="chip report"><ReportPinIcon size={12} /> Report</span> is pinned with who said it and when, and stays unverified.</li>
            <li><span className="chip assume">IF · What-if</span> is your assumption, with one-tap undo.</li>
          </ul>
        </div>
        <div className="demo-frame">
          <App embedded onNavigate={onNavigate} />
        </div>
        <p className="fig-note">
          Routes are worked out in your browser by fixed rules, not by an AI model. The building is fictional, and the
          dispatch and radio lines are scripted.{' '}
          <a
            href="/demo"
            onClick={(e) => {
              if (onNavigate) {
                e.preventDefault();
                onNavigate('/demo');
              }
            }}
          >
            Open the demo full screen
          </a>
          .
        </p>
      </section>
    </div>
  );
}

/* ---------- chapter 3 ---------- */

function Landscape() {
  const rows = [
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
  const cols = ['Ready at dispatch', 'Small residential', 'Interactive what-ifs', 'Where the gap is'];
  return (
    <div className="chapter" id={CHAPTERS[2].id}>
      <ChapterHead c={CHAPTERS[2]} kicker="Who gets a plan before the fire, and what the existing tools do." />

      <Scene className="split map-scene">
        <div className="text">
          <h2>High-risk buildings get pre-plans. Homes mostly don’t.</h2>
          <p className="stat">
            Pre-planning has traditionally focused on high-risk facilities; most departments don’t pre-plan individual
            homes.
          </p>
          <Cite id="E12" />
          <span className="label">Practitioner observation; no standard says this</span>
          <p className="stat">Nearly two-thirds of all US civilian fire deaths occur in one- and two-family homes.</p>
          <Cite id="E11" />
          <p>
            Small apartment buildings sit in between: too small to get a pre-plan, big enough to have shared stairs,
            lobbies and doors that can confuse a crew.
          </p>
        </div>
        <div className="figure">
          <SanbornMap />
          <div className="map-legend">
            <span><i className="lg pre" /> pre-planned (high-risk, commercial, institutional)</span>
            <span><i className="lg none" /> no plan on file (homes, small apartment buildings)</span>
          </div>
          <p className="fig-note">Illustrative map in the style of an old fire-insurance atlas. Not real data.</p>
        </div>
      </Scene>

      <Scene className="split table-scene">
        <div className="text">
          <h2>Indoor routing for responders isn’t new.</h2>
          <p className="stat">
            OGC’s Indoor Mapping and Navigation Pilot, sponsored by NIST’s public safety program in 2019, demonstrated
            building scans turned into indoor models and navigation routes for fire service pre-planning.
          </p>
          <Cite id="E5" />
          <p className="stat">
            In an 81-firefighter study, navigable 3D imagery was rated significantly higher for understanding navigation
            than 2D plans alone — measuring ratings, not task performance.
          </p>
          <Cite id="E4" />
          <p>
            What is still missing is a way for a crew to work through one call as it unfolds: test what happens if a
            lobby is unavailable, and keep an unverified report separate from a confirmed block. That is the part Flare
            focuses on.
          </p>
        </div>
        <div className="figure table-figure">
          <div className="mono small fig-head">OUR READING OF EACH CATEGORY · NOT A BENCHMARK</div>
          <div className="compare-wrap">
            <table className="compare">
              <thead>
                <tr>
                  <th scope="col" />
                  {cols.map((c) => (
                    <th key={c} scope="col">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className={r.ours ? 'ours' : ''}>
                    <th scope="row">
                      {r.name}
                      <span className="label">{r.label}</span>
                    </th>
                    {r.cells.map((c, i) => (
                      <td key={i} data-col={cols[i]}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fig-note">“Our reading” means our judgment from public material, not a measurement or a review of any one product.</p>
        </div>
      </Scene>
    </div>
  );
}

/* ---------- chapter 4 ---------- */

function Built() {
  const t = proof.totals;
  return (
    <div className="chapter" id={CHAPTERS[3].id}>
      <ChapterHead c={CHAPTERS[3]} kicker="Agents read and check the plans before the call. Plain code routes during it." />

      <Scene className="split">
        <div className="text">
          <h2>Before the call: plans in, model out.</h2>
          <ol className="flow">
            <li><b>Plans in.</b> Four sheets of Marlowe House.</li>
            <li><b>Four sheet readers, in parallel.</b> Each reads one sheet, redraws its reading and compares it to the sheet.</li>
            <li><b>Stair stitcher.</b> Joins the floors and connects each stair.</li>
            <li><b>Checker.</b> Rule checks plus a look at the sheets. It can send an error back to the reader that made it; what the drawings leave open, it flags for a person.</li>
            <li><b>The model.</b> What the demo loads.</li>
          </ol>
          <div className="kpi-strip">
            <div className="kpi-box">
              <strong>{fmtTime(proof.wall_seconds)}</strong>
              <span>Wall time</span>
            </div>
            <div className="kpi-box">
              <strong>~${t.cost_usd.toFixed(2)}</strong>
              <span>Est. cost*</span>
            </div>
            <div className="kpi-box">
              <strong>{proof.checker_flags.length}</strong>
              <span>Items flagged</span>
            </div>
          </div>
          <p className="fig-note">
            * Cost is estimated from token counts at Gemini 4 Hydrogen list price; sandbox compute was free during the
            preview.
          </p>
          <p>
            Managed Agents has no built-in fan-out, so our own orchestrator starts the four readers at once and waits
            for all of them. Agent tasks take minutes, which is fine for work done before any call.
          </p>
        </div>
        <div className="figure">
          <div className="mono small fig-head">Latest run · time and estimated cost per agent</div>
          <PipelineFigure proof={proof} />
        </div>
      </Scene>

      <Scene className="split">
        <div className="text">
          <h2>During the call: rules decide the routes.</h2>
          <p>
            Routing is plain code that runs in the browser. It never sends a route through someone else’s apartment,
            never uses the elevator (the sheet says it isn’t for fire service use), and climbs without doubling back. It
            ranks routes by fewest unknowns first, then distance.
          </p>
          <p>
            A report never closes a route by itself; it flags it. Only an officer’s what-if or a unit’s verification
            closes one. When nothing is left, it says “No documented route.”
          </p>
          <p>
            In the version a crew would use, a language model would turn radio traffic and spoken questions into those
            same changes. That part is planned, not built yet; here you tap instead.
          </p>
        </div>
        <div className="figure">
          <div className="rules-card">
            <div className="mono small">ROUTE RANKING</div>
            <ol>
              <li>Fewest open questions (unconfirmed entrances, unclear drawings)</li>
              <li>Shortest distance (door to door, plus 6 m per floor)</li>
              <li>Fewest floor changes</li>
            </ol>
            <div className="mono small">WHAT CLOSES A ROUTE</div>
            <ul>
              <li><span className="tag-mini assume">IF</span> an officer’s what-if</li>
              <li><span className="tag-mini blocked">✕</span> a unit verifies it blocked</li>
              <li><span className="tag-mini report">“ ”</span> a report: flags it, doesn’t close it</li>
            </ul>
          </div>
        </div>
      </Scene>

      <Scene className="split">
        <div className="text">
          <h2>What we have and haven’t shown</h2>
          <ul className="plain">
            <li>Marlowe House is fictional. We drew its sheets and an answer key to score the pipeline against.</li>
            <li>
              On real drawings, in an earlier test: Gemini matched 89–96% of rooms from 3 real plans, and routes to
              bedrooms were right on all 3. <Cite id="E13" />
            </li>
            <li>We haven’t yet timed firefighters reading the sheets against using Flare. That test is next.</li>
            <li>Smoke spread is not modeled. The smoke in chapter 1 is an illustration.</li>
          </ul>
        </div>
        <div className="figure future">
          <h2>Where this goes</h2>
          <p>
            <b>Official records (planned, not built):</b> for real towns, Flare would pull from municipal permit
            filings, assessor/GIS building footprints, and occupancy-change records — the converted-house data NIOSH
            recommended sharing with fire departments (<Cite id="E8" />).
          </p>
          <p>
            <b>Longer term — robots:</b> a robot sent into a burning building could need the same thing a crew does: a
            model of the building that someone has checked, with the doubtful parts marked. Add corrections from crews
            after real calls, and each building’s model gets more reliable over time.
          </p>
        </div>
      </Scene>
    </div>
  );
}

function Sources() {
  return (
    <section className="sources" id="sources">
      <h2>Sources</h2>
      <ol>
        {SOURCE_ORDER.map((id) => {
          const s = SOURCES[id];
          return (
            <li key={id} id={`src-${id}`}>
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
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default function Story({ onNavigate }) {
  return (
    <div className="story" id="top">
      <TopBar onNavigate={onNavigate} />
      <header className="hero">
        <div className="mono small">2:14 AM</div>
        <h1>Smoke reported near apartment 4C.</h1>
        <p className="lede">
          Flare shows a fire crew how a building connects before they get there: which entrances lead where, where
          routes share a choke point, and what to check on arrival.
        </p>
        <div className="hero-links">
          <a className="btn-ink" href="#problem">Read the story</a>
          <a className="btn-line" href="#demo">Skip to the demo</a>
        </div>
        <p className="fig-note">Marlowe House, the building in this story, is fictional.</p>
      </header>
      <Problem />
      <Solution onNavigate={onNavigate} />
      <Landscape />
      <Built />
      <Sources />
      <footer className="story-foot">
        <span>FLARE</span>
        <span>A hackathon prototype. Not for operational use.</span>
        <a
          href="/demo"
          onClick={(e) => {
            if (onNavigate) {
              e.preventDefault();
              onNavigate('/demo');
            }
          }}
        >
          Demo
        </a>
      </footer>
    </div>
  );
}
