"""Track B pipeline entry point.

  python run.py one-agent    [--mock]   one Managed Agent reads A-4 (smoke test)
  python run.py full         [--mock]   4 Managed Agent readers -> local stitch -> agent checker -> scorer
  python run.py all          [--mock]   one-agent test, then the full agent pipeline if it passed
  python run.py fast         [--mock]   fast mode (~35 s): 4 plain Hydrogen calls -> local stitch -> off-critical-path checker + dispatch call
  python run.py dispatch     [--mock]   single at-dispatch report-mapping call against eval/model.json (~5 s)
  python run.py decide                  Gemini Decisions API (gemini-decision-1) maps 5 demo dispatch texts -> eval/decisions_run.json
                                        (--text maps one text and prints it; --threshold sets the needs-confirmation cut, default 0.7)
  python run.py investigate  [--mock]   run parallel Investigator agents on drafted flags (calls pipeline.investigate)
  python run.py score <model.json>      run local invariants + scorer on any D5 model JSON

Live runs read GEMINI_API_KEY from the environment, local .env, or a file named by FLARE_ENV_FILE (keep it outside the repo).
Mock output goes to eval/mock/, live output to eval/.
"""
import argparse
import json
import os
import sys

from pipeline import config, fast_mode, invariants, orchestrator, scorer
from pipeline.agent_client import LiveClient, MockClient, load_api_key


def _print_summary(res):
    acc = res.get("accuracy", {}).get("summary")
    extra = ""
    if "time_to_model_s" in res:
        extra = f" model={res['time_to_model_s']}s checker={res.get('time_to_checker_s')}s"
        if res.get("dispatch_call"):
            extra += f" dispatch={res['dispatch_call'].get('seconds')}s"
    print(
        f"status={res['status']}{extra} cost~${res['totals']['cost_usd']} "
        f"tokens={res['totals']['total_tokens']} catches={len(res.get('checker_catches', []))}"
    )
    if acc:
        for k, (b, f) in acc.items():
            print(f"  {k:24s} before {b}  after {f}")
        print(f"  trap holds               before {res['accuracy']['trap_holds'][0]}  after {res['accuracy']['trap_holds'][1]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["one-agent", "full", "all", "fast", "dispatch", "decide", "investigate", "score"])
    ap.add_argument("model_file", nargs="?", help="path to D5 model JSON (for 'score' or 'dispatch')")
    ap.add_argument("--mock", action="store_true", help="use canned fake agent replies (no API calls)")
    ap.add_argument("--text", default=None, help="dispatch text for 'dispatch', 'fast' or 'decide'")
    ap.add_argument("--threshold", type=float, default=None, help="'decide': top-probability cut for needs_confirmation")
    a = ap.parse_args()

    if a.what == "decide":
        from pipeline import decide
        model_path = a.model_file or os.path.join(config.EVAL_DIR, "model.json")
        with open(model_path, encoding="utf-8") as f:
            data = json.load(f)
        layout = data.get("layout", data)
        thr = decide.THRESHOLD if a.threshold is None else a.threshold
        if not load_api_key():
            print("Cannot start live run: no GEMINI_API_KEY. Set it, or point FLARE_ENV_FILE at a .env file outside the repo.")
            return 2
        if a.text:
            rec = decide.decide(layout, a.text, threshold=thr)
            print(json.dumps(rec, indent=2))
            return 0 if rec.get("error") is None else 1
        baseline = None
        fast_path = os.path.join(config.EVAL_DIR, "fast_run.json")
        if os.path.exists(fast_path):
            with open(fast_path, encoding="utf-8") as f:
                dc = json.load(f).get("dispatch_call") or {}
            baseline = {"source": "eval/fast_run.json dispatch_call", "model": config.FAST_MODEL, "latency_ms": round(dc["seconds"] * 1000) if dc.get("seconds") else None}
        res = decide.run_demo(layout, os.path.join(config.EVAL_DIR, "decisions_run.json"), threshold=thr, baseline=baseline)
        for c in res["calls"]:
            if c.get("error"):
                print(f"  {c['case']:10s} ERROR {c['error']}")
                continue
            a_ = c["answers"]
            print(
                f"  {c['case']:10s} {c['latency_ms']:5d} ms  target={a_['target']['choice']} ({a_['target']['probability']})  "
                f"condition={a_['condition']['choice']} ({a_['condition']['probability']})  "
                f"kind={a_['kind']['choice']} ({a_['kind']['probability']})  needs_confirmation={c['needs_confirmation']}"
            )
        print(f"status={res['status']} latency_ms={res['latency_ms']} baseline={baseline}")
        return 0 if res["status"] == "completed" else 1

    if a.text is None:
        a.text = fast_mode.DEFAULT_DISPATCH_TEXT

    if a.what == "score":
        if not a.model_file:
            ap.error("score requires a path to a D5 model JSON file")
        with open(a.model_file, encoding="utf-8") as f:
            data = json.load(f)
        layout = data.get("layout", data)
        out = {
            "invariants": invariants.check_model(layout),
            "score": scorer.score(layout),
        }
        print(json.dumps(out, indent=2))
        return 0

    if a.mock:
        client, out = MockClient(), config.MOCK_EVAL_DIR
    else:
        try:
            client = LiveClient()
        except RuntimeError as e:
            print(f"Cannot start live run: {e}. Set GEMINI_API_KEY, or point FLARE_ENV_FILE at a .env file outside the repo.")
            return 2
        out = config.EVAL_DIR

    if a.what == "fast":
        res = fast_mode.fast_pipeline(client, out, dispatch_text=a.text)
        _print_summary(res)
        return 0 if res["status"] == "completed" else 1

    if a.what == "dispatch":
        model_path = a.model_file or os.path.join(config.EVAL_DIR, "model.json")
        with open(model_path, encoding="utf-8") as f:
            data = json.load(f)
        layout = data.get("layout", data)
        res = fast_mode.dispatch_call(client, layout, text=a.text)
        print(json.dumps(res, indent=2))
        return 0 if res.get("status") in ("completed", "idle") and res.get("result") else 1

    if a.what == "investigate":
        from pipeline import investigate
        return investigate.main(["--mock"] if a.mock else [])

    if a.what in ("one-agent", "all"):
        rec = orchestrator.one_agent_test(client, out)
        if not rec["ok"]:
            print("One-agent test failed; not running the pipeline. Errors:")
            for e in rec["errors"]:
                print("  -", e)
            return 1

    if a.what in ("full", "all"):
        res = orchestrator.full_pipeline(client, out)
        _print_summary(res)
        return 0 if res["status"] == "completed" else 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
