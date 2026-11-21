"""Investigator agents: one Managed Agent per flagged item, launched in parallel.

  python -m pipeline.investigate          live run (reads eval/model.json + eval/run.json, writes eval/investigations.json)
  python -m pipeline.investigate --mock   canned replies, writes eval/mock/investigations.json

Each agent gets all four sheets (attached and mounted in its sandbox) plus one flag, and returns
cited cross-sheet evidence. Rule Y5: evidence attaches, the item stays drafted_awaiting_review.
This module never writes model.json and refuses any reply that tries to change a status.
"""
import argparse
import base64
import copy
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from . import config, schema
from .agent_client import AgentTask, AgentResult, Redactor, estimate_cost, now_iso

DRAFTED = "drafted_awaiting_review"
CONFIDENCE = ("high", "medium", "low")
ROLE = "investigator"
TOKEN_CAP = 1_000_000
TIMEOUT_SECONDS = 15 * 60
MAX_COST_USD = float(os.environ.get("TRACKB_INVESTIGATE_MAX_COST_USD", "10"))
# Element fields shown to an agent. Interpretive fields (review_note, kind, fire_rated, ...) are left out
# so the prompt describes where the item is, not what someone already concluded it means.
ELEMENT_FIELDS = ("id", "label", "floor", "bbox_m", "pos_m", "connects", "street_label", "source_ref")
COLLECTIONS = ("spaces", "openings", "verticals", "entrances")
# Optional key file outside the repo (FLARE_ENV_FILE). Loaded into the process environment only.
KEY_FILE = config.EXTERNAL_DOTENV_PATH


# ---------------------------------------------------------------- helpers
def _read(path, mode="r"):
    with open(path, mode, **({} if "b" in mode else {"encoding": "utf-8"})) as f:
        return f.read()


def _prompt(name):
    return _read(os.path.join(config.PROMPTS_DIR, name))


def load_key_into_env(path=KEY_FILE):
    """Put GEMINI_API_KEY from `path` into os.environ (if not already set). Returns True if a key is available."""
    if os.environ.get("GEMINI_API_KEY"):
        return True
    if not os.path.exists(path):
        return False
    for line in _read(path).splitlines():
        line = line.strip()
        if line.startswith("GEMINI_API_KEY="):
            os.environ["GEMINI_API_KEY"] = line.split("=", 1)[1].strip().strip('"').strip("'")
            return True
    return False


def find_element(layout, el_id):
    for key in COLLECTIONS:
        for el in layout.get(key, []):
            if el.get("id") == el_id:
                return key, el
    return None, None


def status_map(layout):
    return {el["id"]: el.get("layout_status") for key in COLLECTIONS for el in layout.get(key, []) if "id" in el}


def assert_status_unchanged(before, after):
    """Y5 guard: raise if any layout_status differs between two status maps."""
    changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
    if changed:
        raise AssertionError(f"layout_status changed for {changed} (investigators may never change status)")
    return True


def _first_note(note):
    return (note or "").split(" | ")[0].strip()


# ---------------------------------------------------------------- flags
def collect_flags(model, run=None):
    """One flag per checker ambiguity finding, plus one per drafted element no finding covers.

    Only the finding's `message` is used as the flag text; `suggested_fix` (which may contain a
    proposed answer) is never read.
    """
    layout = model.get("layout", model)
    flags, covered = [], set()
    seen = set()
    for c in (run or {}).get("checker_catches", []):
        f = c.get("finding") or {}
        if f.get("severity") != "ambiguity":
            continue
        ids = [i for i in f.get("element_ids", []) if find_element(layout, i)[1] is not None]
        if not ids or tuple(sorted(ids)) in seen:
            continue
        seen.add(tuple(sorted(ids)))
        flags.append({"element_ids": ids, "flag_text": f.get("message") or "", "source": "checker",
                      "check": f.get("check")})
        covered.update(ids)
    for key in COLLECTIONS:
        for el in layout.get(key, []):
            if el.get("layout_status") == DRAFTED and el.get("id") not in covered:
                flags.append({"element_ids": [el["id"]], "flag_text": _first_note(el.get("review_note")) or
                              "This element is marked drafted_awaiting_review.", "source": "model", "check": None})
                covered.add(el["id"])
    for n, fl in enumerate(flags, 1):
        fl["flag_id"] = f"flag-{n:02d}-{fl['element_ids'][0]}"
        fl["layout_status_before"] = {i: find_element(layout, i)[1].get("layout_status") for i in fl["element_ids"]}
    return flags


def element_view(layout, el_id):
    key, el = find_element(layout, el_id)
    view = {"collection": key}
    view.update({k: copy.deepcopy(el[k]) for k in ELEMENT_FIELDS if k in el})
    return view


def build_prompt(flag, layout):
    elements = [element_view(layout, i) for i in flag["element_ids"]]
    text = (_prompt("investigator.md").replace("{FLAG_TEXT}", flag["flag_text"])
            .replace("{ELEMENTS}", json.dumps(elements, indent=1)).replace("{SHEETS}", ", ".join(config.SHEET_IDS)))
    return text, elements


def check_neutral(prompt, run, model):
    """Raise if the prompt carries a proposed answer: any checker suggested_fix, a quoted string from one,
    or any element's review conclusion beyond the flag text."""
    p = prompt.lower()
    for c in (run or {}).get("checker_catches", []):
        fix = ((c.get("finding") or {}).get("suggested_fix") or "").strip()
        if fix and fix.lower() in p:
            raise ValueError("prompt contains a checker suggested_fix")
        for q in re.findall(r"['\"‘“]([^'\"’”]{8,})['\"’”]", fix):
            if q.lower() in p and q.lower() not in _flag_texts(run, model):
                raise ValueError(f"prompt contains quoted text from a suggested_fix: {q!r}")
    return True


def _flag_texts(run, model):
    layout = model.get("layout", model)
    msgs = [((c.get("finding") or {}).get("message") or "") for c in (run or {}).get("checker_catches", [])]
    msgs += [el.get("review_note") or "" for k in COLLECTIONS for el in layout.get(k, [])]
    return " ".join(msgs).lower()


def make_task(flag, layout, sheets):
    prompt, elements = build_prompt(flag, layout)
    flag_file = {"flag_id": flag["flag_id"], "flag_text": flag["flag_text"], "elements": elements}
    return AgentTask(name=f"investigator:{flag['element_ids'][0]}", role=ROLE, prompt=prompt,
                     images=list(sheets.items()),
                     sources=[("/workspace/input/flag.json", json.dumps(flag_file, indent=1))]
                     + [(f"/workspace/input/sheets/{s}.png.b64", base64.b64encode(p).decode("ascii")) for s, p in sheets.items()],
                     meta={"flag": flag, "elements": elements})


# ---------------------------------------------------------------- validation
def validate_reply(obj, flag):
    errs = []
    if not isinstance(obj, dict):
        return ["reply is not a JSON object"]
    if obj.get("element_id") not in flag["element_ids"]:
        errs.append(f"element_id must be one of {flag['element_ids']}")
    for k in ("question", "probable_meaning"):
        if not isinstance(obj.get(k), str) or not obj[k].strip():
            errs.append(f"{k} must be a non-empty string")
    if obj.get("confidence") not in CONFIDENCE:
        errs.append(f"confidence must be one of {list(CONFIDENCE)}")
    if obj.get("keep_status") != DRAFTED:
        errs.append(f'keep_status must be "{DRAFTED}"')
    for k in ("layout_status", "new_status", "status"):
        if k in obj:
            errs.append(f"field {k!r} is not allowed (investigators never change status)")
    ev = obj.get("evidence")
    if not isinstance(ev, list) or not ev:
        errs.append("evidence must be a non-empty list")
        ev = []
    for n, e in enumerate(ev):
        if not isinstance(e, dict):
            errs.append(f"evidence[{n}] is not an object"); continue
        if e.get("sheet") not in config.SHEET_IDS:
            errs.append(f"evidence[{n}].sheet must be one of {config.SHEET_IDS}")
        rn = e.get("region_norm")
        if not (isinstance(rn, list) and len(rn) == 4 and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in rn)):
            errs.append(f"evidence[{n}].region_norm must be 4 numbers")
        elif not (all(0 <= x <= 1 for x in rn) and rn[0] < rn[2] and rn[1] < rn[3]):
            errs.append(f"evidence[{n}].region_norm must be [x0, y0, x1, y1] fractions with x0<x1, y0<y1")
        if not isinstance(e.get("quote"), str) or not e["quote"].strip():
            errs.append(f"evidence[{n}].quote must be a non-empty string")
    return errs


def clean_reply(obj):
    keep = ("element_id", "question", "probable_meaning", "evidence", "confidence", "keep_status")
    out = {k: copy.deepcopy(obj[k]) for k in keep if k in obj}
    out["evidence"] = [{k: e[k] for k in ("sheet", "region_norm", "quote")} for e in out.get("evidence", [])]
    out["keep_status"] = DRAFTED
    return out


def attach_evidence(model, results):
    """Return a copy of the model with each investigation attached under `investigation`.
    Statuses are compared before and after; any change raises."""
    out = copy.deepcopy(model)
    layout = out.get("layout", out)
    before = status_map(layout)
    for r in results:
        if not r.get("valid"):
            continue
        for el_id in r["element_ids"]:
            _, el = find_element(layout, el_id)
            if el is not None:
                el.setdefault("investigation", []).append(
                    {"flag_id": r["flag_id"], "probable_meaning": r["reply"]["probable_meaning"],
                     "confidence": r["reply"]["confidence"], "evidence": r["reply"]["evidence"]})
    assert_status_unchanged(before, status_map(layout))
    return out


# ---------------------------------------------------------------- mock agent
class MockInvestigatorClient:
    """Canned investigator replies built from the flag alone (no API calls). Every result is labeled mock."""
    mode = "mock"

    def __init__(self, bad_first=(), status_grab=()):
        self.redact = Redactor(None)
        self.bad_first = set(bad_first)      # element ids whose first reply is invalid (tests the retry)
        self.status_grab = set(status_grab)  # element ids whose replies try to change status
        self._lock = threading.Lock()
        self._n = 0
        self.tasks = []

    def run(self, task, log=print):
        with self._lock:
            self._n += 1; n = self._n
            self.tasks.append(task)
        res = AgentResult(name=task.name, status="completed", started=now_iso())
        t0 = time.time(); time.sleep(0.05)
        el_id = task.meta["flag"]["element_ids"][0]
        el = task.meta["elements"][0]
        ref = el.get("source_ref") or {"sheet": config.SHEET_IDS[0], "region_norm": [0.1, 0.1, 0.2, 0.2]}
        obj = {"element_id": el_id, "question": f"MOCK: what does {el_id} mean?",
               "probable_meaning": "MOCK: no investigation was run; canned reply.",
               "evidence": [{"sheet": ref["sheet"], "region_norm": ref["region_norm"], "quote": ref.get("callout") or "MOCK feature"}],
               "confidence": "low", "keep_status": DRAFTED}
        if el_id in self.status_grab:
            obj["keep_status"] = "verified_on_plan"; obj["layout_status"] = "verified_on_plan"
        if el_id in self.bad_first and not task.previous:
            res.text = "MOCK reply with no JSON"
        else:
            res.text = "MOCK investigator.\n```json\n" + json.dumps(obj) + "\n```"
        res.interaction_id = f"mock-investigation-{n:03d}"
        res.environment_id = task.previous[1] if task.previous else f"mock-env-{n:03d}"
        res.usage = {"total_input_tokens": 50_000, "total_cached_tokens": 20_000, "total_output_tokens": 2_000,
                     "total_thought_tokens": 1_000, "total_tool_use_tokens": 0, "total_tokens": 53_000}
        res.cost_usd = estimate_cost(res.usage)
        res.ended = now_iso(); res.seconds = round(time.time() - t0, 2)
        return res


# ---------------------------------------------------------------- runner
class Investigation:
    def __init__(self, client, log_dir):
        self.client, self.mode, self.redact = client, client.mode, client.redact
        self.log_dir = log_dir
        os.makedirs(log_dir, exist_ok=True)
        self.lock = threading.Lock()
        self.spent = 0.0
        self.turns = []
        self._logf = open(os.path.join(log_dir, "run.log"), "a", encoding="utf-8")

    def log(self, msg):
        line = f"{now_iso()} {self.redact(msg)}"
        print(line, flush=True)
        with self.lock:
            self._logf.write(line + "\n"); self._logf.flush()

    def close(self):
        self._logf.close()

    def _turn(self, task, step):
        with self.lock:
            if self.spent >= MAX_COST_USD:
                return AgentResult(name=task.name, status="skipped_budget",
                                   error=f"estimated spend ${self.spent:.2f} reached cap ${MAX_COST_USD}")
        res = self.client.run(task, log=self.log)
        with self.lock:
            self.spent += res.cost_usd
            n = len(self.turns) + 1
            self.turns.append({"agent": task.name, "step": step, "start": res.started, "end": res.ended,
                               "seconds": res.seconds, "status": res.status, "interaction_id": res.interaction_id,
                               "usage": res.usage, "cost_usd": res.cost_usd, "error": res.error})
        fname = f"{n:02d}-{task.name.replace(':', '_')}-{step}.txt"
        with open(os.path.join(self.log_dir, fname), "w", encoding="utf-8") as f:
            f.write(self.redact(res.text or ""))
        return res

    def investigate(self, flag, layout, sheets):
        task = make_task(flag, layout, sheets)
        t0 = time.time()
        turns = []
        obj, errs = None, []
        res = self._turn(task, "investigate"); turns.append(res)
        if res.status in ("completed", "idle"):
            obj, errs = _parse(res.text, flag)
            if errs:
                self.log(f"[{task.name}] invalid reply, retrying once: {errs[:3]}")
                retry = AgentTask(name=task.name, role=ROLE,
                                  prompt=_prompt("retry_bad_json.md").replace("{ERRORS}", "\n".join(f"- {e}" for e in errs[:40])),
                                  previous=(res.interaction_id, res.environment_id), meta=task.meta)
                res = self._turn(retry, "retry"); turns.append(res)
                obj, errs = _parse(res.text, flag) if res.status in ("completed", "idle") else (None, [f"retry status {res.status}: {res.error}"])
        else:
            errs = [f"agent status {res.status}: {res.error}"]
        usage = {}
        for r in turns:
            for k, v in (r.usage or {}).items():
                usage[k] = usage.get(k, 0) + (v or 0)
        return {"flag_id": flag["flag_id"], "element_ids": flag["element_ids"], "flag_text": flag["flag_text"],
                "flag_source": flag["source"], "check": flag.get("check"),
                "valid": not errs, "errors": errs[:20], "reply": clean_reply(obj) if not errs else None,
                "agent_seconds": round(time.time() - t0, 1), "turns": len(turns),
                "interaction_ids": [r.interaction_id for r in turns], "usage": usage,
                "cost_usd": round(sum(r.cost_usd for r in turns), 4),
                "layout_status_before": flag["layout_status_before"]}


def _parse(text, flag):
    try:
        obj = schema.extract_json(text)
    except ValueError as e:
        return None, [str(e)]
    return obj, validate_reply(obj, flag)


def run_investigations(client, model_path, run_path, out_path, log_dir):
    model = json.loads(_read(model_path))
    run = json.loads(_read(run_path)) if run_path and os.path.exists(run_path) else None
    layout = model.get("layout", model)
    before = status_map(layout)
    model_mtime = os.path.getmtime(model_path)
    flags = collect_flags(model, run)
    sheets = {s: _read(os.path.join(config.SHEETS_DIR, f"{s}.png"), "rb") for s in config.SHEET_IDS}
    for fl in flags:
        check_neutral(build_prompt(fl, layout)[0], run, model)
    inv = Investigation(client, log_dir)
    inv.log(f"Investigators ({inv.mode}): {len(flags)} flags, agent {config.AGENT_NAME}, all launched in parallel")
    started, t0 = now_iso(), time.time()
    with ThreadPoolExecutor(max_workers=max(1, len(flags))) as ex:
        results = list(ex.map(lambda fl: inv.investigate(fl, layout, sheets), flags))
    wall = round(time.time() - t0, 1)
    # Y5 guard: the model on disk and in memory must be unchanged, and every flagged element still drafted.
    assert_status_unchanged(before, status_map(layout))
    assert_status_unchanged(before, status_map(json.loads(_read(model_path)).get("layout", {})))
    assert os.path.getmtime(model_path) == model_mtime, "model.json was modified"
    for r in results:
        r["layout_status_after"] = {i: find_element(layout, i)[1].get("layout_status") for i in r["element_ids"]}
        assert r["layout_status_after"] == r["layout_status_before"]
    attach_evidence(model, results)   # dry run of attachment: raises if any status would change
    tot = {"total_tokens": 0, "total_input_tokens": 0, "total_output_tokens": 0, "total_cached_tokens": 0,
           "total_thought_tokens": 0}
    for r in results:
        for k in tot:
            tot[k] += r["usage"].get(k, 0) or 0
    tot["cost_usd"] = round(sum(r["cost_usd"] for r in results), 4)
    record = {"mock": inv.mode == "mock", "mode": inv.mode, "agent": config.AGENT_NAME, "started": started,
              "ended": now_iso(), "wall_seconds": wall, "flags": len(flags),
              "valid_replies": sum(r["valid"] for r in results), "rule": "Y5: evidence attaches; layout_status is never changed",
              "status_guard": {"elements_checked": len(before), "layout_status_changed": 0, "model_json_modified": False},
              "inputs": {"model": os.path.relpath(model_path, config.PIPELINE_ROOT),
                         "run": os.path.relpath(run_path, config.PIPELINE_ROOT) if run else None},
              "prompt_policy": "flag text + element location only; checker suggested_fix and review conclusions never sent",
              "results": results, "totals": tot, "turns": inv.turns,
              "pricing": {"basis": "estimate from token usage x Gemini 4 Hydrogen list price (USD per 1M tokens); sandbox compute free in preview",
                          "price_per_million": config.PRICE_PER_M},
              "log_dir": os.path.relpath(log_dir, config.PIPELINE_ROOT)}
    if inv.mode == "mock":
        record["mock_notice"] = "MOCK RUN: canned replies; timings, tokens and costs are simulated."
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(inv.redact(json.dumps(record, indent=1)))
    os.replace(tmp, out_path)
    inv.log(f"Done in {wall}s: {record['valid_replies']}/{len(flags)} valid, ~${tot['cost_usd']}; wrote {out_path}")
    inv.close()
    return record


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--mock", action="store_true", help="canned replies, no API calls")
    ap.add_argument("--model", default=os.path.join(config.EVAL_DIR, "model.json"))
    ap.add_argument("--run", default=os.path.join(config.EVAL_DIR, "run.json"))
    ap.add_argument("--out", default=None)
    a = ap.parse_args(argv)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    if a.mock:
        client = MockInvestigatorClient()
        out = a.out or os.path.join(config.MOCK_EVAL_DIR, "investigations.json")
    else:
        if not load_key_into_env():
            print("No GEMINI_API_KEY in the environment or in the shared key file.")
            return 2
        # In-process settings for this run only (config.py is not edited).
        config.TOKEN_CAP.setdefault(ROLE, TOKEN_CAP)
        config.TASK_TIMEOUT_SECONDS = TIMEOUT_SECONDS
        from .agent_client import LiveClient
        client = LiveClient()
        out = a.out or os.path.join(config.EVAL_DIR, "investigations.json")
    log_dir = os.path.join(config.LOG_DIR, f"{client.mode}-investigate-{stamp}")
    rec = run_investigations(client, a.model, a.run, out, log_dir)
    for r in rec["results"]:
        rp = r["reply"] or {}
        print(f"- {r['flag_id']}: {'OK' if r['valid'] else 'INVALID'} conf={rp.get('confidence')} "
              f"sheets={sorted({e['sheet'] for e in rp.get('evidence', [])})} {r['agent_seconds']}s ${r['cost_usd']}")
    print(f"wall {rec['wall_seconds']}s, tokens {rec['totals']['total_tokens']}, ~${rec['totals']['cost_usd']}")
    return 0 if rec["valid_replies"] == rec["flags"] else 1


if __name__ == "__main__":
    sys.exit(main())
