"""Deterministic invariants for a stitched building model (D7 checker, code half).

Runs both locally (orchestrator) and inside the checker agent's sandbox:
    python invariants.py model.json        -> prints {"findings": [...]} as JSON

Checks: valid format, stair/elevator stops on real floors, every opening joins spaces
that actually touch, every apartment reachable from an entrance by stairs, unique ids.
Each finding names an owner: "reader:<sheet>" for single-sheet content, "stitcher"
for cross-floor content.
"""
import json
import sys
from collections import deque

try:
    from .schema import validate_layout
except ImportError:  # running as a plain script in the sandbox
    from schema import validate_layout

TOUCH_TOL = 0.3


def _owner_for(el):
    sheet = (el.get("source_ref") or {}).get("sheet")
    if sheet in ("A-1", "A-2", "A-4"):
        return f"reader:{sheet}"
    return "stitcher"


def _touch(a, b, tol=TOUCH_TOL):
    """True when two boxes overlap or share a boundary segment longer than tol."""
    ax0, ay0, ax1, ay1 = a; bx0, by0, bx1, by1 = b
    ox = min(ax1, bx1) - max(ax0, bx0)
    oy = min(ay1, by1) - max(ay0, by0)
    return (ox > tol and oy > -tol) or (oy > tol and ox > -tol)


def _near(pos, box, tol=0.6):
    x, y = pos
    return box[0] - tol <= x <= box[2] + tol and box[1] - tol <= y <= box[3] + tol


def check_model(layout):
    findings = []
    def add(check, sev, owner, ids, msg, fix=""):
        findings.append({"check": check, "severity": sev, "owner": owner, "element_ids": ids,
                         "message": msg, "suggested_fix": fix, "source": "deterministic"})

    for e in validate_layout(layout, partial=False):
        owner = "stitcher"
        add("valid_format", "error", owner, [], e)

    spaces = {s["id"]: s for s in layout.get("spaces", []) if isinstance(s, dict) and "id" in s}
    verts = {v["id"]: v for v in layout.get("verticals", []) if isinstance(v, dict) and "id" in v}
    floors = {f["floor"] for f in layout.get("floors", []) if isinstance(f, dict) and "floor" in f}

    # unique ids across all element lists (validate_layout also reports; keep a crisp one)
    seen = {}
    for key in ("spaces", "openings", "verticals", "entrances"):
        for el in layout.get(key, []):
            if isinstance(el, dict) and el.get("id") in seen:
                add("unique_ids", "error", _owner_for(el), [el["id"]], f"id {el['id']!r} used twice ({seen[el['id']]} and {key})")
            elif isinstance(el, dict):
                seen[el.get("id")] = key

    # stops on real floors
    for v in verts.values():
        stop_floors = []
        for st in v.get("stops", []):
            f = st.get("floor"); stop_floors.append(f)
            if f not in floors:
                add("stops_on_real_floors", "error", "stitcher", [v["id"]], f"{v['id']} has a stop on floor {f}, which is not in the model")
            sp = spaces.get(st.get("space_id"))
            if sp and sp.get("floor") != f:
                add("stops_on_real_floors", "error", "stitcher", [v["id"], sp["id"]],
                    f"{v['id']} stop on floor {f} opens into {sp['id']} on floor {sp.get('floor')}")
        if sorted(set(stop_floors)) != sorted(set(v.get("floors_connected", []))):
            add("stops_on_real_floors", "error", "stitcher", [v["id"]],
                f"{v['id']} floors_connected {v.get('floors_connected')} != floors with stops {sorted(set(stop_floors))}")

    # openings connect touching spaces
    def box_of(el_id, floor):
        if el_id in spaces:
            return spaces[el_id]["bbox_m"] if spaces[el_id].get("floor") == floor else None
        if el_id in verts:
            for st in verts[el_id].get("stops", []):
                if st.get("floor") == floor:
                    return st.get("bbox_m")
        return None

    for o in layout.get("openings", []):
        if not isinstance(o, dict) or not isinstance(o.get("connects"), list) or len(o["connects"]) != 2:
            continue
        a, b = o["connects"]; f = o.get("floor")
        ba, bb = box_of(a, f), box_of(b, f)
        if ba is None or bb is None:
            missing = a if ba is None else b
            add("doors_connect_touching_spaces", "error", _owner_for(o), [o["id"], missing],
                f"opening {o['id']} on floor {f} connects {missing!r}, which has no footprint on floor {f}")
            continue
        if not _touch(ba, bb):
            add("doors_connect_touching_spaces", "error", _owner_for(o), [o["id"], a, b],
                f"opening {o['id']} connects {a} {ba} and {b} {bb}, which do not touch on floor {f}",
                "Re-read the door on the sheet: which two spaces does its swing actually join?")
        elif o.get("pos_m") and not (_near(o["pos_m"], ba) and _near(o["pos_m"], bb)):
            add("doors_connect_touching_spaces", "error", _owner_for(o), [o["id"]],
                f"opening {o['id']} at {o['pos_m']} is not on the shared wall of {a} and {b}")

    # every apartment reachable from an entrance (stairs and openings; elevators excluded)
    g = {}
    def link(x, y):
        g.setdefault(x, set()).add(y); g.setdefault(y, set()).add(x)
    for o in layout.get("openings", []):
        if not isinstance(o, dict) or len(o.get("connects", [])) != 2:
            continue
        a, b = o["connects"]
        if a in verts and verts[a].get("kind") == "elevator" or b in verts and verts[b].get("kind") == "elevator":
            continue
        na = f"{a}@{o.get('floor')}" if a in verts else a
        nb = f"{b}@{o.get('floor')}" if b in verts else b
        link(na, nb)
    for v in verts.values():
        if v.get("kind") != "stair":
            continue
        fl = sorted({st.get("floor") for st in v.get("stops", [])})
        for x, y in zip(fl, fl[1:]):
            link(f"{v['id']}@{x}", f"{v['id']}@{y}")
    starts = [e.get("connects_to_space_id") for e in layout.get("entrances", []) if isinstance(e, dict)]
    if not starts:
        add("units_reachable", "error", "reader:A-1", [], "no entrances in the model")
    reach, q = set(starts), deque(starts)
    while q:
        n = q.popleft()
        for x in g.get(n, ()):
            if x not in reach:
                reach.add(x); q.append(x)
    for s in spaces.values():
        if s.get("type") == "apartment" and s["id"] not in reach:
            add("units_reachable", "error", _owner_for(s), [s["id"]],
                f"apartment {s['id']} (floor {s.get('floor')}) is not reachable from any entrance by stairs")
    return findings


if __name__ == "__main__":
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    layout = data.get("layout", data)
    print(json.dumps({"findings": check_model(layout)}, indent=1))
