import React from 'react';

/* ---------- Chapter 1: two clocks, drawn to the same scale in seconds ---------- */
export function ClockFigure() {
  const X0 = 150;
  const PX = 1.45; // px per second
  const x = (s) => X0 + s * PX;
  const ticks = [0, 60, 120, 180, 240, 300];
  return (
    <svg className="fig fig-clock" viewBox="0 0 640 250" role="img" aria-label="Two timelines in seconds: the engine's turnout and travel targets, and flashover times in UL tests">
      <g className="axis">
        <line x1={x(0)} y1="210" x2={x(330)} y2="210" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} y1="205" x2={x(t)} y2="215" />
            <text x={x(t)} y="232" textAnchor="middle">
              {t / 60}:00
            </text>
          </g>
        ))}
        <text x={x(330) + 8} y="214" className="unit">min</text>
      </g>

      <text x="0" y="52" className="row-title">First engine</text>
      <text x="0" y="68" className="row-sub">clock starts at the call</text>
      <rect className="bar bar-ink-light draw" x={x(0)} y="40" width={80 * PX} height="22" />
      <rect className="bar bar-ink draw d2" x={x(80)} y="40" width={240 * PX} height="22" />
      <text x={x(40)} y="55" textAnchor="middle" className="bar-text dark">80 s</text>
      <text x={x(200)} y="55" textAnchor="middle" className="bar-text light">240 s travel</text>
      <text x={x(0)} y="84" className="note">turnout, then travel; target met on 90% of incidents</text>

      <text x="0" y="132" className="row-title">Modern room</text>
      <text x="0" y="148" className="row-sub">clock starts at ignition</text>
      <line className="dotted" x1={x(0)} y1="131" x2={x(200)} y2="131" />
      <rect className="bar bar-hatch draw d3" x={x(200)} y="120" width={85 * PX} height="22" />
      <text x={x(242)} y="114" textAnchor="middle" className="note strong">flashover 3:20–4:45</text>
      <text x={x(0)} y="166" className="note">legacy furnishings took about 30 minutes; off this scale</text>
    </svg>
  );
}

/* ---------- Chapter 1: what dispatch gives vs. what crews need to know (illustration) ---------- */
export function PinFigure() {
  return (
    <svg
      className="fig fig-dispatch-vs-conn"
      viewBox="0 0 640 260"
      role="img"
      aria-label="Section comparison: dispatch gives one pin on apartment 4C, while crews need to see two street entrances converging at the shared fourth-floor lobby, smoke moving up the shaft, and the unconfirmed rear stair"
    >
      <defs>
        <pattern id="smoke" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
          <rect width="6" height="6" fill="#8b877f" opacity="0.22" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#5d5a55" strokeWidth="0.6" opacity="0.55" />
        </pattern>
      </defs>

      {/* Left panel: What dispatch gives */}
      <g transform="translate(8, 12)">
        <rect x="0" y="0" width="246" height="232" fill="#faf7f0" stroke="#5d5a55" strokeWidth="1.2" />
        <text x="12" y="22" className="col-head">WHAT DISPATCH GIVES</text>
        <rect x="28" y="46" width="190" height="148" fill="#ebe4d3" stroke="#1c2a48" strokeWidth="1.5" />
        {[76, 106, 136, 166].map((y) => (
          <line key={y} x1="28" y1={y} x2="218" y2={y} stroke="#a8a39a" strokeWidth="1" />
        ))}
        <circle cx="158" cy="91" r="8" fill="#1c2a48" />
        <circle cx="158" cy="91" r="15" fill="none" stroke="#1c2a48" strokeWidth="1.2" strokeDasharray="3 3" />
        <text x="178" y="95" className="box-title">4C</text>
        <text x="123" y="216" textAnchor="middle" className="cap">142–144 Marlowe St · one map pin</text>
      </g>

      {/* Arrow */}
      <g transform="translate(262, 128)">
        <line x1="0" y1="0" x2="26" y2="0" stroke="#1c2a48" strokeWidth="1.8" />
        <polyline points="19,-6 26,0 19,6" fill="none" stroke="#1c2a48" strokeWidth="1.8" />
      </g>

      {/* Right panel: What crews need to know */}
      <g transform="translate(296, 12)">
        <rect x="0" y="0" width="336" height="232" fill="#faf7f0" stroke="#1c2a48" strokeWidth="1.5" />
        <text x="12" y="22" className="col-head">WHAT CREWS NEED BEFORE ENTRY</text>

        {/* 5-floor wireframe */}
        <rect x="22" y="46" width="292" height="148" fill="#f3eee2" stroke="#1c2a48" strokeWidth="1.5" />
        {[76, 106, 136, 166].map((y) => (
          <line key={y} x1="22" y1={y} x2="314" y2={y} stroke="#5d5a55" strokeWidth="0.9" />
        ))}

        {/* Shared scissor core (A & B) */}
        <rect x="124" y="46" width="46" height="148" fill="#dfd8c7" stroke="#1c2a48" strokeWidth="1.2" />
        <line x1="124" y1="194" x2="170" y2="46" stroke="#5d5a55" strokeWidth="0.9" strokeDasharray="3 2" />
        <line x1="170" y1="194" x2="124" y2="46" stroke="#5d5a55" strokeWidth="0.9" strokeDasharray="3 2" />

        {/* Rear stair C (neutral paper/graphite, no assumption blue) */}
        <rect x="274" y="46" width="30" height="148" fill="#e6dfcd" stroke="#5d5a55" strokeWidth="1.2" />

        {/* Illustrative smoke wash in East Lobby and upper scissor shaft */}
        <rect x="170" y="76" width="54" height="30" fill="url(#smoke)" stroke="#5d5a55" strokeWidth="1" strokeDasharray="3 2" />
        <rect x="124" y="46" width="46" height="60" fill="url(#smoke)" />

        {/* Two front routes converging at Floor-4 East Lobby */}
        <polyline points="58,194 58,180 135,180 135,91 196,91" fill="none" stroke="#1c2a48" strokeWidth="2.4" />
        <polyline points="204,194 204,180 159,180 159,91 196,91" fill="none" stroke="#1c2a48" strokeWidth="2.4" />

        {/* Rear bypass (dashed amber = unconfirmed access / unclear door) */}
        <polyline points="289,194 289,91 258,91" fill="none" stroke="#c98a12" strokeWidth="2.1" strokeDasharray="5 3" />

        {/* Unit 4C */}
        <rect x="224" y="76" width="40" height="30" fill="#1c2a48" fillOpacity="0.14" stroke="#1c2a48" strokeWidth="1.6" />
        <text x="244" y="95" textAnchor="middle" className="box-title">4C</text>

        {/* Labels */}
        <text x="147" y="40" textAnchor="middle" className="cap">SCISSOR A &amp; B</text>
        <text x="289" y="40" textAnchor="middle" className="cap">STAIR C</text>
        <text x="197" y="71" textAnchor="middle" className="cap strong">SHARED LOBBY</text>
        <text x="58" y="212" textAnchor="middle" className="cap">142</text>
        <text x="204" y="212" textAnchor="middle" className="cap">144</text>
        <text x="284" y="212" textAnchor="middle" className="cap" fill="#8a5d07">ALLEY?</text>
      </g>
    </svg>
  );
}

/* ---------- Chapter 1: two stair signs, one lobby (plan sketch of floor 4) ---------- */
export function TrapFigure() {
  return (
    <svg className="fig fig-trap" viewBox="0 0 520 260" role="img" aria-label="Plan sketch of floor 4: Stair A and Stair B both open into the east lobby, which leads to the corridor and apartment 4C">
      <rect x="20" y="20" width="480" height="220" className="outline" />
      {/* lobby */}
      <rect x="200" y="100" width="90" height="80" className="lobby" />
      <text x="245" y="172" textAnchor="middle" className="cap strong">EAST LOBBY</text>
      {/* stairs */}
      <rect x="200" y="30" width="44" height="66" className="stair" />
      <rect x="246" y="30" width="44" height="66" className="stair" />
      <path d="M206 88 L238 38 M252 38 L284 88" className="scissor" />
      <g className="sign" transform="translate(110 40)">
        <rect width="74" height="24" />
        <text x="37" y="16" textAnchor="middle">STAIR A</text>
      </g>
      <g className="sign" transform="translate(306 40)">
        <rect width="74" height="24" />
        <text x="37" y="16" textAnchor="middle">STAIR B</text>
      </g>
      <path d="M222 96 L230 112 M268 96 L260 112" className="arrow" />
      {/* corridor and 4C */}
      <rect x="290" y="120" width="140" height="36" className="corr" />
      <rect x="320" y="160" width="110" height="70" className="unit" />
      <text x="375" y="200" textAnchor="middle" className="cap strong">4C</text>
      <path className="route-ink" d="M222 70 L236 130 L300 138 L375 138 L375 178" />
      <path className="route-ink" d="M268 70 L254 130 L300 138" />
      <text x="40" y="226" className="cap">Floor 4 of Marlowe House (fictional). Sheet A-4.</text>
    </svg>
  );
}

/* ---------- Chapter 3: Sanborn-style figure-ground map (illustrative) ---------- */
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const MAP = (() => {
  const r = rng(42);
  const blocks = [];
  const BW = 150;
  const BH = 96;
  const ST = 26;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 20 + col * (BW + ST);
      const y = 20 + row * (BH + ST);
      const commercial = row === 1; // the main street row
      const lots = [];
      if (commercial) {
        let cx = x;
        while (cx < x + BW - 20) {
          const w = Math.min(x + BW - cx, 34 + Math.floor(r() * 40));
          const pre = r() < 0.75;
          lots.push({ x: cx + 2, y: y + 4, w: w - 4, h: BH - 8 - Math.floor(r() * 20), kind: pre ? 'pre' : 'none' });
          cx += w;
        }
      } else {
        for (const half of [0, 1]) {
          let cx = x;
          while (cx < x + BW - 12) {
            const w = Math.min(x + BW - cx, 16 + Math.floor(r() * 10));
            const depth = 18 + Math.floor(r() * 12);
            const ly = half === 0 ? y + 5 : y + BH - 5 - depth;
            const big = r() < 0.12;
            lots.push({ x: cx + 3, y: ly, w: w - 6 + (big ? 6 : 0), h: depth + (big ? 8 : 0), kind: big && r() < 0.35 ? 'pre' : 'none' });
            cx += w + (big ? 6 : 0);
          }
        }
      }
      blocks.push({ x, y, w: BW, h: BH, lots, commercial });
    }
  }
  return blocks;
})();

export function SanbornMap() {
  return (
    <svg className="fig fig-map" viewBox="0 0 724 508" role="img" aria-label="Illustrative figure-ground map: a row of commercial buildings drawn solid as pre-planned; the surrounding homes drawn as outlines with no plan">
      <defs>
        <pattern id="map-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="4" stroke="#1c2a48" strokeWidth="1.4" />
        </pattern>
      </defs>
      {MAP.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} className="block" />
          {b.lots.map((l, j) => (
            <rect
              key={j}
              x={l.x}
              y={l.y}
              width={Math.max(4, l.w)}
              height={l.h}
              className={`lot ${l.kind}`}
              style={{ transitionDelay: `${(i * 7 + j) * 12}ms` }}
            />
          ))}
        </g>
      ))}
      <text x="362" y="137" textAnchor="middle" className="street">MAIN ST</text>
      <text x="362" y="259" textAnchor="middle" className="street">ELM ST</text>
      <text x="362" y="381" textAnchor="middle" className="street">MARLOWE ST</text>
    </svg>
  );
}

/* ---------- Chapter 4: the pipeline and its real run times ---------- */
const LANE_NAMES = {
  'reader:A-1': 'Reader · A-1, floor 1',
  'reader:A-2': 'Reader · A-2, floors 2, 3, 5',
  'reader:A-4': 'Reader · A-4, floor 4',
  'reader:A-301': 'Reader · A-301, stair section',
  stitcher: 'Stair stitcher',
  checker: 'Checker',
};

export function LanesFigure({ proof }) {
  const order = ['reader:A-301', 'reader:A-1', 'reader:A-4', 'reader:A-2', 'stitcher', 'checker'];
  const lanes = order.map((a) => proof.lanes.find((l) => l.agent === a)).filter(Boolean);
  const total = proof.wall_seconds;
  return (
    <div className="gantt" role="img" aria-label="Gantt timeline of the pipeline run: four sheet readers run in parallel, then the stair stitcher, then the checker">
      <div className="gantt-head">
        <span>AGENT LANE</span>
        <span>TIMELINE (0 s → {Math.round(total)} s)</span>
        <span>TIME · COST</span>
      </div>
      {lanes.map((l) => {
        const leftPct = (l.start_s / total) * 100;
        const widthPct = Math.max(3, (l.seconds / total) * 100);
        return (
          <div key={l.agent} className="gantt-row">
            <div className="gantt-label">{LANE_NAMES[l.agent] ?? l.agent}</div>
            <div className="gantt-track">
              <div
                className={`gantt-bar role-${l.role}`}
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                title={`${LANE_NAMES[l.agent] ?? l.agent}: ${Math.round(l.seconds)} s, $${l.cost_usd.toFixed(2)}`}
              />
            </div>
            <div className="gantt-meta">
              {Math.round(l.seconds)} s · ${l.cost_usd.toFixed(2)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Chapter 4: plans in, model out ---------- */
export function PipelineFigure({ proof }) {
  const lane = (a) => proof.lanes.find((l) => l.agent === a);
  const readers = [
    ['A-1', 'floor 1'],
    ['A-2', 'floors 2, 3, 5'],
    ['A-4', 'floor 4'],
    ['A-301', 'stair section'],
  ];
  const meta = (l) => (l ? `${Math.round(l.seconds)} s · $${l.cost_usd.toFixed(2)}` : '');
  const st = lane('stitcher');
  const ck = lane('checker');
  return (
    <svg className="fig fig-pipe" viewBox="0 0 660 336" role="img" aria-label="Pipeline: four plan sheets go to four sheet readers running in parallel, then a stair stitcher, then a checker, then the building model">
      <defs>
        <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L8 4 L0 8 Z" fill="#1c2a48" />
        </marker>
      </defs>
      <text x="0" y="14" className="col-head">PLANS</text>
      <text x="120" y="14" className="col-head">SHEET READERS · IN PARALLEL</text>
      <text x="336" y="120" className="col-head">STITCH</text>
      <text x="456" y="120" className="col-head">CHECK</text>
      {readers.map(([id, sub], i) => {
        const y = 30 + i * 72;
        const l = lane(`reader:${id}`);
        return (
          <g key={id}>
            <rect x="0" y={y} width="88" height="54" className="sheet" />
            <text x="10" y={y + 24} className="box-title">{id}</text>
            <text x="10" y={y + 40} className="box-sub">{sub}</text>
            <line x1="88" y1={y + 27} x2="118" y2={y + 27} className="flow" markerEnd="url(#arr)" />
            <rect x="120" y={y} width="176" height="54" className="agent" />
            <text x="130" y={y + 24} className="box-title">Reader · {id}</text>
            <text x="130" y={y + 40} className="box-sub mono">{meta(l)}</text>
            <path d={`M296 ${y + 27} C 318 ${y + 27}, 318 165, 338 165`} className="flow" markerEnd="url(#arr)" />
          </g>
        );
      })}
      <rect x="336" y="134" width="108" height="62" className="agent" />
      <text x="346" y="158" className="box-title">Stitcher</text>
      <text x="346" y="176" className="box-sub mono">{meta(st)}</text>
      <line x1="444" y1="165" x2="454" y2="165" className="flow" markerEnd="url(#arr)" />
      <rect x="456" y="134" width="108" height="62" className="agent" />
      <text x="466" y="158" className="box-title">Checker</text>
      <text x="466" y="176" className="box-sub mono">{meta(ck)}</text>
      <line x1="564" y1="165" x2="582" y2="165" className="flow" markerEnd="url(#arr)" />
      <rect x="584" y="134" width="72" height="62" className="model" />
      <text x="620" y="161" textAnchor="middle" className="box-title light">Model</text>
      <text x="620" y="178" textAnchor="middle" className="box-sub light">+ review</text>
      <rect x="456" y="214" width="200" height="50" className="flags" />
      <text x="466" y="235" className="box-sub amber">{proof.checker_flags.length} items flagged for review,</text>
      <text x="466" y="252" className="box-sub amber">including the missing note 7</text>
      <path d="M458 190 C 420 300, 240 330, 230 304" className="flow back" markerEnd="url(#arr)" />
      <text x="330" y="332" className="box-sub">checker can send an error back to its reader</text>
    </svg>
  );
}
