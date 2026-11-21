# Pipeline report

## Latest live run (Nov 21, 18:42–18:50 UTC): `eval/run.json`
- 6 agents: 4 sheet readers in parallel, then the stair stitcher, then the checker.
- **Time and cost:** 455.5 s wall time, 2.33M tokens, about **$1.72** (estimate from token counts at list price).
- **Accuracy (before and after the checker):** 45/45 spaces, 53/53 openings found and correct, connection F1 1.0, 20/20 stair stops; overall 0.996 (two unlabeled closed-off floor-1 areas counted as extra rooms).
- **Trap holds:** both front stairs open into the floor-4 East Lobby; the rear alley → Stair C bypass is found; Stair C's floor-4 door stays `drafted_awaiting_review` (missing note 7).
- **Checker:** 1 round, 0 errors, 6 ambiguities kept for review (missing note 7, rooms with no door, unlabeled areas). The citation guard stopped the invented-note error seen in the earlier run.
- **One-agent test (A-4):** 205.5 s, about $0.33, 100% on floor 4.

The earlier live run (`logs/live-full-20261121-131051`) is described below. It's kept because its checker made one real fix and also invented a note, which led to the guard above.

---


**Status:**
- Pipeline built.
- The one-agent live test passed.
- The full live pipeline ran to completion.
- Both scored 100% against the answer key, and the trap holds before and after the checker.
- **One problem:** the checker invented a note 7 that isn't on the sheet (details below).

## What's built
- **`run.py`:** the entry point (`one-agent | full | all`, plus `--mock`). The key comes from `GEMINI_API_KEY` or `.env` and is redacted from all logs.
- **`pipeline/`:** `config.py`, `agent_client.py` (live Interactions API client plus a mock), `orchestrator.py`, `schema.py` (extracts JSON and checks it against the D5 format), `invariants.py`, `scorer.py`, `mock_agents.py`.
- **Flow:**
  - 4 sheet readers in parallel, each with a render-and-compare self-check.
  - The stair stitcher.
  - Up to 2 checker rounds that send errors back to the owning reader, then a final check.
  - A reply that fails the format check is retried once.
  - Estimated spend is capped at about $30.
- **Answer key isolation:** `scorer.py` scores before and after the checker and is the only module that opens `true_model.json`. No agent ever sees it.
- **Prompts:** 9 files in `prompts/`: format, reader, sheet notes, stitcher, checker, the retry prompt, and three send-back prompts.
- **Mock runs** (`eval/mock/`) exercised the trap fix, the retry path and the send-back path.

## Live one-agent test (reader on A-4): `eval/one_agent_test.json`
- 189.5 s, 414k tokens, about **$0.32**.
- **100%** on floor-4 spaces, openings, connections and stair stops.
- Got the Stair A door right (it opens into the East Lobby) and flagged the "STAIR A (W) ->" callout as contradicting the drawing.
- Flagged that note 7 is missing (the notes jump from 6 to 8) and that the refuse room has no door.
- Render-match 0.91 after one pass.

## Live full pipeline: `eval/run.json`, `eval/model.json`, `eval/model_before_checker.json`, logs in `logs/live-full-*`
- Completed in 728 s, 3.0M tokens, about **$2.69**. Per agent: readers $0.14–0.40, stitcher $0.24, each checker round $0.19–0.27.
- **Accuracy 1.0 before and after the checker** on spaces, openings found and correct, connections, stair stops and overall.
- **Trap holds** both times: both front stairs open into the floor-4 East Lobby, and the rear Stair C route from the alley goes around it.
- The Stair C floor-4 door stays `drafted_awaiting_review`, as intended.
- The final deterministic checks found nothing.
- **Not reflected in the scores:** the model has 2 rooms that aren't in the answer key (`f1-north-void`, `f1-south-void`, unlabeled closed-off areas on floor 1). The scorer doesn't penalize extra rooms.

## Checker: 8 catches
- **4 reasonable ambiguities**, kept for review: the Stair A callout contradicts the drawing; the floor-1 MECH room has no door; the 2 unlabeled floor-1 areas have no doors; the refuse rooms on floors 2–5 have no doors.
- **1 real fix:** the floor-4 elevator door had `fire_rated: true`, inconsistent with the other floors; reader A-4 corrected it.
- **1 invented error, raised 3 times:** the checker claimed A-4 prints "7. STAIR C DOORS ARE FIRE DOORS." It doesn't; the notes go 1–6 then 8. Reader A-4 correctly refused to change its reading each time, and after the round limit the pipeline recorded it as unresolved. It never reached the model, but it cost about **$0.66** in wasted rounds.

## How to run
```
cd builds/claude/pipeline
python -m venv .venv && .venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python run.py one-agent      # live single-reader test
.venv\Scripts\python run.py full           # live 6-task pipeline
.venv\Scripts\python run.py all --mock     # no key needed
```

## Open items
- **Stop invented send-backs:** have code compare checker errors against the readers' existing "unclear" notes, or require the checker to cite where on the sheet it saw something before an error is sent back.
- **Score extra rooms:** count elements that aren't in the answer key.
- **Disk space:** C: dropped to about 8 MB during the run, then recovered.
