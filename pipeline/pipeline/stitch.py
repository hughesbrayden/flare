"""Deterministic stair stitcher (local code, ~4 ms) used in BOTH agent and fast modes.

Combines:
  1. Expanding typical floor slice A-2 (modeled as floor 2) into floors 2, 3 and 5.
  2. Merging all floors into one D5 layout (floors 1-5) and normalizing source_ref.callout.
  3. Merging each stair/elevator into one vertical with one stop per floor,
     preserving and unioning any floor's `drafted_awaiting_review` status and `review_note`
     (so Floor 4 flags are never overwritten by Floor 1's `verified_on_plan`).
  4. Cross-checking vertical stops against the A-301 section slice and flagging
     floor-set disagreements as `drafted_awaiting_review` (plan geometry kept).
"""
import copy
import re

from . import schema

TYPICAL_FLOORS = {"A-2": [2, 3, 5]}
SHEET_FOR_FLOOR = {1: "A-1", 2: "A-2", 3: "A-2", 4: "A-4", 5: "A-2"}


def _rename_id(el_id, src, dst, vertical_ids):
    if not isinstance(el_id, str) or el_id in vertical_ids:
        return el_id
    s = re.sub(rf"^f{src}-", f"f{dst}-", el_id)
    s = re.sub(rf"^o{src}-", f"o{dst}-", s)
    s = re.sub(rf"^door-f{src}-", f"door-f{dst}-", s)
    s = re.sub(rf"(apt-){src}([a-z])", rf"\g<1>{dst}\2", s)
    s = re.sub(rf"(^|-){src}([a-z])(?=-|$)", rf"\g<1>{dst}\2", s)
    return s


def _rename_label(label, src, dst):
    if not isinstance(label, str):
        return label
    return re.sub(rf"\b{src}([A-Z])\b", rf"{dst}\1", label)


def _copy_floor(layout, src, dst, vertical_ids):
    ren = lambda x: _rename_id(x, src, dst, vertical_ids)
    out = {"spaces": [], "openings": [], "verticals": [], "entrances": []}
    for s in layout.get("spaces", []):
        if s.get("floor") != src:
            continue
        s2 = copy.deepcopy(s)
        s2["id"] = ren(s["id"])
        s2["floor"] = dst
        s2["label"] = _rename_label(s.get("label"), src, dst)
        if isinstance(s2.get("source_ref"), dict):
            s2["source_ref"]["callout"] = _rename_label(s2["source_ref"].get("callout", ""), src, dst)
        out["spaces"].append(s2)
    for o in layout.get("openings", []):
        if o.get("floor") != src:
            continue
        o2 = copy.deepcopy(o)
        o2["id"] = ren(o["id"])
        o2["floor"] = dst
        o2["connects"] = [ren(x) for x in o.get("connects", [])]
        if isinstance(o2.get("source_ref"), dict):
            o2["source_ref"]["callout"] = _rename_label(o2["source_ref"].get("callout", ""), src, dst)
        out["openings"].append(o2)
    for v in layout.get("verticals", []):
        v2 = copy.deepcopy(v)
        v2["stops"] = []
        for st in v.get("stops", []):
            if st.get("floor") == src:
                st2 = dict(st, floor=dst, opening_id=ren(st.get("opening_id")), space_id=ren(st.get("space_id")))
                v2["stops"].append(st2)
        v2["floors_connected"] = [dst] if v2["stops"] else []
        if v2["stops"]:
            out["verticals"].append(v2)
    for e in layout.get("entrances", []):
        if e.get("floor") == src:
            e2 = copy.deepcopy(e)
            e2["floor"] = dst
            e2["connects_to_space_id"] = ren(e.get("connects_to_space_id"))
            out["entrances"].append(e2)
    return out


def _floors_from_key(k):
    m = re.match(r"^\s*(\d+)\s*(?:-|to|–)\s*(\d+)\s*$", str(k))
    if m:
        return list(range(int(m.group(1)), int(m.group(2)) + 1))
    return [int(x) for x in re.findall(r"\d+", str(k))]


def _flag(el, note):
    el["layout_status"] = "drafted_awaiting_review"
    if note and note not in (el.get("review_note") or ""):
        el["review_note"] = ((el["review_note"] + " | ") if el.get("review_note") else "") + note


def _words(s):
    return {w for w in re.findall(r"[a-z]+", (s or "").lower()) if len(w) > 2 and w not in ("the", "and", "doors", "door")}


def stitch(slices):
    """Deterministically merge {sheet_id: reader reply object} into (layout, stitch_notes)."""
    notes = []
    parts = []
    vertical_ids = set()
    for obj in slices.values():
        for v in (obj.get("layout") or {}).get("verticals", []):
            if isinstance(v, dict) and v.get("id"):
                vertical_ids.add(v["id"])

    for sh in ("A-1", "A-2", "A-4"):
        if sh not in slices:
            continue
        lay = slices[sh]["layout"]
        floors = sorted(
            {s.get("floor") for s in lay.get("spaces", []) if isinstance(s, dict)}
            | {f.get("floor") for f in lay.get("floors", []) if isinstance(f, dict)}
        )
        for src in floors:
            if src is None:
                continue
            targets = TYPICAL_FLOORS.get(sh, [src]) if src == 2 and sh in TYPICAL_FLOORS else [src]
            for dst in targets:
                parts.append(_copy_floor(lay, src, dst, vertical_ids))
                if dst != src:
                    notes.append(f"Copied {sh} floor {src} to floor {dst} (ids f{src}- -> f{dst}-).")

    layout = {
        "floors": [
            {"floor": f, "label": f"Floor {f}", "elevation_m": (f - 1) * 3.0, "height_m": 3.0, "sheet_id": SHEET_FOR_FLOOR[f]}
            for f in range(1, 6)
        ],
        "spaces": [],
        "openings": [],
        "verticals": [],
        "entrances": [],
    }

    verts = {}
    for p in parts:
        layout["spaces"] += p["spaces"]
        layout["openings"] += p["openings"]
        layout["entrances"] += p["entrances"]
        for v in p["verticals"]:
            vid = v["id"]
            if vid not in verts:
                verts[vid] = dict(copy.deepcopy(v), stops=[])
            else:
                # Preserve and merge drafted_awaiting_review + review_note from ANY floor
                if v.get("layout_status") == "drafted_awaiting_review":
                    _flag(verts[vid], v.get("review_note") or "")
                elif v.get("review_note"):
                    note = v["review_note"]
                    if note not in (verts[vid].get("review_note") or ""):
                        verts[vid]["review_note"] = (
                            (verts[vid]["review_note"] + " | ") if verts[vid].get("review_note") else ""
                        ) + note
            verts[vid]["stops"] += v["stops"]

    for v in verts.values():
        v["stops"].sort(key=lambda s: s["floor"])
        v["floors_connected"] = sorted({s["floor"] for s in v["stops"]})
        layout["verticals"].append(v)

    # Cross-check against the A-301 section slice.
    section = (slices.get("A-301") or {}).get("section") or []
    spaces = {s["id"]: s for s in layout["spaces"]}
    for sec in section:
        vid = sec.get("vertical")
        v = verts.get(vid)
        if v is None:
            notes.append(f"Section lists {vid} but no plan sheet shows it; not added.")
            continue
        want = sorted(set(sec.get("floors") or []))
        have = v["floors_connected"]
        if want and want != have:
            _flag(v, f"Section A-301 says floors {want}; plans show stops on {have}.")
            notes.append(f"{vid}: section floors {want} vs plan stops {have}; kept plan geometry, flagged.")
        for k, name in (sec.get("opens_to") or {}).items():
            for fl in _floors_from_key(k):
                st = next((s for s in v["stops"] if s["floor"] == fl), None)
                if st is None:
                    continue
                sp = spaces.get(st.get("space_id"))
                if sp is None:
                    continue
                target = re.split(r"->|→", name)[0]
                if _words(target) and not (_words(target) & _words(sp.get("label"))) and fl != 1:
                    notes.append(
                        f"{vid} floor {fl}: section says opens to '{name}', plan stop space is "
                        f"'{sp.get('label')}' (kept plan; words differ only)."
                    )

    schema.normalize_layout(layout)
    return layout, notes
