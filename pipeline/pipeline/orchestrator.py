"""Track B orchestrator: 4 parallel sheet readers -> stair stitcher -> checker loop -> scorer.

Agents never see true_model.json; only scorer.py opens it, after the agents are done.
"""
import base64
import copy
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from . import config, schema, scorer, stitch
from .agent_client import AgentTask, now_iso
from .invariants import check_model


class BudgetStop(Exception):
    pass


def _read(path, mode="r"):
    with open(path, mode, **({} if "b" in mode else {"encoding": "utf-8"})) as f:
        return f.read()


def _prompt(name):
    return _read(os.path.join(config.PROMPTS_DIR, name))


def _sheet_png(sheet):
    return _read(os.path.join(config.SHEETS_DIR, f"{sheet}.png"), "rb")


def _b64(png):
    return base64.b64encode(png).decode("ascii")


class Run:
    def __init__(self, client, out_dir, label):
        self.client = client
        self.mode = client.mode
        self.out_dir = out_dir
        os.makedirs(out_dir, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        self.log_dir = os.path.join(config.LOG_DIR, f"{self.mode}-{label}-{stamp}")
        os.makedirs(self.log_dir, exist_ok=True)
        self.timeline = []
        self.spent = 0.0
        self.lock = threading.Lock()
        self.redact = client.redact
        self._logf = open(os.path.join(self.log_dir, "run.log"), "a", encoding="utf-8")

    def log(self, msg):
        line = f"{now_iso()} {self.redact(msg)}"
        print(line, flush=True)
        with self.lock:
            self._logf.write(line + "\n"); self._logf.flush()

    # ---- one agent turn, recorded ----
    def _turn(self, task, step):
        with self.lock:
            if self.spent >= config.MAX_RUN_COST_USD:
                raise BudgetStop(f"estimated spend ${self.spent:.2f} reached the cap ${config.MAX_RUN_COST_USD}")
        res = self.client.run(task, log=self.log)
        with self.lock:
            self.spent += res.cost_usd
            n = len(self.timeline) + 1
            self.timeline.append({"agent": task.name, "role": task.role, "step": step, "start": res.started, "end": res.ended,
                                  "seconds": res.seconds, "status": res.status, "interaction_id": res.interaction_id,
                                  "environment_id": res.environment_id, "usage": res.usage, "cost_usd": res.cost_usd,
                                  "error": res.error, "mock": self.mode == "mock"})
        with open(os.path.join(self.log_dir, f"{n:02d}-{task.name.replace(':', '_')}-{step}.txt"), "w", encoding="utf-8") as f:
            f.write(self.redact(res.text or ""))
        return res

    def run_validated(self, task, validate, step):
        """Run a task, parse + validate its JSON, retry once in the same conversation on bad output."""
        res = self._turn(task, step)
        if res.status not in ("completed", "idle"):
            return None, res, [f"agent status {res.status}: {res.error}"]
        errs = []
        try:
            obj = schema.extract_json(res.text)
            errs = validate(obj)
        except ValueError as e:
            obj, errs = None, [str(e)]
        if not errs:
            return obj, res, []
        self.log(f"[{task.name}] invalid reply ({len(errs)} problems), retrying once: {errs[:3]}")
        retry = AgentTask(
            name=task.name,
            role=task.role,
            prompt=_prompt("retry_bad_json.md").replace("{ERRORS}", "\n".join(f"- {e}" for e in errs[:40])),
            previous=(res.interaction_id, res.environment_id),
            meta=task.meta,
            mode=task.mode,
            model=task.model,
            thinking_level=task.thinking_level,
            image_resolution=task.image_resolution,
            response_format=task.response_format,
        )
        res2 = self._turn(retry, step + "-retry")
        if res2.status not in ("completed", "idle"):
            return None, res2, [f"retry status {res2.status}: {res2.error}"]
        try:
            obj = schema.extract_json(res2.text)
            errs = validate(obj)
        except ValueError as e:
            obj, errs = None, [str(e)]
        return (obj if not errs else None), res2, errs

    # ---- tasks ----
    def reader_task(self, sheet):
        notes = json.loads(_prompt("sheet_notes.json"))[sheet]
        prompt = (_prompt("reader.md").replace("{SHEET}", sheet).replace("{SHEET_NOTES}", notes["notes"])
                  .replace("{EXTRA_FIELDS}", notes["extra_fields"]))
        png = _sheet_png(sheet)
        return AgentTask(name=f"reader:{sheet}", role="reader", prompt=prompt, images=[(sheet, png)],
                         sources=[(f"/workspace/input/{sheet}.png.b64", _b64(png)),
                                  ("/workspace/input/format.md", _prompt("format.md"))],
                         meta={"sheet": sheet, "round": 0})

    def run_reader(self, sheet):
        obj, res, errs = self.run_validated(self.reader_task(sheet), lambda o: schema.validate_reader_reply(o, sheet), "read")
        return sheet, obj, res, errs


def _find(layout, el_id):
    for key in ("spaces", "openings", "verticals", "entrances"):
        for el in layout.get(key, []):
            if el.get("id") == el_id:
                return key, el
    return None, None


def _near_opening(layout, ref):
    if not ref or "pos_m" not in ref:
        return None
    for o in layout.get("openings", []):
        if o.get("floor") == ref.get("floor") and o.get("pos_m") and \
                abs(o["pos_m"][0] - ref["pos_m"][0]) + abs(o["pos_m"][1] - ref["pos_m"][1]) < 0.8:
            return o
    return None


def diff_elements(before_layout, after_layout, ids):
    out = []
    for el_id in ids:
        kb, b = _find(before_layout, el_id)
        ka, a = _find(after_layout, el_id)
        if a is None and kb == "openings":
            a = _near_opening(after_layout, b)
        changed = sorted(k for k in set((b or {}).keys()) | set((a or {}).keys()) if (b or {}).get(k) != (a or {}).get(k))
        out.append({"element_id": el_id, "before": b, "after": a, "changed_fields": changed})
    return out


def _write_json_atomic(path, payload):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=1)
    os.replace(tmp, path)


def _has_valid_evidence(finding):
    if finding.get("source") in ("deterministic", "deterministic-local"):
        return True
    ev = finding.get("evidence")
    if not isinstance(ev, dict):
        return False
    rn = ev.get("region_norm")
    return (
        isinstance(ev.get("sheet"), str)
        and bool(ev["sheet"].strip())
        and isinstance(rn, list)
        and len(rn) == 4
        and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in rn)
    )


def apply_ambiguities(layout, ambiguities):
    """Mark primary ambiguity targets drafted_awaiting_review (D7: kept, not treated as errors).

    Never mutates context-only related_ids.
    """
    for f in ambiguities:
        targets = [f["target_id"]] if isinstance(f.get("target_id"), str) and f["target_id"] else f.get("element_ids", [])
        for el_id in targets:
            _, el = _find(layout, el_id)
            if el is not None:
                el["layout_status"] = "drafted_awaiting_review"
                note = f.get("message", "")
                if note and note not in (el.get("review_note") or ""):
                    el["review_note"] = ((el.get("review_note") + " | ") if el.get("review_note") else "") + note
    return layout


def _key(f):
    return (f.get("check"), tuple(sorted(f.get("element_ids", []))))


def wrap_model(layout):
    """D5 envelope. Building/sheet metadata come from the brief, not from the answer key."""
    schema.normalize_layout(layout)
    return {"schema_version": "1.0",
            "building": {"id": "marlowe-house", "name": "Marlowe House", "address": "142-144 Marlowe St",
                         "is_fictional": True, "footprint_m": {"w": 24.0, "d": 14.0}},
            "sheets": [{"id": s, "file": f"sheets/{s}.png"} for s in config.SHEET_IDS],
            "layout": layout, "conditions": []}


def _totals(timeline):
    tot = {"total_tokens": 0, "total_input_tokens": 0, "total_output_tokens": 0, "total_cached_tokens": 0,
           "total_thought_tokens": 0, "cost_usd": 0.0}
    per = {}
    for t in timeline:
        u = t.get("usage") or {}
        p = per.setdefault(t["agent"], {"turns": 0, "total_tokens": 0, "cost_usd": 0.0, "seconds": 0.0})
        p["turns"] += 1; p["total_tokens"] += u.get("total_tokens") or 0
        p["cost_usd"] = round(p["cost_usd"] + t["cost_usd"], 4); p["seconds"] = round(p["seconds"] + t["seconds"], 1)
        for k in tot:
            if k != "cost_usd":
                tot[k] += u.get(k) or 0
        tot["cost_usd"] = round(tot["cost_usd"] + t["cost_usd"], 4)
    return per, tot


def _pricing_note():
    return {"basis": "estimate from token usage x Gemini 4 Hydrogen list price (USD per 1M tokens); sandbox compute free in preview",
            "price_per_million": config.PRICE_PER_M}


# ---------------------------------------------------------------- one-agent test
def one_agent_test(client, out_dir):
    run = Run(client, out_dir, "one-agent")
    run.log(f"One-agent test ({run.mode}): reader A-4, agent {config.AGENT_NAME}")
    t0 = time.time()
    sheet, obj, res, errs = run.run_reader("A-4")
    record = {"mock": run.mode == "mock", "mode": run.mode, "agent": config.AGENT_NAME, "sheet": "A-4",
              "ok": obj is not None, "errors": errs[:40], "wall_seconds": round(time.time() - t0, 1),
              "turns": run.timeline, "pricing": _pricing_note()}
    record["per_agent"], record["totals"] = _totals(run.timeline)
    if obj is not None:
        m = scorer.score(obj["layout"], truth=_truth_floors([4]))
        record["accuracy_floor4"] = {k: m[k] for k in ("spaces_recall", "openings_found_rate", "openings_correct_rate",
                                                      "connections_recall", "stops_rate", "openings_wrong", "stop_errors")}
        record["render_match"] = obj.get("render_match")
        record["unclear"] = obj.get("unclear")
        record["slice"] = obj
    path = os.path.join(out_dir, "one_agent_test.json")
    json.dump(record, open(path, "w", encoding="utf-8"), indent=1)
    run.log(f"One-agent test {'PASSED' if record['ok'] else 'FAILED'}; wrote {path}")
    return record


def _truth_floors(floors):
    t = scorer.load_truth()
    keep = lambda el: el.get("floor") in floors
    out = {"floors": [f for f in t["floors"] if f["floor"] in floors], "spaces": [s for s in t["spaces"] if keep(s)],
           "openings": [o for o in t["openings"] if keep(o)], "entrances": [e for e in t["entrances"] if keep(e)],
           "verticals": []}
    for v in t["verticals"]:
        v2 = copy.deepcopy(v); v2["stops"] = [s for s in v["stops"] if s["floor"] in floors]
        if v2["stops"]:
            out["verticals"].append(v2)
    return out


# ---------------------------------------------------------------- full pipeline
def full_pipeline(client, out_dir):
    run = Run(client, out_dir, "full")
    result = {"mock": run.mode == "mock", "mode": run.mode, "agent": config.AGENT_NAME, "started": now_iso(),
              "status": "running", "pricing": _pricing_note()}
    if run.mode == "mock":
        result["mock_notice"] = "MOCK RUN: agent replies are canned fakes from pipeline/mock_agents.py; timings, tokens and costs are simulated."
    t_start = time.time()
    try:
        _full(run, result)
        result["status"] = result.get("status") if result.get("status") != "running" else "completed"
    except BudgetStop as e:
        result["status"] = "stopped_budget"; result["blocker"] = str(e)
    except Exception as e:  # noqa: BLE001
        result["status"] = "error"; result["blocker"] = run.redact(f"{type(e).__name__}: {e}")
        run.log(f"PIPELINE ERROR {result['blocker']}")
    result["ended"] = now_iso(); result["wall_seconds"] = round(time.time() - t_start, 1)
    result["timeline"] = run.timeline
    result["per_agent"], result["totals"] = _totals(run.timeline)
    oat_path = os.path.join(out_dir, "one_agent_test.json")
    if os.path.exists(oat_path):
        try:
            oat = json.load(open(oat_path, encoding="utf-8"))
            result["one_agent_test"] = {
                k: oat.get(k) for k in ("mode", "agent", "sheet", "ok", "wall_seconds", "totals", "accuracy_floor4", "render_match")
            }
        except Exception:
            pass
    path = os.path.join(out_dir, "run.json")
    _write_json_atomic(path, result)
    run.log(f"Pipeline {result['status']}; wrote {path}")
    return result


def _full(run, result):
    # 1. four readers in parallel
    run.log("Stage 1: 4 sheet readers in parallel")
    slices, reader_state = {}, {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        for sheet, obj, res, errs in ex.map(run.run_reader, config.SHEET_IDS):
            reader_state[sheet] = (res.interaction_id, res.environment_id)
            if obj is None:
                result["status"] = "blocked"; result["blocker"] = f"reader:{sheet} failed: {errs[:5]}"
                return
            slices[sheet] = obj
    result["readers"] = {s: {"render_match": o.get("render_match"), "unclear": o.get("unclear"),
                             "counts": {k: len(o["layout"].get(k, [])) for k in ("spaces", "openings", "verticals", "entrances")}}
                         for s, o in slices.items()}

    # 2. deterministic plain-code stitcher (~4 ms; replaces the 113.5 s agent stitcher)
    t_st = time.perf_counter()
    layout, stitch_notes = stitch.stitch(slices)
    stitch_ms = round((time.perf_counter() - t_st) * 1000.0, 2)
    run.log(f"Stage 2: deterministic stair stitcher completed in {stitch_ms} ms")
    result["stitch_notes"] = stitch_notes
    result["stitch_ms"] = stitch_ms
    before_layout = copy.deepcopy(layout)
    _write_json_atomic(os.path.join(run.out_dir, "model_before_checker.json"), wrap_model(before_layout))

    # 3. checker loop
    catches, ambiguities, rounds = [], [], []
    check_state = None
    for rnd in range(1, config.MAX_CHECK_ROUNDS + 2):   # last pass only re-checks
        run.log(f"Stage 3: checker round {rnd}")
        model = wrap_model(layout)
        if check_state is None:
            sheets = {s: _sheet_png(s) for s in config.SHEET_IDS}
            ck_task = AgentTask(name="checker", role="checker", prompt=_prompt("checker.md"),
                                images=list(sheets.items()),
                                sources=[("/workspace/input/model.json", json.dumps(model, indent=1)),
                                         ("/workspace/input/format.md", _prompt("format.md")),
                                         ("/workspace/tools/invariants.py", _read(os.path.join(config.HERE, "invariants.py"))),
                                         ("/workspace/tools/schema.py", _read(os.path.join(config.HERE, "schema.py")))]
                                + [(f"/workspace/input/sheets/{s}.png.b64", _b64(p)) for s, p in sheets.items()],
                                meta={"model": model})
        else:
            ck_task = AgentTask(name="checker", role="checker",
                                prompt=_prompt("recheck.md").replace("{MODEL}", json.dumps(model))
                                .replace("{KNOWN_AMBIGUITIES}", json.dumps(ambiguities, indent=1)),
                                previous=check_state, meta={"model": model})
        ck, res, errs = run.run_validated(ck_task, schema.validate_checker_reply, f"check-r{rnd}")
        if ck is None:
            result["status"] = "blocked"; result["blocker"] = f"checker failed in round {rnd}: {errs[:5]}"
            return
        check_state = (res.interaction_id, res.environment_id)
        agent_findings = ck["findings"]
        # local deterministic run: anything the agent didn't report is added (flagged as local)
        local = check_model(layout)
        seen = {_key(f) for f in agent_findings}
        extra = []
        for f in local:
            if _key(f) in seen:
                continue
            twin = next((a for a in agent_findings if a.get("severity") == f["severity"]
                         and set(a.get("element_ids", [])) & set(f["element_ids"])), None)
            if twin is not None:   # same element already reported by the agent: corroborate, don't double count
                twin.setdefault("corroborated_by", []).append(f["check"])
            else:
                extra.append(dict(f, source="deterministic-local"))
        findings = agent_findings + extra
        known = {_key(a) for a in ambiguities}
        # Require sheet + region_norm evidence on visual errors; downgrade ungrounded visual errors to ambiguity
        for f in findings:
            if f.get("severity") == "error" and not _has_valid_evidence(f):
                f["severity"] = "ambiguity"
                f["downgraded_reason"] = "missing sheet/region_norm evidence"
        new_amb = [f for f in findings if f.get("severity") == "ambiguity" and _key(f) not in known]
        errors = [f for f in findings if f.get("severity") == "error" and _key(f) not in known]
        rounds.append({"round": rnd, "agent_findings": len(agent_findings), "local_only_findings": len(extra),
                       "errors": len(errors), "new_ambiguities": len(new_amb), "summary": ck.get("summary")})
        for f in new_amb:
            pre = copy.deepcopy(layout)
            apply_ambiguities(layout, [f])
            ambiguities.append(f)
            catches.append({"round": rnd, "severity": "ambiguity", "finding": f, "action": "kept as drafted_awaiting_review",
                            "diff": diff_elements(pre, layout, f.get("element_ids", []))})
        if not errors:
            run.log(f"Checker round {rnd}: no errors")
            break
        if rnd > config.MAX_CHECK_ROUNDS:
            run.log(f"Checker round {rnd}: {len(errors)} errors left after {config.MAX_CHECK_ROUNDS} send-back rounds")
            for f in errors:
                catches.append({"round": rnd, "severity": "error", "finding": f, "action": "unresolved after max rounds", "diff": []})
            break
        # 4. send errors back to their owners (readers and/or stitcher)
        by_owner = {}
        for f in errors:
            owner = f.get("owner", "stitcher")
            if owner.startswith("reader:") and owner[7:] in slices:
                by_owner.setdefault(owner, []).append(f)
            else:
                by_owner.setdefault("stitcher", []).append(f)
        run.log(f"Checker round {rnd}: {len(errors)} errors -> {sorted(by_owner)}")

        def fix(owner):
            sheet = owner[7:]
            fs = by_owner[owner]
            task = AgentTask(name=owner, role="reader",
                             prompt=_prompt("fix_reader.md").replace("{SHEET}", sheet).replace("{FINDINGS}", json.dumps(fs, indent=1)),
                             images=[(sheet, _sheet_png(sheet))], previous=reader_state[sheet],
                             meta={"sheet": sheet, "round": rnd, "findings": fs})
            o, r, e = run.run_validated(task, lambda x: schema.validate_reader_reply(x, sheet), f"fix-r{rnd}")
            return sheet, o, r, e

        updated = {}
        reader_owners = [o for o in by_owner if o != "stitcher"]
        if reader_owners:
            with ThreadPoolExecutor(max_workers=4) as ex:
                for sheet, o, r, e in ex.map(fix, reader_owners):
                    if o is None:
                        run.log(f"reader:{sheet} fix failed: {e[:3]}; keeping its previous slice")
                        continue
                    reader_state[sheet] = (r.interaction_id, r.environment_id)
                    slices[sheet] = o; updated[sheet] = o
        pre = copy.deepcopy(layout)
        new_layout, new_notes = stitch.stitch(slices)
        result["stitch_notes"] = new_notes
        layout = apply_ambiguities(new_layout, ambiguities)
        any_changed = False
        for f in errors:
            d = diff_elements(pre, layout, f.get("element_ids", []))
            changed = any(item.get("changed_fields") for item in d)
            if changed:
                any_changed = True
                catches.append({"round": rnd, "severity": "error", "finding": f,
                                "action": f"sent to {f.get('owner')}; re-stitched", "diff": d})
            else:
                # Zero-diff short-circuit: owner re-checked and kept its reading unchanged.
                # Escalate to ambiguity so the checker does not burn extra rounds looping on it.
                esc = dict(f, severity="ambiguity", escalated_from="error")
                ambiguities.append(esc)
                catches.append({"round": rnd, "severity": "ambiguity", "finding": esc,
                                "action": f"escalated to ambiguity ({f.get('owner')} kept reading unchanged)", "diff": d})
                run.log(f"Checker round {rnd}: {f.get('check')} produced no change after send-back; escalated to ambiguity")
        if not any_changed:
            run.log(f"Checker round {rnd}: no error findings produced changes; stopping checker loop")
            break

    # 5. score before and after
    final = wrap_model(layout)
    _write_json_atomic(os.path.join(run.out_dir, "model.json"), final)
    result["checker_rounds"] = rounds
    result["checker_catches"] = catches
    result["final_invariant_findings"] = check_model(layout)
    truth = scorer.load_truth()
    acc_before, acc_after = scorer.score(before_layout, truth), scorer.score(layout, truth)
    result["accuracy"] = {"before_checker": acc_before, "after_checker": acc_after,
                          "summary": {k: [acc_before[k], acc_after[k]] for k in
                                      ("spaces_recall", "spaces_precision", "spaces_f1",
                                       "openings_found_rate", "openings_correct_rate",
                                       "connections_recall", "connections_precision", "connections_f1",
                                       "stops_rate", "overall")},
                          "trap_holds": [acc_before["trap"]["holds"], acc_after["trap"]["holds"]]}
    result["final_model_path"] = os.path.relpath(os.path.join(run.out_dir, "model.json"), config.PIPELINE_ROOT)
