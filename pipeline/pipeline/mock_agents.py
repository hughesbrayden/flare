"""MOCK agent replies, for exercising the orchestrator, validator, checker loop and scorer
without an API key. Hand-written from a visual reading of the sheets; they are NOT derived
from the answer key and contain deliberate mistakes:
  - reader:A-4 first pass wires the Stair A floor-4 door to the West Corridor (the
    "STAIR A (W) ->" callout trap); it fixes this when the checker sends it back
  - reader:A-1 misses the trash room and its door
  - reader:A-2 misses the refuse room
  - the first stitcher reply is wrapped in prose to exercise JSON extraction
Every reply produced here is labeled mock by the orchestrator in run.json.
"""
import copy
import json

SHEET_W, SHEET_H, OX, OY, PX, D_M = 2000, 1300, 120, 140, 60, 14.0


def rn(b):
    x0, y0 = OX + b[0] * PX, OY + (D_M - b[3]) * PX
    x1, y1 = OX + b[2] * PX, OY + (D_M - b[1]) * PX
    return [round(x0 / SHEET_W, 3), round(y0 / SHEET_H, 3), round(x1 / SHEET_W, 3), round(y1 / SHEET_H, 3)]


def _sp(L, sheet, id_, type_, label, f, b, status="verified_on_plan", note=None):
    s = {"id": id_, "type": type_, "label": label, "floor": f, "bbox_m": b,
         "source_ref": {"sheet": sheet, "region_norm": rn(b), "callout": label}, "layout_status": status}
    if note: s["review_note"] = note
    L["spaces"].append(s)


def _op(L, sheet, id_, kind, f, a, b, pos, callout="", status="verified_on_plan", note=None):
    o = {"id": id_, "kind": kind, "floor": f, "connects": [a, b], "pos_m": pos, "fire_rated": kind != "open_passage",
         "source_ref": {"sheet": sheet, "region_norm": rn([pos[0] - .6, pos[1] - .6, pos[0] + .6, pos[1] + .6]), "callout": callout},
         "layout_status": status}
    if note: o["review_note"] = note
    L["openings"].append(o)


def _vert(L, sheet, id_, kind, label, f, bbox, door_pos, space_id, door_callout, status="verified_on_plan", note=None):
    oid = f"door-f{f}-{id_}"
    _op(L, sheet, oid, "fire_door" if kind == "stair" else "elevator_door", f, id_, space_id, door_pos, door_callout, status, note)
    L["verticals"].append({"id": id_, "kind": kind, "label": label, "floors_connected": [f],
                           "stops": [{"floor": f, "bbox_m": bbox, "opening_id": oid, "space_id": space_id}],
                           "source_ref": {"sheet": sheet, "region_norm": rn(bbox), "callout": label},
                           "layout_status": "verified_on_plan"})


def _empty(f, sheet):
    return {"floors": [{"floor": f, "label": f"Floor {f}", "elevation_m": (f - 1) * 3.0, "height_m": 3.0, "sheet_id": sheet}],
            "spaces": [], "openings": [], "verticals": [], "entrances": []}


def slice_a1():
    S, L = "A-1", _empty(1, "A-1")
    _sp(L, S, "f1-west-vestibule", "lobby", "WEST VESTIBULE (142)", 1, [0, 0, 10, 5])
    _sp(L, S, "f1-exit-passageway", "hall", "EXIT PASSAGEWAY", 1, [6, 5, 10, 12])
    _sp(L, S, "f1-apt-1a", "apartment", "1A (SUPER)", 1, [0, 5, 6, 14])
    _sp(L, S, "f1-mech", "utility", "MECH.", 1, [10, 5, 14, 9])
    _sp(L, S, "f1-east-vestibule", "lobby", "EAST VESTIBULE (144)", 1, [14, 0, 24, 5])
    _sp(L, S, "f1-stair-hall", "hall", "STAIR HALL", 1, [14, 5, 18, 12])
    _sp(L, S, "f1-boiler-rm", "utility", "BOILER RM.", 1, [18, 5, 21.5, 14])
    _sp(L, S, "f1-rear-service-vestibule", "lobby", "REAR SERVICE VESTIBULE", 1, [21.5, 12, 24, 14])
    _op(L, S, "o1-wvest-passage", "open_passage", 1, "f1-west-vestibule", "f1-exit-passageway", [8, 5])
    _op(L, S, "o1-passage-1a", "door", 1, "f1-exit-passageway", "f1-apt-1a", [6, 9])
    _op(L, S, "o1-evest-stairhall", "open_passage", 1, "f1-east-vestibule", "f1-stair-hall", [16, 5])
    _op(L, S, "o1-stairhall-boiler", "door", 1, "f1-stair-hall", "f1-boiler-rm", [18, 7])
    _vert(L, S, "stair-a", "stair", "STAIR A", 1, [10, 9, 12, 12], [10, 10.5], "f1-exit-passageway", "A")
    _vert(L, S, "stair-b", "stair", "STAIR B", 1, [12, 9, 14, 12], [14, 10.5], "f1-stair-hall", "B")
    _vert(L, S, "stair-c", "stair", "STAIR C", 1, [21.5, 9, 24, 12], [22.75, 12], "f1-rear-service-vestibule", "C")
    _vert(L, S, "elevator-e1", "elevator", "ELEVATOR E1", 1, [10, 2.5, 12, 5], [10, 3.75], "f1-west-vestibule", "E1")
    for id_, lab, st, sp, pos, ok, call in [("ent-142", "142 Marlowe St", "Marlowe St", "f1-west-vestibule", [4, 0], True, "142 MARLOWE ST"),
                                            ("ent-144", "144 Marlowe St", "Marlowe St", "f1-east-vestibule", [19, 0], True, "144 MARLOWE ST"),
                                            ("ent-rear-alley", "Rear alley gate", "North Service Alley", "f1-rear-service-vestibule", [22.75, 14], False, "ALLEY GATE - KEYED")]:
        L["entrances"].append({"id": id_, "label": lab, "floor": 1, "street_label": st, "connects_to_space_id": sp, "pos_m": pos,
                               "access_confirmed": ok, "source_ref": {"sheet": S, "region_norm": rn([pos[0] - 1, pos[1] - .6, pos[0] + 1, pos[1] + .6]), "callout": call},
                               "layout_status": "verified_on_plan" if ok else "drafted_awaiting_review",
                               **({} if ok else {"review_note": "Gate keyed by management (note 8); access not confirmed."})})
    return {"sheet": "A-1", "layout": L, "render_match": {"pass_scores": [0.81, 0.9], "passes": 2, "method": "MOCK wall-pixel F1"},
            "unclear": [{"element_id": "ent-rear-alley", "note": "Alley gate keyed; access unconfirmed."}]}


def slice_upper(f, sheet, stair_a_mistake=False):
    n = str(f); S = sheet; L = _empty(f, sheet)
    _sp(L, S, f"f{n}-west-corridor", "hall", "WEST CORRIDOR", f, [0, 6, 10, 8])
    _sp(L, S, f"f{n}-east-lobby", "lobby", "EAST LOBBY", f, [10, 5, 14, 9])
    _sp(L, S, f"f{n}-east-corridor", "hall", "EAST CORRIDOR", f, [14, 6, 21.5, 8])
    _sp(L, S, f"f{n}-ne-hall", "hall", "N.E. HALL", f, [21.5, 6, 24, 9])
    for u, b in [("a", [0, 8, 10, 14]), ("b", [0, 0, 10, 6]), ("c", [14, 8, 21.5, 14]), ("d", [14, 0, 24, 6])]:
        _sp(L, S, f"f{n}-apt-{n}{u}", "apartment", f"{n}{u.upper()}", f, b)
    if sheet == "A-4":
        _sp(L, S, f"f{n}-refuse", "utility", "REFUSE", f, [12, 2.5, 14, 5])
    _op(L, S, f"o{n}-wcorr-lobby", "open_passage", f, f"f{n}-west-corridor", f"f{n}-east-lobby", [10, 7])
    _op(L, S, f"o{n}-lobby-ecorr", "open_passage", f, f"f{n}-east-lobby", f"f{n}-east-corridor", [14, 7])
    _op(L, S, f"o{n}-ecorr-nehall", "door", f, f"f{n}-east-corridor", f"f{n}-ne-hall", [21.5, 7])
    _op(L, S, f"o{n}-{n}a", "door", f, f"f{n}-west-corridor", f"f{n}-apt-{n}a", [5, 8], f"{n}A ENTRY")
    _op(L, S, f"o{n}-{n}b", "door", f, f"f{n}-west-corridor", f"f{n}-apt-{n}b", [5, 6], f"{n}B ENTRY")
    _op(L, S, f"o{n}-{n}c", "door", f, f"f{n}-east-corridor", f"f{n}-apt-{n}c", [17.75, 8], f"{n}C ENTRY")
    _op(L, S, f"o{n}-{n}d", "door", f, f"f{n}-east-corridor", f"f{n}-apt-{n}d", [19, 6], f"{n}D ENTRY")
    if stair_a_mistake:
        _vert(L, S, "stair-a", "stair", "STAIR A", f, [10, 9, 12, 12], [11, 9], f"f{n}-west-corridor", "STAIR A (W) ->")
    else:
        _vert(L, S, "stair-a", "stair", "STAIR A", f, [10, 9, 12, 12], [11, 9], f"f{n}-east-lobby", "STAIR A (W) ->" if f == 4 else "A")
    _vert(L, S, "stair-b", "stair", "STAIR B", f, [12, 9, 14, 12], [13, 9], f"f{n}-east-lobby", "B")
    note7 = f == 4
    _vert(L, S, "stair-c", "stair", "STAIR C", f, [21.5, 9, 24, 12], [22.75, 9], f"f{n}-ne-hall",
          "F.D. - SEE NOTE 7" if note7 else "C", "verified_on_plan")
    _vert(L, S, "elevator-e1", "elevator", "ELEVATOR E1", f, [10, 2.5, 12, 5], [11, 5], f"f{n}-east-lobby", "E1")
    unclear = []
    if f == 4:
        unclear.append({"element_id": "door-f4-stair-a", "note": "Callout 'STAIR A (W) ->' sits by the west corridor."})
    return {"sheet": sheet, "layout": L, "render_match": {"pass_scores": [0.78, 0.88], "passes": 2, "method": "MOCK wall-pixel F1"},
            "unclear": unclear}


def section_a301():
    return {"sheet": "A-301", "layout": {"floors": [], "spaces": [], "openings": [], "verticals": [], "entrances": []},
            "section": [
                {"vertical": "stair-a", "floors": [1, 2, 3, 4, 5], "opens_to": {"1": "EXIT PASSAGE -> 142", "2-5": "EAST LOBBY"}},
                {"vertical": "stair-b", "floors": [1, 2, 3, 4, 5], "opens_to": {"1": "STAIR HALL -> 144", "2-5": "EAST LOBBY"}},
                {"vertical": "stair-c", "floors": [1, 2, 3, 4, 5], "opens_to": {"1": "REAR VESTIBULE -> ALLEY GATE", "2-5": "N.E. SERVICE HALL"}}],
            "render_match": {"pass_scores": [0.9], "passes": 1, "method": "MOCK section redraw"},
            "unclear": [{"element_id": "stair-a", "note": "A and B are scissor stairs in one shaft (note 2)."}]}


def _retarget(layout, f_from, f_to):
    s = json.dumps(layout)
    s = s.replace(f'"f{f_from}-', f'"f{f_to}-').replace(f'"o{f_from}-', f'"o{f_to}-').replace(f'door-f{f_from}-', f'door-f{f_to}-')
    s = s.replace(f'apt-{f_from}', f'apt-{f_to}').replace(f'"{f_from}A', f'"{f_to}A').replace(f'"{f_from}B', f'"{f_to}B')
    s = s.replace(f'"{f_from}C', f'"{f_to}C').replace(f'"{f_from}D', f'"{f_to}D').replace(f'o{f_to}-{f_from}', f'o{f_to}-{f_to}')
    L = json.loads(s)
    for k in ("spaces", "openings", "entrances"):
        for el in L[k]:
            el["floor"] = f_to
    for fl in L["floors"]:
        fl["floor"] = f_to; fl["label"] = f"Floor {f_to}"; fl["elevation_m"] = (f_to - 1) * 3.0
    for v in L["verticals"]:
        for st in v["stops"]:
            st["floor"] = f_to
    return L


def stitch(slices):
    """Deterministic merge used by the mock stitcher."""
    parts = [slices["A-1"]["layout"], slices["A-4"]["layout"]]
    a2 = slices["A-2"]["layout"]
    parts += [a2, _retarget(a2, 2, 3), _retarget(a2, 2, 5)]
    out = {"floors": [], "spaces": [], "openings": [], "verticals": [], "entrances": []}
    verts = {}
    for p in parts:
        for k in ("floors", "spaces", "openings", "entrances"):
            out[k] += copy.deepcopy(p[k])
        for v in p["verticals"]:
            if v["id"] not in verts:
                verts[v["id"]] = copy.deepcopy(v); verts[v["id"]]["stops"] = []
                verts[v["id"]]["source_ref"] = {"sheet": "A-301", "region_norm": [0.06, 0.1, 0.5, 0.9], "callout": v["label"]}
            verts[v["id"]]["stops"] += copy.deepcopy(v["stops"])
    for v in verts.values():
        v["stops"].sort(key=lambda s: s["floor"])
        v["floors_connected"] = [s["floor"] for s in v["stops"]]
    out["verticals"] = list(verts.values())
    out["floors"].sort(key=lambda f: f["floor"])
    return out


_state = {}


def respond(task):
    m = task.meta
    if task.role == "reader":
        sheet = m["sheet"]
        if sheet == "A-1": obj = slice_a1()
        elif sheet == "A-2": obj = slice_upper(2, "A-2")
        elif sheet == "A-4": obj = slice_upper(4, "A-4", stair_a_mistake=m.get("round", 0) == 0)
        else: obj = section_a301()
        _state[sheet] = obj
        return "MOCK reader reply. Render-and-compare done.\n```json\n" + json.dumps(obj) + "\n```"
    if task.role == "stitcher":
        slices = m["slices"]
        layout = stitch(slices)
        obj = {"layout": layout, "stitch_notes": ["MOCK: expanded A-2 to floors 2, 3, 5; merged stops from A-301."]}
        return "MOCK stitcher. Here is the model:\n```json\n" + json.dumps(obj) + "\n```\nDone."
    if task.role == "checker":
        layout = m["model"]["layout"]
        findings = []
        for o in layout["openings"]:
            if o["floor"] == 4 and "stair-a" in o["connects"] and any("west" in c for c in o["connects"]):
                findings.append({"check": "callout_vs_geometry", "severity": "error", "owner": "reader:A-4",
                                 "element_ids": [o["id"]],
                                 "message": "Stair A floor-4 door is wired to the West Corridor because of the 'STAIR A (W) ->' callout, but the door swing on A-4 opens into the East Lobby.",
                                 "suggested_fix": "Connect stair-a on floor 4 to the East Lobby and mark the callout for review.",
                                 "evidence": {"sheet": "A-4", "region_norm": [0.36, 0.33, 0.42, 0.38]}})
            if o["floor"] == 4 and "stair-c" in o["connects"]:
                findings.append({"check": "missing_referenced_note", "severity": "ambiguity", "owner": "reader:A-4",
                                 "element_ids": [o["id"]],
                                 "message": "Stair C floor-4 door is annotated 'F.D. - SEE NOTE 7'; note 7 is missing from A-4's general notes.",
                                 "suggested_fix": "Keep the door, mark drafted_awaiting_review, verify on arrival.",
                                 "evidence": {"sheet": "A-4", "region_norm": [0.70, 0.12, 0.78, 0.15]}})
        return "MOCK checker.\n```json\n" + json.dumps({"findings": findings, "summary": "MOCK audit"}) + "\n```"
    raise ValueError(task.role)
