"""Track B pipeline entry point.

  python run.py one-agent [--mock]   one Managed Agent reads A-4 (smoke test)
  python run.py full      [--mock]   4 readers -> stitcher -> checker loop -> scorer
  python run.py all       [--mock]   one-agent test, then the full pipeline only if it passed
  python run.py score <model.json>   run local invariants + scorer on any D5 model JSON

Live runs need GEMINI_API_KEY in the environment or in .env next to this file.
Mock output goes to eval/mock/, live output to eval/.
"""
import argparse
import json
import sys

from pipeline import config, invariants, orchestrator, scorer
from pipeline.agent_client import LiveClient, MockClient


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["one-agent", "full", "all", "score"])
    ap.add_argument("model_file", nargs="?", help="path to D5 model JSON (for 'score')")
    ap.add_argument("--mock", action="store_true", help="use canned fake agent replies (no API calls)")
    a = ap.parse_args()
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
            print(f"Cannot start live run: {e}. Put GEMINI_API_KEY=... in .env (see REPORT.md).")
            return 2
        out = config.EVAL_DIR
    if a.what in ("one-agent", "all"):
        rec = orchestrator.one_agent_test(client, out)
        if not rec["ok"]:
            print("One-agent test failed; not running the pipeline. Errors:")
            for e in rec["errors"]:
                print("  -", e)
            return 1
    if a.what in ("full", "all"):
        res = orchestrator.full_pipeline(client, out)
        acc = res.get("accuracy", {}).get("summary")
        print(f"status={res['status']} cost~${res['totals']['cost_usd']} tokens={res['totals']['total_tokens']} "
              f"catches={len(res.get('checker_catches', []))}")
        if acc:
            for k, (b, f) in acc.items():
                print(f"  {k:24s} before {b}  after {f}")
            print(f"  trap holds               before {res['accuracy']['trap_holds'][0]}  after {res['accuracy']['trap_holds'][1]}")
        return 0 if res["status"] == "completed" else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
