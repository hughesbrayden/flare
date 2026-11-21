# Flare

Flare is an interactive model of a building that a fire crew can question on the way to a call: which entrances lead where, where routes share a choke point, and what still needs checking on arrival.

This repo has two parts:

- **The site** (this folder): a four-chapter story at `/` and the full-screen demo at `/demo`. It's static. Nothing calls an API at runtime.
- **The pipeline** (`pipeline/`): two-tier architecture — **before the call**, Gemini Managed Agents read each sheet in parallel, plain code stitches the floors (4 ms), a checker flags ambiguities, and parallel **investigator agents** attach cited cross-sheet evidence without ever clearing `drafted_awaiting_review`; **at dispatch**, a saved model loads in ~1 s and one small call maps a caller report (~5 s), or an unmapped building uses `run.py fast` (~35 s to model, checker off the critical path).

The demo building, **Marlowe House (142–144 Marlowe St), is fictional.** We drew its four plan sheets and an answer key for it.

## What the demo shows

A dispatch says smoke near apartment 4C. The two front entrances look like separate ways up, but their stairs (A and B) are scissor stairs in one shaft and both open into the same east lobby on floor 4. Every way around that lobby goes through Stair C, either from the rear alley gate (access unconfirmed) or by crossing over on floor 3, and Stair C's floor-4 door is annotated "F.D. — see note 7", and note 7 is missing from the sheet.

In the demo you can:

- step through the call with scripted buttons (dispatch, what-ifs, a caller's report at 2:16 AM, a unit verifying the lobby),
- tap any room, door or stair to see it on the original sheet or assume it unavailable,
- undo any what-if.

Facts from the drawings, reports, and what-ifs are kept in three separate lanes. A report flags a route but never closes it; only a what-if or a verified block closes one. When nothing is left the answer is "No documented route."

Routing is plain, deterministic code in `src/engine/routing.js` (no model involved): no routes through other apartments, the elevator is excluded (sheet A-4 says it isn't for fire service use), floors are climbed without doubling back, and routes are ranked by fewest open questions, then distance (door to door plus 6 m per floor), then fewest floor changes.

## Run the site

```
npm install
npm run dev        # http://localhost:5173/ (story) and /demo
npm test           # routing engine tests and pipeline-data checks
npm run build      # static site in dist/ (serves / and /demo via SPA rewrite)
npm run preview    # serve dist/ locally
```

Deploy `dist/` to any static host. `vercel.json` rewrites all routes to `/index.html` so `/` and `/demo` both deep-link cleanly.

Data scripts:

- `npm run sync-data` copies the building model and sheets from `data/marlowe/` into `src/data/` and `public/sheets/`.
- `node scripts/sync-proof.mjs [path/to/run.json]` rebuilds `src/data/proof.json` (the pipeline numbers on the site) from the pipeline's `eval/run.json`.

## Run the pipeline

Needs Python 3 and a Gemini API key with Managed Agents enabled, in `GEMINI_API_KEY` or a `.env` file (never commit it).

```
cd pipeline
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt     # macOS/Linux: .venv/bin/pip
.venv\Scripts\python run.py all --mock            # no key needed
.venv\Scripts\python run.py one-agent             # live: one sheet reader on A-4
.venv\Scripts\python run.py full                  # live: full Managed Agents pipeline
.venv\Scripts\python run.py fast                  # live: fast pass (~35 s) for unmapped buildings
.venv\Scripts\python -m pipeline.investigate      # live: parallel investigator agents (1 per flag)
```

How the two-tier pipeline works:

1. **Before the call (Managed Agents):** Four sheet readers run in parallel in isolated sandboxes (each redraws its reading against the sheet, up to 2 passes). Plain deterministic code stitches typical floors and vertical shafts (~6 ms). A checker runs fixed invariants and visual inspection (can send errors back up to 2 rounds). Then **investigator agents** (6 parallel agents in 75.7 s, one per `drafted_awaiting_review` flag) crop and compare across all four sheets to attach cited context while keeping `layout_status: "drafted_awaiting_review"` unchanged until verified on scene.
2. **At dispatch (seconds):** A saved building loads in ~1 s, one small call maps a caller report (**3.4 s** live), and deterministic JS code routes locally.
3. **Unmapped building (`run.py fast`):** Parallel plain-call readers + local stitcher produce a navigable model in **32.4 s** live (checker finishes off the critical path at **69.6 s**).

We do not claim Managed Agents are more accurate than plain calls on Marlowe House; agents earn their keep via sandbox render checks and cross-sheet investigations before any call. Smoke simulation is deferred post-MVP. Managed Agents has no built-in fan-out, so the orchestrator starts parallel agents itself. `scorer.py` is the only code that opens the answer key; no agent sees it.

## Results (latest live run, 2026-11-21)

From `pipeline/eval/run.json`:

| Agent | Time | Tokens | Est. cost |
|---|---|---|---|
| Reader A-301 | 103 s | 208k | $0.16 |
| Reader A-1 | 195 s | 386k | $0.33 |
| Reader A-4 | 211 s | 354k | $0.32 |
| Reader A-2 | 229 s | 474k | $0.37 |
| Stitcher | 114 s | 272k | $0.29 |
| Checker (1 round) | 113 s | 635k | $0.25 |
| **Total** | **7 min 36 s wall** | **2.33M** | **$1.72** |

Cost is estimated from token counts at list price; sandbox compute was free during the preview.

- **Checker:** 0 errors, 6 items flagged for review: the missing note 7 on Stair C's floor-4 door (A-4); rooms drawn with no door (floor-1 mechanical room; refuse rooms on floors 2–5); two unlabeled enclosed areas on floor 1. The final rule checks found nothing.
- **Against the answer key** (same before and after the checker, since nothing was sent back): all 45 rooms found, 53 of 53 doors and openings correct, 53 of 53 connections, 20 of 20 stair stops. The two unlabeled floor-1 areas aren't in the key, so room precision is 95.7% and the overall score is 99.6%. Stair C's floor-4 door stays marked for review, as intended.
- The answer key is ours, for a building we drew. This shows the pipeline works on our sheets; it doesn't show how it does on real drawings. An earlier, separate test on 3 real floor plans matched 89–96% of rooms, with routes to bedrooms right on all 3.

Not done yet: a timed test of firefighters reading the sheets against using Flare; smoke spread (the smoke drawing on the site is an illustration); turning radio traffic or spoken questions into model changes (the demo uses buttons instead).

## Sources

Every statistic on the site is cited where it appears. Full list:

1. U.S. Fire Administration, *Civilian Fire Fatalities in Residential Buildings* (2017–2019 data). https://www.usfa.fema.gov/statistics/reports/who-fire-impacts/civilian-fire-fatalities-residential-buildings-v21i3.html
2. S. Kerber, *Analysis of Changing Residential Fire Dynamics and Its Implications on Firefighter Operational Timeframes*, Fire Technology (2012). https://technicalpanels.fsri.org/docs/Analysis_of_Changing_Residential_Fire_Dynamics_and_Its_Implications_on_Firefighter_Operational_Timeframes.pdf
3. NFPA 1710 response-time objectives (now in NFPA 1750), via DC Fire & EMS. https://fems.dc.gov/page/fire-response-time
4. FDNY testimony to the NYC Council, April 6, 2022; NYC Executive Order 12 (2022). https://legistar.council.nyc.gov/View.ashx?GUID=9DFBC4AB-0B82-44E0-A836-91CD52CD7518&ID=10817061&M=F · https://www.nyc.gov/assets/home/downloads/pdf/executive-orders/2022/eo-12.pdf
5. UL FSRI, *Analysis of the Coordination of Suppression and Ventilation in Multi-Family Dwellings* (2020). https://fsri.org/research-update/technical-report-released-multi-family-dwellings-experiments
6. FDNY Firefighting Procedures, *High Rise Fireproof Multiple Dwellings* (2025). https://www.nyc.gov/assets/fdny/downloads/pdf/join/probationary-firefighter-v2.pdf
7. NIOSH Fire Fighter Fatality Investigation F2025-02. https://www.cdc.gov/niosh/firefighters/programs/pdfs/face202502RS.pdf
8. Firehouse, "The Mayday Project" (2016; preliminary data). https://www.firehouse.com/home/article/12156553/the-mayday-project
9. NFPA, *Fire Loss in the United States During 2021*; USFA. https://www.usfa.fema.gov/downloads/pdf/statistics/v21i6.pdf
10. Fire Engineering, "Residential Pre-Incident Intelligence" (2001). https://www.fireengineering.com/firefighting/residential-preincident-intelligence/
11. OGC, *Indoor Mapping and Navigation Pilot Engineering Report* (OGC 18-089, 2019). https://docs.ogc.org/per/18-089.html
12. NCDOT / East Carolina University, *RP2024-04* (2025) — 81-firefighter study rating navigable 3D imagery vs. 2D plans for understanding navigation (ratings, not task performance). https://connect.ncdot.gov/projects/research/RNAProjDocs/Final%20Report_RP2024-04.pdf

Flare is a hackathon prototype and is not for operational use.
