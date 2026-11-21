"""JSON extraction from agent text and validation against the D5 layout format.

Managed Agents has no structured output, so every agent reply is parsed from text
and checked here. Problems are returned as plain strings so they can be sent back
to the agent verbatim on the single retry.
"""
import json
import re

LAYOUT_STATUS = {"verified_on_plan", "drafted_awaiting_review", "not_in_plan"}
SPACE_TYPES = {"apartment", "hall", "lobby", "utility", "stair", "elevator", "other", "room"}
OPENING_KINDS = {"door", "fire_door", "open_passage", "elevator_door", "window", "other"}
FOOTPRINT = (24.0, 14.0)
TOL = 0.75


def extract_json(text):
    """Return the last top-level JSON object found in text (fenced block preferred)."""
    if not text:
        raise ValueError("empty reply")
    fenced = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.S)
    for block in reversed(fenced):
        try:
            return json.loads(block)
        except json.JSONDecodeError:
            continue
    # fall back to scanning for balanced braces from each '{'
    dec = json.JSONDecoder()
    best = None
    for m in re.finditer(r"\{", text):
        try:
            obj, end = dec.raw_decode(text[m.start():])
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and (best is None or len(json.dumps(obj)) > len(json.dumps(best))):
            best = obj
    if best is None:
        raise ValueError("no parseable JSON object in reply")
    return best


def _num_list(v, n):
    return isinstance(v, list) and len(v) == n and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in v)


def _check_bbox(errs, where, b):
    if not _num_list(b, 4):
        errs.append(f"{where}: bbox_m must be [x0,y0,x1,y1] numbers")
        return
    x0, y0, x1, y1 = b
    if not (x0 < x1 and y0 < y1):
        errs.append(f"{where}: bbox_m needs x0<x1 and y0<y1, got {b}")
    if x0 < -TOL or y0 < -TOL or x1 > FOOTPRINT[0] + TOL or y1 > FOOTPRINT[1] + TOL:
        errs.append(f"{where}: bbox_m {b} is outside the 24 x 14 m footprint")


def _check_common(errs, where, el, need_source=True):
    if not isinstance(el.get("id"), str) or not el["id"]:
        errs.append(f"{where}: missing string id")
    st = el.get("layout_status")
    if st not in LAYOUT_STATUS:
        errs.append(f"{where}: layout_status must be one of {sorted(LAYOUT_STATUS)}, got {st!r}")
    if st == "drafted_awaiting_review" and not el.get("review_note"):
        errs.append(f"{where}: drafted_awaiting_review needs a review_note")
    sr = el.get("source_ref")
    if st != "not_in_plan" and need_source:
        if not isinstance(sr, dict):
            errs.append(f"{where}: missing source_ref object")
        else:
            if not isinstance(sr.get("sheet"), str):
                errs.append(f"{where}: source_ref.sheet must be a sheet id string")
            rn = sr.get("region_norm")
            if not _num_list(rn, 4) or not all(-0.01 <= x <= 1.01 for x in rn):
                errs.append(f"{where}: source_ref.region_norm must be 4 numbers in 0..1")


def validate_layout(layout, partial=False):
    """Validate a D5 `layout` object. partial=True skips cross-references (single-sheet slices)."""
    errs = []
    if not isinstance(layout, dict):
        return ["layout must be an object"]
    for key in ("floors", "spaces", "openings", "verticals", "entrances"):
        if not isinstance(layout.get(key, []), list):
            errs.append(f"layout.{key} must be a list")
    if errs:
        return errs
    floors = {f.get("floor") for f in layout.get("floors", []) if isinstance(f, dict)}
    for i, f in enumerate(layout.get("floors", [])):
        if not isinstance(f, dict) or not isinstance(f.get("floor"), int):
            errs.append(f"floors[{i}]: needs integer floor")
    ids = {}
    def reg(el_id, where):
        if isinstance(el_id, str):
            if el_id in ids:
                errs.append(f"{where}: duplicate id {el_id!r} (also {ids[el_id]})")
            ids[el_id] = where

    for i, s in enumerate(layout.get("spaces", [])):
        w = f"spaces[{i}]({s.get('id') if isinstance(s, dict) else '?'})"
        if not isinstance(s, dict):
            errs.append(f"{w}: not an object"); continue
        _check_common(errs, w, s); reg(s.get("id"), w)
        if not isinstance(s.get("floor"), int):
            errs.append(f"{w}: floor must be an integer")
        _check_bbox(errs, w, s.get("bbox_m"))
        if not isinstance(s.get("label"), str):
            errs.append(f"{w}: label must be a string")
        if s.get("type") not in SPACE_TYPES:
            errs.append(f"{w}: type must be one of {sorted(SPACE_TYPES)}")

    for i, v in enumerate(layout.get("verticals", [])):
        w = f"verticals[{i}]({v.get('id') if isinstance(v, dict) else '?'})"
        if not isinstance(v, dict):
            errs.append(f"{w}: not an object"); continue
        _check_common(errs, w, v); reg(v.get("id"), w)
        if v.get("kind") not in ("stair", "elevator"):
            errs.append(f"{w}: kind must be 'stair' or 'elevator'")
        fc = v.get("floors_connected")
        if not (isinstance(fc, list) and all(isinstance(x, int) for x in fc)):
            errs.append(f"{w}: floors_connected must be a list of integers")
        stops = v.get("stops")
        if not isinstance(stops, list):
            errs.append(f"{w}: stops must be a list"); continue
        for j, st in enumerate(stops):
            ww = f"{w}.stops[{j}]"
            if not isinstance(st, dict) or not isinstance(st.get("floor"), int):
                errs.append(f"{ww}: needs integer floor"); continue
            _check_bbox(errs, ww, st.get("bbox_m"))
            for k in ("opening_id", "space_id"):
                if not isinstance(st.get(k), str):
                    errs.append(f"{ww}: {k} must be a string")

    for i, o in enumerate(layout.get("openings", [])):
        w = f"openings[{i}]({o.get('id') if isinstance(o, dict) else '?'})"
        if not isinstance(o, dict):
            errs.append(f"{w}: not an object"); continue
        _check_common(errs, w, o); reg(o.get("id"), w)
        if o.get("kind") not in OPENING_KINDS:
            errs.append(f"{w}: kind must be one of {sorted(OPENING_KINDS)}")
        if not isinstance(o.get("floor"), int):
            errs.append(f"{w}: floor must be an integer")
        c = o.get("connects")
        if not (isinstance(c, list) and len(c) == 2 and all(isinstance(x, str) for x in c)):
            errs.append(f"{w}: connects must be [idA, idB]")
        if not _num_list(o.get("pos_m"), 2):
            errs.append(f"{w}: pos_m must be [x, y]")

    for i, e in enumerate(layout.get("entrances", [])):
        w = f"entrances[{i}]({e.get('id') if isinstance(e, dict) else '?'})"
        if not isinstance(e, dict):
            errs.append(f"{w}: not an object"); continue
        _check_common(errs, w, e); reg(e.get("id"), w)
        if not isinstance(e.get("access_confirmed"), bool):
            errs.append(f"{w}: access_confirmed must be true/false")
        if not isinstance(e.get("connects_to_space_id"), str):
            errs.append(f"{w}: connects_to_space_id must be a string")
        if not _num_list(e.get("pos_m"), 2):
            errs.append(f"{w}: pos_m must be [x, y]")

    if not partial:
        space_ids = {s.get("id") for s in layout["spaces"] if isinstance(s, dict)}
        vert_ids = {v.get("id") for v in layout["verticals"] if isinstance(v, dict)}
        open_ids = {o.get("id") for o in layout["openings"] if isinstance(o, dict)}
        for o in layout["openings"]:
            if isinstance(o, dict) and isinstance(o.get("connects"), list):
                for x in o["connects"]:
                    if x not in space_ids and x not in vert_ids:
                        errs.append(f"opening {o.get('id')}: connects unknown id {x!r}")
        for v in layout["verticals"]:
            for st in v.get("stops", []) if isinstance(v, dict) else []:
                if isinstance(st, dict):
                    if st.get("opening_id") not in open_ids:
                        errs.append(f"vertical {v.get('id')} floor {st.get('floor')}: opening_id {st.get('opening_id')!r} not found")
                    if st.get("space_id") not in space_ids:
                        errs.append(f"vertical {v.get('id')} floor {st.get('floor')}: space_id {st.get('space_id')!r} not found")
        for e in layout["entrances"]:
            if isinstance(e, dict) and e.get("connects_to_space_id") not in space_ids:
                errs.append(f"entrance {e.get('id')}: connects_to_space_id {e.get('connects_to_space_id')!r} not found")
        if floors:
            for s in layout["spaces"]:
                if isinstance(s, dict) and s.get("floor") not in floors:
                    errs.append(f"space {s.get('id')}: floor {s.get('floor')} not in layout.floors")
    return errs


def validate_reader_reply(obj, sheet):
    errs = []
    if not isinstance(obj, dict):
        return ["reply must be a JSON object"]
    if obj.get("sheet") != sheet:
        errs.append(f"reply.sheet must be {sheet!r}")
    if "layout" not in obj:
        return errs + ["reply.layout missing"]
    errs += validate_layout(obj["layout"], partial=True)
    rm = obj.get("render_match")
    if not isinstance(rm, dict) or not isinstance(rm.get("pass_scores"), list):
        errs.append("reply.render_match.pass_scores must be a list of numbers (one per render-and-compare pass)")
    if not isinstance(obj.get("unclear", []), list):
        errs.append("reply.unclear must be a list")
    return errs


def validate_stitcher_reply(obj):
    if not isinstance(obj, dict) or "layout" not in obj:
        return ["reply must be an object with a 'layout' key"]
    errs = validate_layout(obj["layout"], partial=False)
    fl = sorted(f.get("floor") for f in obj["layout"].get("floors", []) if isinstance(f, dict))
    if fl != [1, 2, 3, 4, 5]:
        errs.append(f"layout.floors must cover floors 1-5 exactly, got {fl}")
    return errs


def normalize_layout(layout):
    """Ensure every element's source_ref includes a string callout (D5 strict compatibility)."""
    if not isinstance(layout, dict):
        return layout
    for key in ("spaces", "openings", "verticals", "entrances"):
        for el in layout.get(key, []):
            if isinstance(el, dict) and isinstance(el.get("source_ref"), dict):
                if el["source_ref"].get("callout") is None:
                    el["source_ref"]["callout"] = ""
    return layout


def validate_checker_reply(obj):
    errs = []
    if not isinstance(obj, dict) or not isinstance(obj.get("findings"), list):
        return ["reply must be an object with a 'findings' list"]
    for i, f in enumerate(obj["findings"]):
        w = f"findings[{i}]"
        if not isinstance(f, dict):
            errs.append(f"{w}: not an object"); continue
        if f.get("severity") not in ("error", "ambiguity"):
            errs.append(f"{w}: severity must be 'error' or 'ambiguity'")
        if not isinstance(f.get("owner"), str):
            errs.append(f"{w}: owner must be a string like 'reader:A-4' or 'stitcher'")
        if not isinstance(f.get("element_ids"), list):
            errs.append(f"{w}: element_ids must be a list")
        for k in ("check", "message"):
            if not isinstance(f.get(k), str):
                errs.append(f"{w}: {k} must be a string")
    return errs
