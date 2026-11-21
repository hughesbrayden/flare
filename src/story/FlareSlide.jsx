import React, { useEffect, useMemo, useRef, useState } from 'react';
import Scene, { TARGET, buildEndMs } from '../Scene.jsx';
import { findRoutes } from '../engine/routing.js';
import { model } from '../geometry.js';
import { placeName, entranceName, stairName } from '../narrate.js';
import proof from '../data/proof.json';
import { PinSectionFigure } from './Figures.jsx';
import './flare.css';

// Slide 02: one persistent view whose beats play in place.
// 0 intro still · 1 expand (empty) + the call · 2 gathering the plans · 3 generating → model, front routes, first answer
// 4 "The lobby is not available." · 5 "Show me where it comes out."
// Everything shown is derived from (beat, time since the beat started), so rewinding or jumping lands on an exact state.
// The chat is a scripted playback; Flare's answers are built from the routing engine's output, numbers from proof.json.
const B = { INTRO: 0, CALL: 1, GATHER: 2, GEN: 3, LOBBY: 4, WHERE: 5 };
export const FLARE_BEATS = 6;
export const FLARE_EXPAND_BEAT = B.CALL;

const OVERVIEW = { anchor: null, zoom: 17 };
const NEHALL = { anchor: { x: 20.5, y: 8.5, floor: 4 }, zoom: 40 };
const LOBBY = 'f4-east-lobby';
const DOOR_C4 = 'door-f4-stair-c';

const ASSUMED = [
  {
    condition_id: 'cond-001',
    target_id: LOBBY,
    kind: 'assumed_unavailable',
    timestamp: '2:15 AM',
    source: { actor: 'Officer', trigger: 'chat', prompt: 'The lobby is not available.' },
  },
];
const ASSUMED_VIEW = ASSUMED.map((c) => ({ ...c, state: 'assumed', time: c.timestamp, key: c.target_id }));

const BASE = findRoutes(model, TARGET, []);
const WHATIF = findRoutes(model, TARGET, ASSUMED);
const UNCLEAR = model.layout.openings.filter((o) => o.layout_status === 'drafted_awaiting_review').map((o) => o.id);

const uniq = (a) => [...new Set(a)];
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
const listJoin = (a, word) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} ${word} ${a[a.length - 1]}`);

// The two front routes: confirmed street entrances whose routes share the front chokepoint (the floor-4 east lobby).
const CONFIRMED = new Set(model.layout.entrances.filter((e) => e.access_confirmed).map((e) => e.id));
const FRONT_CP = BASE.chokepoints.confirmed.primary?.id ?? LOBBY;
const FRONT = BASE.routes.filter((r) => CONFIRMED.has(r.entrance_id) && r.elements.includes(FRONT_CP));
const FRONT_ENTRANCES = uniq(FRONT.map((r) => r.entrance_id));

// Real fast-pass numbers (proof.json). Per-reader lanes are used if the sync provides fast_run.lanes.
const FAST = proof.fast_run && !proof.fast_run.pending ? proof.fast_run : null;
const FAST_LANES = Array.isArray(FAST?.lanes) ? FAST.lanes : null;
const SHEETS = [
  { id: 'A-1', label: 'Plan sheet A-1 · floor 1' },
  { id: 'A-2', label: 'Plan sheet A-2 · floors 2, 3, 5' },
  { id: 'A-4', label: 'Plan sheet A-4 · floor 4' },
  { id: 'A-301', label: 'Stair section A-301' },
];
const laneFraction = (sheet) => {
  const l = FAST_LANES?.find((x) => x.agent === `reader:${sheet}`);
  return l && FAST?.time_to_model_s ? clamp01(l.seconds / FAST.time_to_model_s) : null;
};

/* ---------- Flare's answers, from the engine ---------- */

function firstAnswer() {
  const doors = uniq(FRONT.map((r) => entranceName(r.entrance_id))).sort();
  const stairs = uniq(FRONT.map((r) => stairName(r.verticals[0].id))).sort();
  return [
    `Most direct way to 4C: either front door (${listJoin(doors, 'or')}), up ${listJoin(stairs, 'or')}.`,
    `Both stairs come out in the same place: ${placeName(FRONT_CP)}.`,
  ];
}

function lobbyReply() {
  const lines = [`Assuming ${placeName(FRONT_CP)} is out, both front routes are closed.`];
  if (WHATIF.status === 'no_route') return [...lines, 'No documented route is left.'];
  const stairs = uniq(WHATIF.routes.map((r) => stairName(r.verticals[r.verticals.length - 1].id)));
  const direct = WHATIF.routes.filter((r) => r.verticals.length === 1).map((r) => `from ${entranceName(r.entrance_id)}`);
  const cross = WHATIF.routes.filter((r) => r.verticals.length > 1);
  const ways = [...uniq(direct)];
  if (cross.length) {
    const floors = uniq(cross.map((r) => r.verticals[0].to_floor));
    ways.push(`crossing on floor ${floors.join(' or ')} from either front stair`);
  }
  const via = WHATIF.chokepoints.global.primary?.id;
  lines.push(`The way around is ${listJoin(stairs, 'or')}: ${listJoin(ways, 'or')}.${via ? ` Every way comes out through ${placeName(via)}.` : ''}`);
  const flags = uniq(WHATIF.routes.flatMap((r) => r.flags.map((f) => `${f.type}|${f.element_id}`)));
  const checks = flags.map((k) => {
    const [type, id] = k.split('|');
    if (type === 'unconfirmed_access') return `${entranceName(id)} access (unconfirmed)`;
    if (type === 'unclear_drawing') return `${placeName(id)} (it says “see note 7”; note 7 is missing)`;
    return placeName(id);
  });
  if (checks.length) lines.push(`Check on arrival: ${listJoin(checks, 'and')}.`);
  return lines;
}

function whereReply() {
  const note7 = proof.investigations && !proof.investigations.pending ? proof.investigations.note7 : null;
  const others = (note7?.evidence ?? []).filter((e) => e.sheet !== 'A-4' && e.quote.includes('GENERAL NOTES'));
  const quote = others[0]?.quote.split('GENERAL NOTES: ')[1];
  const lines = [`${stairName('stair-c')} comes out through ${placeName(DOOR_C4)} into ${placeName('f4-ne-hall')}, then the east corridor to 4C.`];
  if (quote) {
    lines.push(`Sheet A-4 marks that door “see note 7”, and its notes skip 7. Sheets ${listJoin(others.map((e) => e.sheet), 'and')} say “${quote}”`);
  }
  lines.push('Still unverified: a note on another sheet doesn’t prove it applies here. Check the door on scene.');
  return lines;
}

const FIRST = firstAnswer();
const ASK_LOBBY = 'The lobby is not available.';
const ASK_WHERE = 'Show me where it comes out.';
const REPLY_LOBBY = lobbyReply();
const REPLY_WHERE = whereReply();

/* ---------- timelines (ms from the start of a beat; only played when stepping forward) ---------- */

const LINE_MS = 320;
const typingTimes = (ask) => {
  const START = 350;
  const PER = 38;
  const SEND = START + ask.length * PER + 380;
  return { START, PER, SEND };
};
const G = (() => {
  const LANES = 2600; // compressed reading animation
  const FOLD = LANES + 300; // cards exit: sheets fold away, the dispatch header fades (EXIT_MS) …
  const EXIT_MS = 400;
  const FLOORS = FOLD + EXIT_MS + 250; // … then the stage stays empty for a beat before any geometry
  const BUILT = FLOORS + buildEndMs(); // floors rise one by one (Scene BUILD timings)
  const ROUTES = BUILT + 150; // routes only after the last floor settles
  const ROUTE_MS = 1100;
  const LABELS = ROUTES + ROUTE_MS + 100; // labels (and the dispatch header) last
  const ANSWER = LABELS;
  return { LANES, FOLD, EXIT_MS, FLOORS, BUILT, ROUTES, ROUTE_MS, LABELS, ANSWER, END: Math.max(LABELS + 450, ANSWER + FIRST.length * LINE_MS + 100) };
})();
const L = (() => {
  const ty = typingTimes(ASK_LOBBY);
  const ERASE = ty.SEND + 250;
  const ERASE_MS = 520;
  const DRAW = ERASE + ERASE_MS + 80;
  const DRAW_MS = 1100;
  return { ...ty, ERASE, ERASE_MS, DRAW, DRAW_MS, END: DRAW + Math.max(DRAW_MS, REPLY_LOBBY.length * LINE_MS) + 60 };
})();
const W = (() => {
  const ty = typingTimes(ASK_WHERE);
  const REPLY = ty.SEND + 700;
  return { ...ty, REPLY, END: REPLY + REPLY_WHERE.length * LINE_MS };
})();
const END_OF = { [B.GEN]: G.END, [B.LOBBY]: L.END, [B.WHERE]: W.END };

function Composer({ text, sending }) {
  return (
    <div className={`fl-composer ${sending ? 'sending' : ''}`} aria-hidden="true">
      <div className="fl-input">
        {text ? (
          <>
            {text}
            <i className="caret" />
          </>
        ) : (
          <span className="ph">Ask about the building…</span>
        )}
      </div>
      <div className="fl-send">↑</div>
    </div>
  );
}

export default function FlareSlide({ beat, on, ready, onBeat, footer }) {
  const [clock, setClock] = useState({ beat, t: Infinity, t0: 0 });
  const lastBeat = useRef(beat);
  const logRef = useRef(null);
  const noop = useMemo(() => () => {}, []);

  // Stepping forward into a timed beat plays it; anything else (rewind, jump, leaving the slide) shows its end state.
  // Reduced motion: every beat shows its end state.
  const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const willPlay = !reduced && on && beat === lastBeat.current + 1 && END_OF[beat] != null;
  useEffect(() => {
    const prev = lastBeat.current;
    lastBeat.current = beat;
    if (reduced || !(on && beat === prev + 1 && END_OF[beat] != null)) {
      setClock({ beat, t: Infinity, t0: 0 });
      return undefined;
    }
    const end = END_OF[beat];
    const t0 = performance.now();
    let raf = 0;
    setClock({ beat, t: 0, t0 });
    // Driven by elapsed time on animation frames, so throttling can only lower the frame rate, never the pace.
    const step = () => {
      const t = performance.now() - t0;
      if (t >= end) {
        setClock({ beat, t: Infinity, t0 });
        return;
      }
      setClock({ beat, t, t0 });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [beat, on, reduced]);

  const t = clock.beat === beat ? clock.t : willPlay ? 0 : Infinity;
  const at = (b) => (beat > b ? Infinity : beat === b ? t : -Infinity); // time inside beat b

  /* ---------- derived state ---------- */
  const expanded = beat >= B.CALL;
  const gT = at(B.GEN);
  const lT = at(B.LOBBY);
  const wT = at(B.WHERE);

  // Floors rise inside the 3D view from a timestamp (see Scene BuildGroup); null = nothing generated yet.
  const buildAt =
    gT === Infinity ? -Infinity : gT === -Infinity || clock.beat !== beat ? null : clock.t0 + G.FLOORS;
  const built = gT >= G.BUILT;
  const labelsOn = gT >= G.LABELS;
  const laneP = beat === B.GEN ? clamp01(gT / G.LANES) : 0;
  const showSheets = beat === B.GATHER || (beat === B.GEN && gT < G.FOLD + G.EXIT_MS + 50);
  const callAway = beat === B.GEN && gT >= G.FOLD && gT < G.LABELS;
  const folding = beat === B.GEN && gT >= G.FOLD;
  const frontK = clamp01((gT - G.ROUTES) / G.ROUTE_MS);
  const assumed = lT >= L.ERASE;
  const redrawn = lT >= L.DRAW;

  let routeAnim;
  if (!redrawn && !assumed) routeAnim = { routes: frontK > 0 ? FRONT.map((r) => ({ r, progress: ease(frontK) })) : [] };
  else if (!redrawn) routeAnim = { routes: FRONT.map((r) => ({ r, progress: 1 - ease(clamp01((lT - L.ERASE) / L.ERASE_MS)) })) };
  else routeAnim = { routes: WHATIF.routes.map((r) => ({ r, progress: ease(clamp01((lT - L.DRAW) / L.DRAW_MS)) })) };
  const emphasize = beat !== B.INTRO && frontK >= 1 && labelsOn && !assumed ? [{ id: FRONT_CP, label: 'EAST LOBBY' }] : [];
  const focus = wT >= W.REPLY ? NEHALL : OVERVIEW;

  /* ---------- chat ---------- */
  const msgs = [];
  if (beat >= B.CALL) {
    msgs.push({ key: 'lookup', who: 'flare', cls: 'stagger', lines: ['Looking up 142–144 Marlowe St…', 'No saved model for this address. Building one from the plans.'] });
  }
  if (beat >= B.GATHER) {
    msgs.push({ key: 'gather', who: 'flare', cls: 'stagger list', lines: ['Found 4 plan sheets:', ...SHEETS.map((s) => s.label)] });
  }
  if (beat >= B.GEN) {
    const lines = ['Reading all 4 sheets in parallel…'];
    if (gT >= G.LANES && FAST) {
      lines.push(
        `Navigable model in ${Math.round(FAST.time_to_model_s)} s (measured on our test building). Floors stitched in ${Math.max(1, Math.round(FAST.stitch_ms))} ms; the checker keeps going in the background.`,
      );
    }
    msgs.push({ key: 'gen', who: 'flare', lines });
    if (gT >= G.ANSWER) msgs.push({ key: 'first', who: 'flare', lines: FIRST.slice(0, Math.min(FIRST.length, 1 + Math.floor((gT - G.ANSWER) / LINE_MS))) });
  }
  const exchange = (key, ask, reply, T, sendAt, replyAt) => {
    if (T >= sendAt) msgs.push({ key: `q-${key}`, who: 'officer', text: ask });
    if (T >= sendAt && T < replyAt) msgs.push({ key: `t-${key}`, who: 'thinking' });
    if (T >= replyAt) msgs.push({ key: `a-${key}`, who: 'flare', lines: reply.slice(0, Math.min(reply.length, 1 + Math.floor((T - replyAt) / LINE_MS))) });
  };
  if (beat >= B.LOBBY) exchange('lobby', ASK_LOBBY, REPLY_LOBBY, lT, L.SEND, L.DRAW);
  if (beat >= B.WHERE) exchange('where', ASK_WHERE, REPLY_WHERE, wT, W.SEND, W.REPLY);
  const lastMsg = msgs[msgs.length - 1];
  if (beat === B.WHERE && wT === Infinity && lastMsg) lastMsg.last = true;

  let typing = '';
  let sending = false;
  const typeFor = (ask, T, ty) => {
    if (T >= ty.START && T < ty.SEND) typing = ask.slice(0, Math.min(ask.length, Math.floor((T - ty.START) / ty.PER) + 1));
    if (T >= ty.SEND && T < ty.SEND + 350) sending = true;
  };
  if (beat === B.LOBBY && lT !== Infinity) typeFor(ASK_LOBBY, lT, L);
  if (beat === B.WHERE && wT !== Infinity) typeFor(ASK_WHERE, wT, W);

  // Keep the chat pinned to the latest message: follow any growth of the log (new messages, streamed lines,
  // wrapping after a resize), and also re-pin whenever the beat changes (rewinds shrink the log).
  useEffect(() => {
    const el = logRef.current;
    if (!el) return undefined;
    let raf = 0;
    const pin = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
    };
    const mo = new MutationObserver(pin);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(pin) : null;
    ro?.observe(el);
    pin();
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      ro?.disconnect();
    };
  }, []);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [beat]);

  return (
    <div className={`flare beat-${beat} ${expanded ? 'expanded' : ''} ${built ? 'built' : ''}`}>
      <div className="fl-intro">
        <h2>Introducing Flare: rendering interactive 3D floorplans for fire crews.</h2>
        <div className="lede">
          <p>
            Flare turns a building’s drawings into a navigable 3D model—pre-built or generated in minutes at dispatch—mapping
            every entrance, stair, and shared hallway to the unit.
          </p>
          <p>
            En route, the first-arriving officer can rule out blocked spaces in plain language and see backup routes update
            immediately.
          </p>
        </div>
        <p className="src">Marlowe House is fictional. Press → to open it.</p>
      </div>

      <div className="fl-view" data-noswipe={expanded ? '' : undefined}>
        <div className="fl-chrome">Demo: 2:14 AM · Smoke reported near apartment 4C</div>
        {/* intro: the 2D cross-section; it crossfades out as the frame expands into the (still empty) 3D view */}
        <div className="fl-section" aria-hidden={expanded}>
          <PinSectionFigure />
        </div>
        <div className="fl-canvas">
          {ready && (
            <Scene
              result={BASE}
              baseline={BASE}
              conditionsView={assumed ? ASSUMED_VIEW : []}
              exploded
              focus={focus}
              selected={null}
              onSelect={noop}
              onPin={noop}
              unclearIds={UNCLEAR}
              embedded
              minimal
              routeAnim={routeAnim}
              showClosed={false}
              showFlags={redrawn}
              showStairTags={redrawn}
              entranceIds={redrawn ? null : FRONT_ENTRANCES}
              buildAt={buildAt}
              labelsOn={labelsOn}
              emphasize={emphasize}
            />
          )}
        </div>

        {expanded && (
          <div className={`fl-call ${beat >= B.GATHER ? 'compact' : ''} ${callAway ? 'away' : ''}`}>
            <div className="t">2:14 AM · ENGINE 7</div>
            <div className="l">Smoke reported near apartment 4C</div>
            <div className="t">142–144 MARLOWE ST</div>
          </div>
        )}

        {showSheets && (
          <div className={`fl-sheets ${folding ? 'fold' : ''}`}>
            <div className="fl-sheet-grid">
              {SHEETS.map((sh, i) => {
                const f = laneFraction(sh.id);
                return (
                  <figure key={sh.id} className="fl-sheet" style={{ '--i': i }}>
                    <img src={`${import.meta.env.BASE_URL}sheets/${sh.id}.png`} alt={sh.label} />
                    <figcaption>{sh.id}</figcaption>
                    {beat === B.GEN && f != null && (
                      <div className="fl-lane">
                        <i style={{ width: `${Math.min(laneP, f) * 100}%` }} />
                      </div>
                    )}
                  </figure>
                );
              })}
            </div>
            {beat === B.GEN && (
              <div className="fl-gen">
                {!FAST_LANES && (
                  <div className="fl-lane shared" title="Four readers run side by side">
                    <i style={{ width: `${laneP * 100}%` }} />
                  </div>
                )}
                {FAST ? (
                  <p>
                    <span className="fl-gen-t">{Math.round(laneP * FAST.time_to_model_s)} s</span>
                    {laneP >= 1 ? ' to a navigable model' : ' · 4 readers in parallel'}
                    <small>measured on our test building</small>
                  </p>
                ) : (
                  <p>4 readers in parallel</p>
                )}
              </div>
            )}
          </div>
        )}

        {assumed && (
          <button type="button" className="fl-chip" onClick={() => onBeat(B.GEN)}>
            Assuming: east lobby unavailable · <u>undo</u>
          </button>
        )}
        {built && (
          <div className="fl-legend">
            <span><i className="lk route" />route</span>
            {redrawn && <span><i className="lk unverified" />unverified</span>}
          </div>
        )}
      </div>

      <aside className="fl-chat" aria-label="Flare conversation (scripted playback)">
        <div className="fl-chat-head">
          <b>Flare</b>
          <span>Marlowe House · scripted playback</span>
        </div>
        <div className="fl-log" ref={logRef} aria-live="polite">
          {msgs.map((m) =>
            m.who === 'officer' ? (
              <div key={m.key} className="msg m-officer">
                <span className="who">Engine 7 officer</span>
                <div className="bubble">{m.text}</div>
              </div>
            ) : m.who === 'thinking' ? (
              <div key={m.key} className="msg m-flare thinking">
                <span className="who">Flare</span>
                <div className="dots3">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            ) : (
              <div key={m.key} className={`msg m-flare ${m.cls || ''}`}>
                <span className="who">Flare</span>
                {m.lines.map((l, i) => (
                  <p key={i} style={m.cls ? { animationDelay: `${0.25 + i * 0.35}s` } : undefined}>
                    {l}
                  </p>
                ))}
                {m.last && footer}
              </div>
            ),
          )}
        </div>
        <Composer text={typing} sending={sending} />
      </aside>
    </div>
  );
}
