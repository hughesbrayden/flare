"""Local accuracy scorer: compares an agent-built layout to the answer key.

This is the ONLY module that opens true_model.json. Nothing here is ever sent to an agent.

Agents choose their own ids, so matching is geometric:
  spaces     same floor, best bbox IoU >= 0.5 (one-to-one, greedy by IoU)
  verticals  same kind and same letter/number in the label (A, B, C, E1)
  openings   same floor, position within 1.0 m  -> "found";
             plus both ends map to the true ends -> "correct"
  stops      per vertical per floor, the stop opens into the right (mapped) space
  trap       both front stairs (A and B) open into the floor-4 East Lobby, and
             routing confirms the lobby is a shared chokepoint for 142/144 while
             the rear alley route via Stair C bypasses it
"""
import json
import re
from collections import deque

from . import config

SPACE_IOU = 0.5
OPENING_DIST = 1.0


def load_truth():
    with open(config.TRUE_MODEL_PATH, encoding="utf-8") as f:
        return json.load(f)["layout"]


def _iou(a, b):
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def _vkey(v):
    lab = (v.get("label") or v.get("id") or "").upper()
    if v.get("kind") == "elevator":
        m = re.search(r"E\s*-?\s*(\d+)", lab) or re.search(r"(\d+)", lab)
        return ("elevator", m.group(1) if m else "1")
    m = re.search(r"STAIR\s*([A-Z])\b", lab) or re.search(r"STAIR-([A-Z])\b", (v.get("id") or "").upper())
    return ("stair", m.group(1) if m else lab)


def match(pred, truth):
    """Return {pred_id: true_id} for spaces and verticals, plus per-space IoUs."""
    mapping, ious = {}, {}
    cands = []
    for p in pred.get("spaces", []):
        for t in truth["spaces"]:
            if p.get("floor") == t["floor"]:
                v = _iou(p["bbox_m"], t["bbox_m"])
                if v >= SPACE_IOU:
                    cands.append((v, p["id"], t["id"]))
    used_p, used_t = set(), set()
    for v, pid, tid in sorted(cands, reverse=True):
        if pid in used_p or tid in used_t:
            continue
        mapping[pid] = tid; ious[tid] = round(v, 3); used_p.add(pid); used_t.add(tid)
    tv = {_vkey(v): v["id"] for v in truth["verticals"]}
    for v in pred.get("verticals", []):
        k = _vkey(v)
        if k in tv and tv[k] not in mapping.values():
            mapping[v["id"]] = tv[k]
    return mapping, ious


def _graph(layout, ids=lambda x: x, closed=(), closed_doors=()):
    """closed: node ids; closed_doors: (floor, frozenset(true ends)) of openings to drop."""
    g = {}
    def add(a, b):
        g.setdefault(a, set()).add(b); g.setdefault(b, set()).add(a)
    for o in layout["openings"]:
        if len(o.get("connects", [])) != 2:
            continue
        a, b = [ids(x) for x in o["connects"]]
        if a is None or b is None or a in closed or b in closed:
            continue
        if (o.get("floor"), frozenset((a, b))) in closed_doors:
            continue
        if a.startswith("elevator") or b.startswith("elevator"):
            continue
        fa = f"{a}@{o['floor']}" if a.startswith("stair") else a
        fb = f"{b}@{o['floor']}" if b.startswith("stair") else b
        add(fa, fb)
    for v in layout["verticals"]:
        vid = ids(v["id"])
        if vid is None or not vid.startswith("stair"):
            continue
        fl = sorted({s["floor"] for s in v.get("stops", [])})
        for x, y in zip(fl, fl[1:]):
            add(f"{vid}@{x}", f"{vid}@{y}")
    return g


def _reach(g, start, target):
    if start is None:
        return False
    seen, q = {start}, deque([start])
    while q:
        n = q.popleft()
        if n == target:
            return True
        for x in g.get(n, ()):
            if x not in seen:
                seen.add(x); q.append(x)
    return False


def score(pred_layout, truth=None):
    truth = truth or load_truth()
    pred = {k: pred_layout.get(k, []) for k in ("floors", "spaces", "openings", "verticals", "entrances")}
    mapping, ious = match(pred, truth)
    m = lambda x: mapping.get(x)

    # spaces
    n_true_sp = len(truth["spaces"])
    sp_matched = len([t for t in truth["spaces"] if t["id"] in ious])
    sp_missing = [t["id"] for t in truth["spaces"] if t["id"] not in ious]
    sp_extra = [p["id"] for p in pred["spaces"] if p["id"] not in mapping]

    # openings
    found = correct = 0
    wrong = []
    for t in truth["openings"]:
        best, bd = None, None
        for p in pred["openings"]:
            if p.get("floor") != t["floor"] or not p.get("pos_m"):
                continue
            d = ((p["pos_m"][0] - t["pos_m"][0]) ** 2 + (p["pos_m"][1] - t["pos_m"][1]) ** 2) ** 0.5
            if d <= OPENING_DIST and (bd is None or d < bd):
                best, bd = p, d
        if best is None:
            continue
        found += 1
        if {m(x) for x in best.get("connects", [])} == set(t["connects"]):
            correct += 1
        else:
            wrong.append({"true": t["id"], "pred": best["id"], "pred_connects_mapped": [m(x) for x in best.get("connects", [])],
                          "true_connects": t["connects"]})

    # connections: unordered space pairs per floor (vertical ends tagged by floor)
    def edges(layout, f):
        out = set()
        for o in layout["openings"]:
            c = [f(x) for x in o.get("connects", [])]
            if len(c) == 2 and None not in c:
                out.add((o.get("floor"), frozenset(c)))
        return out
    te = edges(truth, lambda x: x); pe = edges(pred, m)
    conn_tp = len(te & pe)

    # stair / elevator stops
    stops_total = stops_ok = 0
    stop_errors = []
    pv = {m(v["id"]): v for v in pred["verticals"] if m(v["id"])}
    for t in truth["verticals"]:
        for ts in t["stops"]:
            stops_total += 1
            pvx = pv.get(t["id"])
            ps = next((s for s in (pvx or {}).get("stops", []) if s.get("floor") == ts["floor"]), None)
            if ps and m(ps.get("space_id")) == ts["space_id"]:
                stops_ok += 1
            else:
                stop_errors.append({"vertical": t["id"], "floor": ts["floor"], "expected": ts["space_id"],
                                    "got": (m(ps.get("space_id")) or ps.get("space_id")) if ps else None})

    # trap
    def stop_space(vid, floor):
        v = pv.get(vid)
        s = next((s for s in (v or {}).get("stops", []) if s.get("floor") == floor), None)
        return m(s.get("space_id")) if s else None
    a4, b4, c4 = stop_space("stair-a", 4), stop_space("stair-b", 4), stop_space("stair-c", 4)
    g_all = _graph(pred, ids=m)
    g_nolobby = _graph(pred, ids=m, closed=("f4-east-lobby",))
    ent = {}
    for e in pred["entrances"]:
        tgt = m(e.get("connects_to_space_id"))
        lab = (e.get("label", "") + " " + e.get("street_label", "") + " " + e.get("id", "")).lower()
        key = "142" if "142" in lab else "144" if "144" in lab else "alley" if ("alley" in lab or "rear" in lab) else None
        if key:
            ent[key] = tgt
    target = "f4-apt-4c"
    front_reach = {k: _reach(g_all, ent.get(k), target) for k in ("142", "144")}
    alley_bypass = _reach(g_nolobby, ent.get("alley"), target)
    # D6: with the lobby out, every remaining route (alley, or floor-3 crossover) uses Stair C's floor-4 door
    g_none = _graph(pred, ids=m, closed=("f4-east-lobby",), closed_doors={(4, frozenset(("stair-c", "f4-ne-hall")))})
    no_route = not any(_reach(g_none, ent.get(k), target) for k in ("142", "144", "alley"))
    trap = {
        "stair_a_f4_opens_to": a4, "stair_b_f4_opens_to": b4, "stair_c_f4_opens_to": c4,
        "both_front_stairs_into_east_lobby": a4 == "f4-east-lobby" and b4 == "f4-east-lobby",
        "front_entrances_reach_4c": front_reach,
        "rear_alley_bypass_via_stair_c": alley_bypass,
        "no_documented_route_without_lobby_and_stair_c_f4_door": no_route,
    }
    # The trap as defined in TRACK_B: both front stairs open into the floor-4 East Lobby,
    # and the rear Stair C bypass is still in the model.
    trap["holds"] = bool(trap["both_front_stairs_into_east_lobby"] and alley_bypass and all(front_reach.values()))

    # ambiguity 2 kept as drafted, not dropped
    note7 = None
    for o in pred["openings"]:
        ends = {m(x) for x in o.get("connects", [])}
        if o.get("floor") == 4 and ends == {"stair-c", "f4-ne-hall"}:
            note7 = o.get("layout_status")

    r = lambda a, b: round(a / b, 3) if b else 0.0
    f1 = lambda p, rec: round(2 * p * rec / (p + rec), 3) if (p + rec) > 0 else 0.0
    sp_rec = r(sp_matched, n_true_sp)
    sp_prec = r(sp_matched, len(pred["spaces"]))
    sp_f1 = f1(sp_prec, sp_rec)
    conn_rec = r(conn_tp, len(te))
    conn_prec = r(conn_tp, len(pe))
    conn_f1 = f1(conn_prec, conn_rec)
    metrics = {
        "spaces_matched": sp_matched, "spaces_true": n_true_sp, "spaces_recall": sp_rec,
        "spaces_precision": sp_prec, "spaces_f1": sp_f1, "spaces_missing": sp_missing, "spaces_extra": sp_extra,
        "openings_true": len(truth["openings"]), "openings_found": found, "openings_correct": correct,
        "openings_found_rate": r(found, len(truth["openings"])), "openings_correct_rate": r(correct, len(truth["openings"])),
        "openings_wrong": wrong,
        "connections_true": len(te), "connections_pred": len(pe), "connections_correct": conn_tp,
        "connections_recall": conn_rec, "connections_precision": conn_prec, "connections_f1": conn_f1,
        "stops_true": stops_total, "stops_correct": stops_ok, "stops_rate": r(stops_ok, stops_total), "stop_errors": stop_errors,
        "trap": trap, "stair_c_f4_door_status": note7,
    }
    metrics["overall"] = round((metrics["spaces_f1"] + metrics["openings_correct_rate"] + metrics["connections_f1"]
                                + metrics["stops_rate"] + (1.0 if trap["holds"] else 0.0)) / 5, 3)
    return metrics
