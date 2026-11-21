"""Fast dispatch-time pipeline and at-dispatch report mapper (Interactions API, plain model calls).

Fast mode (for unprepared/cold buildings):
  1. 4 parallel plain interactions.create(model=gemini-4-hydrogen, thinking_level=low,
     image resolution=ultra_high, JSON mode) readers (+1 retry on bad JSON).
  2. Plain-code deterministic stitcher (pipeline/stitch.py, ~4 ms) + local invariants (~1 ms)
     -> model ready on screen (time_to_model_s).
  3. Off-critical-path visual checker: 1 plain call (thinking_level=medium, resolution=ultra_high)
     attaching ambiguity flags without blocking time-to-model (time_to_checker_s).
  4. Dispatch-call benchmark: 1 structured-output plain call (thinking_level=low) mapping a
     dispatch report onto the building's spaces (~5 s).

Writes eval/fast_run.json and eval/fast_model.json atomically; NEVER overwrites eval/run.json.
"""
import copy
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor

from . import config, invariants, orchestrator, schema, scorer, stitch
from .agent_client import AgentTask, now_iso

DEFAULT_DISPATCH_TEXT = (
    "Engine 7 respond 144 Marlowe St, smoke showing from apartment 4C, "
    "caller reports heavy smoke in the fourth floor east lobby."
)

DISPATCH_RESPONSE_FORMAT = {
    "type": "text",
    "mime_type": "application/json",
    "schema": {
        "type": "object",
        "properties": {
            "target_space_id": {"type": "string"},
            "reports": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "space_id": {"type": "string"},
                        "kind": {"type": "string"},
                        "text": {"type": "string"},
                    },
                    "required": ["space_id", "kind", "text"],
                },
            },
        },
        "required": ["target_space_id", "reports"],
    },
}


def _fast_reader_prompt(sheet):
    notes = json.loads(orchestrator._prompt("sheet_notes.json"))[sheet]
    return (
        orchestrator._prompt("fast_reader.md")
        .replace("{SHEET}", sheet)
        .replace("{SHEET_NOTES}", notes["notes"])
        .replace("{EXTRA_FIELDS}", notes["extra_fields"])
        .replace("{W}", "2000")
        .replace("{H}", "1300")
        .replace("{FORMAT}", orchestrator._prompt("format.md"))
    )


def _fast_checker_prompt(layout, inv_findings):
    drafted = sorted(
        e["id"]
        for k in ("spaces", "openings", "verticals", "entrances")
        for e in layout.get(k, [])
        if e.get("layout_status") == "drafted_awaiting_review"
    )
    slim = copy.deepcopy(layout)
    for k in ("spaces", "openings", "verticals", "entrances"):
        for e in slim.get(k, []):
            sr = e.get("source_ref") or {}
            e["source_ref"] = {"sheet": sr.get("sheet"), "callout": sr.get("callout", "")}
    return (
        orchestrator._prompt("fast_checker.md")
        .replace("{INV}", json.dumps(inv_findings) if inv_findings else "none")
        .replace("{DRAFTED}", json.dumps(drafted))
        .replace("{MODEL}", json.dumps(slim, separators=(",", ":")))
    )


def dispatch_call(client, layout, text=DEFAULT_DISPATCH_TEXT, run=None):
    """Map dispatch text onto the building's spaces using one small structured-output call."""
    spaces = [
        {"id": s["id"], "label": s.get("label", ""), "floor": s.get("floor")}
        for s in layout.get("spaces", [])
    ]
    prompt = (
        "Map this dispatch text onto the building's spaces. Reply JSON only: "
        '{"target_space_id": "...", "reports": [{"space_id": "...", "kind": "smoke|fire|blocked|other", "text": "..."}]}\n'
        f"Spaces: {json.dumps(spaces, separators=(',', ':'))}\n"
        f"Dispatch: {text}"
    )
    task = AgentTask(
        name="dispatch",
        role="dispatch",
        prompt=prompt,
        mode="model",
        model=config.FAST_MODEL,
        thinking_level="low",
        response_format=DISPATCH_RESPONSE_FORMAT,
        meta={"dispatch_text": text, "spaces": spaces},
    )
    if run is not None:
        res = run._turn(task, "dispatch")
    else:
        res = client.run(task)
    parsed = None
    err = res.error
    if res.status in ("completed", "idle"):
        try:
            parsed = schema.extract_json(res.text)
        except ValueError as e:
            err = str(e)
    return {
        "text": text,
        "seconds": res.seconds,
        "status": res.status,
        "cost_usd": res.cost_usd,
        "usage": res.usage,
        "result": parsed,
        "error": err,
    }


def fast_pipeline(client, out_dir, dispatch_text=DEFAULT_DISPATCH_TEXT):
    """Run the fast path (plain Hydrogen calls + local stitch + off-critical-path checker + dispatch call).

    Writes fast_run.json and fast_model.json into out_dir; NEVER overwrites eval/run.json.
    """
    run = orchestrator.Run(client, out_dir, "fast")
    result = {
        "mock": run.mode == "mock",
        "mode": f"fast-{run.mode}",
        "model": config.FAST_MODEL,
        "reader_thinking": config.FAST_READER_THINKING,
        "checker_thinking": config.FAST_CHECKER_THINKING,
        "image_resolution": config.FAST_IMAGE_RESOLUTION,
        "started": now_iso(),
        "status": "running",
        "pricing": orchestrator._pricing_note(),
    }
    if run.mode == "mock":
        result["mock_notice"] = "MOCK FAST RUN: canned replies; timings, tokens and costs are simulated."

    t_start = time.time()
    try:
        # 1. 4 parallel plain-call readers
        run.log(
            f"Fast Stage 1: 4 parallel readers ({config.FAST_MODEL}, "
            f"thinking={config.FAST_READER_THINKING}, res={config.FAST_IMAGE_RESOLUTION})"
        )

        def read_one(sheet):
            png = orchestrator._sheet_png(sheet)
            task = AgentTask(
                name=f"reader:{sheet}",
                role="reader",
                prompt=_fast_reader_prompt(sheet),
                images=[(sheet, png)],
                mode="model",
                model=config.FAST_MODEL,
                thinking_level=config.FAST_READER_THINKING,
                image_resolution=config.FAST_IMAGE_RESOLUTION,
                response_format={"type": "text", "mime_type": "application/json"},
                meta={"sheet": sheet, "round": 0},
            )
            obj, res, errs = run.run_validated(task, lambda o: schema.validate_reader_reply(o, sheet), "fast-read")
            return sheet, obj, res, errs

        slices = {}
        with ThreadPoolExecutor(max_workers=4) as ex:
            for sheet, obj, res, errs in ex.map(read_one, config.SHEET_IDS):
                if obj is None:
                    result["status"] = "blocked"
                    result["blocker"] = f"reader:{sheet} failed: {errs[:5]}"
                    break
                slices[sheet] = obj

        if result["status"] == "running":
            # 2. Local deterministic stitcher + local invariants -> MODEL READY ON SCREEN
            t_st = time.perf_counter()
            layout, stitch_notes = stitch.stitch(slices)
            inv = invariants.check_model(layout)
            stitch_ms = round((time.perf_counter() - t_st) * 1000.0, 2)
            time_to_model_s = round(time.time() - t_start, 1)
            run.log(f"Fast Stage 2: local stitch + invariants in {stitch_ms} ms -> model ready at {time_to_model_s}s")

            before_layout = copy.deepcopy(layout)
            orchestrator._write_json_atomic(
                os.path.join(out_dir, "fast_model_before_checker.json"),
                orchestrator.wrap_model(before_layout),
            )

            # 3. Off-critical-path visual checker (one plain call, medium thinking)
            run.log(f"Fast Stage 3 (off critical path): visual checker ({config.FAST_MODEL}, thinking={config.FAST_CHECKER_THINKING})")
            sheets = {s: orchestrator._sheet_png(s) for s in config.SHEET_IDS}
            ck_task = AgentTask(
                name="checker",
                role="checker",
                prompt=_fast_checker_prompt(layout, inv),
                images=list(sheets.items()),
                mode="model",
                model=config.FAST_MODEL,
                thinking_level=config.FAST_CHECKER_THINKING,
                image_resolution=config.FAST_IMAGE_RESOLUTION,
                response_format={"type": "text", "mime_type": "application/json"},
                meta={"model": orchestrator.wrap_model(layout)},
            )
            ck, _, ck_errs = run.run_validated(ck_task, schema.validate_checker_reply, "fast-check")
            catches = []
            if ck is not None:
                findings = ck.get("findings", [])
                ambs = [f for f in findings if f.get("severity") == "ambiguity"]
                errs = [f for f in findings if f.get("severity") == "error"]
                for f in ambs:
                    pre = copy.deepcopy(layout)
                    orchestrator.apply_ambiguities(layout, [f])
                    catches.append(
                        {
                            "round": 1,
                            "severity": "ambiguity",
                            "finding": f,
                            "action": "kept as drafted_awaiting_review",
                            "diff": orchestrator.diff_elements(pre, layout, f.get("element_ids", [])),
                        }
                    )
                for f in errs:
                    catches.append(
                        {
                            "round": 1,
                            "severity": "error",
                            "finding": f,
                            "action": "reported off critical path (no send-back in fast mode)",
                            "diff": [],
                        }
                    )
            else:
                run.log(f"Fast checker invalid reply: {ck_errs[:3]}")
            time_to_checker_s = round(time.time() - t_start, 1)

            # Save final fast model
            final_model = orchestrator.wrap_model(layout)
            orchestrator._write_json_atomic(os.path.join(out_dir, "fast_model.json"), final_model)

            # 4. At-dispatch report mapping benchmark (~5 s)
            run.log("Fast Stage 4: at-dispatch report mapping call")
            disp = dispatch_call(client, layout, text=dispatch_text, run=run)

            # 5. Local scorer (before and after checker)
            truth = scorer.load_truth()
            acc_before = scorer.score(before_layout, truth)
            acc_after = scorer.score(layout, truth)

            result.update(
                {
                    "status": "completed",
                    "time_to_model_s": time_to_model_s,
                    "stitch_and_invariants_ms": stitch_ms,
                    "time_to_checker_s": time_to_checker_s,
                    "stitch_notes": stitch_notes,
                    "local_invariant_findings": inv,
                    "checker_catches": catches,
                    "dispatch_call": disp,
                    "accuracy": {
                        "before_checker": acc_before,
                        "after_checker": acc_after,
                        "summary": {
                            k: [acc_before[k], acc_after[k]]
                            for k in (
                                "spaces_recall",
                                "spaces_precision",
                                "spaces_f1",
                                "openings_found_rate",
                                "openings_correct_rate",
                                "connections_recall",
                                "connections_precision",
                                "connections_f1",
                                "stops_rate",
                                "overall",
                            )
                        },
                        "trap_holds": [acc_before["trap"]["holds"], acc_after["trap"]["holds"]],
                    },
                    "final_model_path": os.path.relpath(os.path.join(out_dir, "fast_model.json"), config.PIPELINE_ROOT),
                }
            )
    except orchestrator.BudgetStop as e:
        result["status"] = "stopped_budget"
        result["blocker"] = str(e)
    except Exception as e:  # noqa: BLE001
        result["status"] = "error"
        result["blocker"] = run.redact(f"{type(e).__name__}: {e}")
        run.log(f"FAST PIPELINE ERROR {result['blocker']}")

    result["ended"] = now_iso()
    result["wall_seconds"] = round(time.time() - t_start, 1)
    result["timeline"] = run.timeline
    result["per_agent"], result["totals"] = orchestrator._totals(run.timeline)
    path = os.path.join(out_dir, "fast_run.json")
    orchestrator._write_json_atomic(path, result)
    run.log(f"Fast pipeline {result['status']}; wrote {path}")
    return result
