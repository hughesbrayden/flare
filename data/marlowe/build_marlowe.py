"""Generate Marlowe House (fictional) from one set of coordinates:
  - true_model.json  (answer key, in the decided D5 format)
  - sheets/A-1.png, A-2.png, A-4.png, A-301.png  (plan sheets the agents read)
and check that the routing trap behaves as designed.

Decided in D4: two street addresses (142 and 144 Marlowe St) lead to Stair A and Stair B, scissor
stairs in one shaft whose floor 2-5 doors both open into the East Lobby. A rear alley gate (access
unconfirmed) leads to Stair C, the only route to 4C that bypasses the lobby.
Ambiguity 1 (sheet A-4): callout "STAIR A (W) ->" though the door opens east into the lobby.
Ambiguity 2 (sheet A-4): Stair C's floor-4 door is annotated "F.D. - SEE NOTE 7"; note 7 is missing.

Coordinates: meters, x west->east (0-24), y south (Marlowe St) -> north (alley) (0-14).
Run: python build_marlowe.py
"""
import json, os
from collections import deque
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
W_M, D_M = 24.0, 14.0
FLOORS = [1, 2, 3, 4, 5]
UPPER = [2, 3, 4, 5]
FLOOR_H = 3.0

# ---------- sheet geometry (shared by drawing and source_ref) ----------
SHEET_W, SHEET_H = 2000, 1300
OX, OY, PX = 120, 140, 60  # drawing origin and pixels per meter


def to_px(x, y):
    return OX + x * PX, OY + (D_M - y) * PX


def region_norm(b):
    x0, y0 = to_px(b[0], b[3]); x1, y1 = to_px(b[2], b[1])
    return [round(x0 / SHEET_W, 4), round(y0 / SHEET_H, 4), round(x1 / SHEET_W, 4), round(y1 / SHEET_H, 4)]


def sheet_for(f):
    return "A-1" if f == 1 else ("A-4" if f == 4 else "A-2")


# ---------- the building ----------
spaces, openings, verticals, entrances = [], [], [], []


def space(id_, type_, label, f, b, callout=None, status="verified_on_plan", note=None):
    s = {"id": id_, "type": type_, "label": label, "floor": f, "bbox_m": b,
         "source_ref": {"sheet": sheet_for(f), "region_norm": region_norm(b), "callout": callout or label},
         "layout_status": status}
    if note: s["review_note"] = note
    spaces.append(s)


def opening(id_, kind, f, a, b, pos, callout, fire_rated=False, status="verified_on_plan", note=None):
    bx = [pos[0] - 0.6, pos[1] - 0.6, pos[0] + 0.6, pos[1] + 0.6]
    o = {"id": id_, "kind": kind, "floor": f, "connects": [a, b], "pos_m": pos, "fire_rated": fire_rated,
         "source_ref": {"sheet": sheet_for(f), "region_norm": region_norm(bx), "callout": callout},
         "layout_status": status}
    if note: o["review_note"] = note
    openings.append(o)


# Floor 1
space("f1-west-vestibule", "lobby", "WEST VESTIBULE (142)", 1, [0, 0, 10, 5])
space("f1-west-passage", "hall", "EXIT PASSAGEWAY", 1, [6, 5, 10, 12])
space("f1-super", "apartment", "1A (SUPER)", 1, [0, 5, 6, 14], "1A")
space("f1-mech", "utility", "MECH.", 1, [10, 5, 14, 9])
space("f1-east-vestibule", "lobby", "EAST VESTIBULE (144)", 1, [14, 0, 24, 5])
space("f1-east-passage", "hall", "STAIR HALL", 1, [14, 5, 18, 12])
space("f1-boiler", "utility", "BOILER RM.", 1, [18, 5, 21.5, 14])
space("f1-trash", "utility", "TRASH", 1, [21.5, 5, 24, 9])
space("f1-rear-vestibule", "lobby", "REAR SERVICE VESTIBULE", 1, [21.5, 12, 24, 14])
opening("o1-wvest-wpass", "open_passage", 1, "f1-west-vestibule", "f1-west-passage", [8, 5], "")
opening("o1-wpass-super", "door", 1, "f1-west-passage", "f1-super", [6, 9], "")
opening("o1-evest-epass", "open_passage", 1, "f1-east-vestibule", "f1-east-passage", [16, 5], "")
opening("o1-epass-boiler", "door", 1, "f1-east-passage", "f1-boiler", [18, 7], "")
opening("o1-evest-trash", "door", 1, "f1-east-vestibule", "f1-trash", [22.75, 5], "")

# Floors 2-5
for f in UPPER:
    n = str(f)
    space(f"f{n}-west-corr", "hall", "WEST CORRIDOR", f, [0, 6, 10, 8])
    space(f"f{n}-east-lobby", "lobby", "EAST LOBBY", f, [10, 5, 14, 9])
    space(f"f{n}-east-corr", "hall", "EAST CORRIDOR", f, [14, 6, 21.5, 8])
    space(f"f{n}-ne-hall", "hall", "N.E.\nHALL", f, [21.5, 6, 24, 9], callout="N.E. SERVICE HALL")
    space(f"f{n}-apt-{n}a", "apartment", f"{n}A", f, [0, 8, 10, 14])
    space(f"f{n}-apt-{n}b", "apartment", f"{n}B", f, [0, 0, 10, 6])
    space(f"f{n}-apt-{n}c", "apartment", f"{n}C", f, [14, 8, 21.5, 14])
    space(f"f{n}-apt-{n}d", "apartment", f"{n}D", f, [14, 0, 24, 6])
    space(f"f{n}-refuse", "utility", "REFUSE", f, [12, 2.5, 14, 5])
    opening(f"o{n}-wcorr-lobby", "open_passage", f, f"f{n}-west-corr", f"f{n}-east-lobby", [10, 7], "")
    opening(f"o{n}-lobby-ecorr", "open_passage", f, f"f{n}-east-lobby", f"f{n}-east-corr", [14, 7], "")
    opening(f"o{n}-ecorr-nehall", "door", f, f"f{n}-east-corr", f"f{n}-ne-hall", [21.5, 7], "", fire_rated=True)
    opening(f"o{n}-wcorr-{n}a", "door", f, f"f{n}-west-corr", f"f{n}-apt-{n}a", [5, 8], f"{n}A ENTRY", fire_rated=True)
    opening(f"o{n}-wcorr-{n}b", "door", f, f"f{n}-west-corr", f"f{n}-apt-{n}b", [5, 6], f"{n}B ENTRY", fire_rated=True)
    opening(f"o{n}-ecorr-{n}c", "door", f, f"f{n}-east-corr", f"f{n}-apt-{n}c", [17.75, 8], f"{n}C ENTRY", fire_rated=True)
    opening(f"o{n}-ecorr-{n}d", "door", f, f"f{n}-east-corr", f"f{n}-apt-{n}d", [19, 6], f"{n}D ENTRY", fire_rated=True)

# Verticals: Stair A and B share one scissor shaft [10,9,14,12]; Stair C at the NE corner; elevator E1.
def vertical(id_, kind, label, bbox, stops_by_floor, callout, status="verified_on_plan", note=None):
    stops = []
    for f, (space_id, pos, door_callout, dstatus, dnote) in stops_by_floor.items():
        oid = f"door-f{f}-{id_}"
        opening(oid, "fire_door" if kind == "stair" else "elevator_door", f, id_, space_id, pos,
                door_callout, fire_rated=True, status=dstatus, note=dnote)
        stops.append({"floor": f, "bbox_m": bbox, "opening_id": oid, "space_id": space_id})
    v = {"id": id_, "kind": kind, "label": label, "floors_connected": sorted(stops_by_floor),
         "stops": stops, "source_ref": {"sheet": "A-301", "region_norm": [0.06, 0.1, 0.5, 0.9], "callout": callout},
         "layout_status": status}
    if note: v["review_note"] = note
    verticals.append(v)


ok = ("verified_on_plan", None)
vertical("stair-a", "stair", "STAIR A", [10, 9, 12, 12],
         {1: ("f1-west-passage", [10, 10.5], "STAIR A", *ok),
          **{f: (f"f{f}-east-lobby", [11, 9], "STAIR A (W) ->" if f == 4 else "STAIR A", *ok) for f in UPPER}},
         "STAIR A / STAIR B - SCISSOR (ONE SHAFT)")
vertical("stair-b", "stair", "STAIR B", [12, 9, 14, 12],
         {1: ("f1-east-passage", [14, 10.5], "STAIR B", *ok),
          **{f: (f"f{f}-east-lobby", [13, 9], "STAIR B", *ok) for f in UPPER}},
         "STAIR A / STAIR B - SCISSOR (ONE SHAFT)")
note7 = "Annotated 'F.D. - SEE NOTE 7', but note 7 is missing from the sheet set. Door shown; usability from the stair side unclear."
vertical("stair-c", "stair", "STAIR C (REAR SERVICE)", [21.5, 9, 24, 12],
         {1: ("f1-rear-vestibule", [22.75, 12], "STAIR C", *ok),
          **{f: (f"f{f}-ne-hall", [22.75, 9],
                 "F.D. - SEE NOTE 7" if f == 4 else "STAIR C",
                 "drafted_awaiting_review" if f == 4 else "verified_on_plan",
                 note7 if f == 4 else None) for f in UPPER}},
         "STAIR C (REAR SERVICE)")
vertical("elevator-e1", "elevator", "ELEVATOR E1", [10, 2.5, 12, 5],
         {1: ("f1-west-vestibule", [10, 3.75], "E1", *ok),
          **{f: (f"f{f}-east-lobby", [11, 5], "E1", *ok) for f in UPPER}},
         "ELEVATOR E1")


def entrance(id_, label, street, space_id, pos, confirmed, callout):
    b = [pos[0] - 1, pos[1] - 0.6, pos[0] + 1, pos[1] + 0.6]
    entrances.append({"id": id_, "label": label, "floor": 1, "street_label": street, "connects_to_space_id": space_id,
                      "pos_m": pos, "access_confirmed": confirmed,
                      "source_ref": {"sheet": "A-1", "region_norm": region_norm(b), "callout": callout},
                      "layout_status": "verified_on_plan"})


entrance("ent-142", "142 Marlowe St (west entry)", "Marlowe St", "f1-west-vestibule", [4, 0], True, "142 MARLOWE ST")
entrance("ent-144", "144 Marlowe St (east entry)", "Marlowe St", "f1-east-vestibule", [19, 0], True, "144 MARLOWE ST")
entrance("ent-alley", "Rear alley service gate", "North Service Alley", "f1-rear-vestibule", [22.75, 14], False, "ALLEY GATE - KEYED")

SHEETS = [
    {"id": "A-1", "label": "First Floor Plan", "floor": 1, "file": "sheets/A-1.png", "width_px": SHEET_W, "height_px": SHEET_H},
    {"id": "A-2", "label": "Typical Floor Plan (Floors 2, 3, 5)", "floor": 2, "file": "sheets/A-2.png", "width_px": SHEET_W, "height_px": SHEET_H},
    {"id": "A-4", "label": "Fourth Floor Plan", "floor": 4, "file": "sheets/A-4.png", "width_px": SHEET_W, "height_px": SHEET_H},
    {"id": "A-301", "label": "Stair Section", "floor": None, "file": "sheets/A-301.png", "width_px": SHEET_W, "height_px": SHEET_H},
]

model = {
    "schema_version": "1.0",
    "building": {"id": "marlowe-house", "name": "Marlowe House", "address": "142-144 Marlowe St",
                 "is_fictional": True, "footprint_m": {"w": W_M, "d": D_M}},
    "sheets": SHEETS,
    "layout": {
        "floors": [{"floor": f, "label": f"Floor {f}", "elevation_m": (f - 1) * FLOOR_H, "height_m": FLOOR_H,
                    "sheet_id": sheet_for(f)} for f in FLOORS],
        "spaces": spaces, "openings": openings, "verticals": verticals, "entrances": entrances},
    "conditions": [],
    "test_annotations": [
        {"id": "ambiguity-1", "sheet": "A-4", "target_id": "door-f4-stair-a",
         "what": "Callout reads 'STAIR A (W) ->' near the west corridor, but the Stair A door opens east into the East Lobby.",
         "expected": "A careful reader connects Stair A to the East Lobby on floor 4; the checker should catch a reader that connects it to the West Corridor."},
        {"id": "ambiguity-2", "sheet": "A-4", "target_id": "door-f4-stair-c",
         "what": "Stair C floor-4 door annotated 'F.D. - SEE NOTE 7'; the notes list skips 7.",
         "expected": "The model keeps the door but marks it drafted_awaiting_review with a note, and the demo points to it at 'show me where it comes out'."}],
}

# ---------- route check ----------
def graph(m, closed=()):
    g = {}
    def add(a, b):
        g.setdefault(a, set()).add(b); g.setdefault(b, set()).add(a)
    for o in m["layout"]["openings"]:
        a, b = o["connects"]
        fa = f"{a}@{o['floor']}" if a.startswith(("stair-", "elevator-")) else a
        fb = f"{b}@{o['floor']}" if b.startswith(("stair-", "elevator-")) else b
        if a in closed or b in closed or o["id"] in closed: continue
        add(fa, fb)
    for v in m["layout"]["verticals"]:
        fl = v["floors_connected"]
        for x, y in zip(fl, fl[1:]):
            add(f"{v['id']}@{x}", f"{v['id']}@{y}")
    return g


def routes_from(m, entrance_id, target, closed=()):
    ent = next(e for e in m["layout"]["entrances"] if e["id"] == entrance_id)
    if entrance_id in closed: return None
    g = graph(m, closed)
    start = ent["connects_to_space_id"]
    prev, q, seen = {}, deque([start]), {start}
    while q:
        n = q.popleft()
        if n == target:
            path = [n]
            while path[-1] in prev: path.append(prev[path[-1]])
            return list(reversed(path))
        for x in g.get(n, ()):
            if x not in seen: seen.add(x); prev[x] = n; q.append(x)
    return None


def check(m):
    t = "f4-apt-4c"
    out = []
    for closed, label in [((), "nothing assumed"), (("f4-east-lobby",), "east lobby unavailable"),
                          (("f4-east-lobby", "ent-alley"), "east lobby AND rear alley unavailable")]:
        out.append(f"-- {label}")
        for e in ["ent-142", "ent-144", "ent-alley"]:
            r = routes_from(m, e, t, closed)
            out.append(f"   {e}: {' -> '.join(r) if r else 'NO ROUTE'}")
    return "\n".join(out)


# ---------- drawing ----------
def font(size, bold=False):
    for name in (["arialbd.ttf"] if bold else []) + ["arial.ttf", "DejaVuSans.ttf"]:
        try: return ImageFont.truetype(name, size)
        except Exception: pass
    return ImageFont.load_default()


F_SM, F_MD, F_LG, F_XL = font(16), font(20), font(26, True), font(34, True)


def rect(d, b, w=4):
    x0, y0 = to_px(b[0], b[3]); x1, y1 = to_px(b[2], b[1])
    d.rectangle([x0, y0, x1, y1], outline="black", width=w)


def label(d, b, text, f=F_MD):
    cx, cy = to_px((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
    for i, line in enumerate(text.split("\n")):
        tw = d.textlength(line, font=f)
        d.text((cx - tw / 2, cy - 12 + i * 24 - (len(text.split("\n")) - 1) * 12), line, fill="black", font=f)


def door(d, pos, swing=True, vertical_wall=None):
    x, y = to_px(*pos)
    r = 0.45 * PX
    if vertical_wall is None:
        vertical_wall = False
    if vertical_wall:
        d.rectangle([x - 4, y - r, x + 4, y + r], fill="white")
        if swing: d.arc([x - r * 2, y - r, x, y + r], 270, 90, fill="black", width=2)
    else:
        d.rectangle([x - r, y - 4, x + r, y + 4], fill="white")
        if swing: d.arc([x - r, y - r * 2, x + r, y], 0, 180, fill="black", width=2)


def stair_hatch(d, b, n=8, cross=False):
    x0, y0 = to_px(b[0], b[3]); x1, y1 = to_px(b[2], b[1])
    for i in range(1, n):
        xx = x0 + (x1 - x0) * i / n
        d.line([xx, y0 + 6, xx, y1 - 6], fill="black", width=1)
    if cross:
        d.line([x0, y0, x1, y1], fill="black", width=1); d.line([x0, y1, x1, y0], fill="black", width=1)


def frame(d, sheet_id, title, notes):
    d.rectangle([20, 20, SHEET_W - 20, SHEET_H - 20], outline="black", width=3)
    d.rectangle([1620, 20, SHEET_W - 20, SHEET_H - 20], outline="black", width=3)
    d.text((1640, 50), "MARLOWE HOUSE", fill="black", font=F_XL)
    d.text((1640, 95), "142-144 MARLOWE ST", fill="black", font=F_MD)
    d.text((1640, 122), "(FICTIONAL - TEST BUILDING)", fill="black", font=F_SM)
    d.text((1640, 170), title, fill="black", font=F_LG)
    d.text((1640, 1180), sheet_id, fill="black", font=font(64, True))
    d.text((1640, 240), "GENERAL NOTES", fill="black", font=F_LG)
    yy = 280
    for num, text in notes:
        for j, line in enumerate(wrap(f"{num}. {text}", 34)):
            d.text((1640, yy), line, fill="black", font=F_SM); yy += 22
        yy += 8
    # north arrow and scale
    d.polygon([(1540, 60), (1525, 110), (1555, 110)], outline="black", fill="black")
    d.text((1533, 115), "N", fill="black", font=F_LG)
    sx, sy = OX, SHEET_H - 70
    for i in range(5):
        d.rectangle([sx + i * PX, sy, sx + (i + 1) * PX, sy + 10], outline="black", fill="black" if i % 2 == 0 else "white")
    d.text((sx, sy + 16), "0      1      2      3      4      5 m", fill="black", font=F_SM)


def wrap(text, n):
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > n: lines.append(cur); cur = w
        else: cur = (cur + " " + w).strip()
    return lines + [cur]


NOTES = [(1, "ALL CORRIDOR DOORS SELF-CLOSING, 1-1/2 HR RATED."), (2, "STAIRS A AND B ARE SCISSOR STAIRS. SEE A-301."),
         (3, "ELEVATOR E1 NOT FOR FIRE SERVICE USE."), (4, "APARTMENT ENTRY DOORS 20 MIN RATED."),
         (5, "DIMENSIONS IN METERS."), (6, "REFUSE ROOMS SPRINKLERED."),
         (8, "REAR SERVICE STAIR C SERVES FLOORS 1-5. ALLEY GATE KEYED BY MGMT.")]


def draw_floor(f, path, sheet_id, title):
    img = Image.new("RGB", (SHEET_W, SHEET_H), "white"); d = ImageDraw.Draw(img)
    for s in spaces:
        if s["floor"] != f: continue
        rect(d, s["bbox_m"])
    for v in verticals:
        b = next(st["bbox_m"] for st in v["stops"])
        rect(d, b)
        stair_hatch(d, b, cross=(v["kind"] == "elevator"))
    rect(d, [0, 0, W_M, D_M], w=8)
    for s in spaces:
        if s["floor"] != f: continue
        lab = s["label"]
        if s["type"] == "apartment": lab = s["label"] if "SUPER" in s["label"] else s["label"]
        label(d, s["bbox_m"], lab, F_LG if s["type"] == "apartment" else F_MD)
    for o in openings:
        if o["floor"] != f: continue
        x, y = o["pos_m"]
        vertical_wall = (abs(x - round(x)) < 1e-6 and x in (6, 10, 14, 18, 21.5)) and not (abs(y - round(y)) < 1e-6 and y in (5, 6, 8, 9, 12))
        door(d, o["pos_m"], swing=o["kind"] != "open_passage", vertical_wall=vertical_wall)
    # stair labels and callouts
    for v in verticals:
        st = next(s for s in v["stops"] if s["floor"] == f)
        b = st["bbox_m"]
        cx, cy = to_px((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
        name = {"stair-a": "A", "stair-b": "B", "stair-c": "C", "elevator-e1": "E1"}[v["id"]]
        tw = d.textlength(name, font=F_LG)
        d.rectangle([cx - tw / 2 - 6, cy - 16, cx + tw / 2 + 6, cy + 16], fill="white", outline="black")
        d.text((cx - tw / 2, cy - 14), name, fill="black", font=F_LG)
    for o in openings:
        if o["floor"] != f or not o["source_ref"]["callout"] or o["kind"] in ("open_passage",): continue
        c = o["source_ref"]["callout"]
        if c in ("STAIR A", "STAIR B", "STAIR C", "E1") or c.endswith("ENTRY"): continue
        x, y = o["pos_m"]
        if c == "STAIR A (W) ->":
            px, py = to_px(6.2, 8.6)  # placed near the west corridor: the misleading part
        elif c.startswith("F.D. - SEE NOTE 7"):
            px, py = to_px(21.6, 13.6)  # in the small NE room, with a leader line down to the door
            dx, dy = to_px(22.75, 9.3)
            d.line([px + 60, py + 22, dx, dy], fill="black", width=1)
        else:
            px, py = to_px(x + 0.2, y + 0.4)
        d.text((px, py), c, fill="black", font=F_SM)
    for e in entrances:
        if f != 1: continue
        x, y = e["pos_m"]; px, py = to_px(x, y)
        d.rectangle([px - 30, py - 5, px + 30, py + 5], fill="white")
        d.polygon([(px, py + (28 if y == 0 else -28)), (px - 10, py + (12 if y == 0 else -12)), (px + 10, py + (12 if y == 0 else -12))], fill="black")
        tx = px - d.textlength(e["source_ref"]["callout"], font=F_MD) / 2
        d.text((tx, py + (34 if y == 0 else -56)), e["source_ref"]["callout"], fill="black", font=F_MD)
    d.text((OX, 40), "MARLOWE ST (SOUTH)" if False else "NORTH SERVICE ALLEY", fill="black", font=F_MD)
    d.text((OX, OY + D_M * PX + 40), "MARLOWE ST", fill="black", font=F_MD)
    notes = NOTES if sheet_id == "A-4" else [n for n in NOTES]
    if sheet_id != "A-4":
        notes = sorted(NOTES + [(7, "STAIR C DOORS ARE FIRE DOORS.")])  # note 7 present on other sheets; missing on A-4
    frame(d, sheet_id, title, notes)
    img.save(path)


def draw_section(path):
    img = Image.new("RGB", (SHEET_W, SHEET_H), "white"); d = ImageDraw.Draw(img)
    fh = 180; base = 1080
    for i, f in enumerate(FLOORS):
        y = base - i * fh
        d.line([150, y, 1500, y], fill="black", width=3)
        d.text((60, y - 30), f"FL {f}", fill="black", font=F_LG)
    d.line([150, base - 5 * fh, 1500, base - 5 * fh], fill="black", width=3)
    # scissor shaft
    sx0, sx1 = 450, 800
    d.rectangle([sx0, base - 5 * fh, sx1, base], outline="black", width=5)
    for i in range(5):
        y0, y1 = base - i * fh, base - (i + 1) * fh
        d.line([sx0, y0, sx1, y1], fill="black", width=2)
        d.line([sx1, y0, sx0, y1], fill="black", width=2)
    d.text((sx0 + 20, base - 5 * fh - 60), "STAIR A / STAIR B - SCISSOR (ONE SHAFT)", fill="black", font=F_LG)
    d.text((sx0 - 300, base - 60), "A -> EXIT PASSAGE -> 142", fill="black", font=F_SM)
    d.text((sx1 + 20, base - 60), "B -> STAIR HALL -> 144", fill="black", font=F_SM)
    for i in range(1, 5):
        y = base - i * fh - 60
        d.text((sx1 + 20, y), "A & B DOORS -> EAST LOBBY", fill="black", font=F_SM)
    # stair C
    cx0, cx1 = 1150, 1350
    d.rectangle([cx0, base - 5 * fh, cx1, base], outline="black", width=5)
    for i in range(5):
        y0, y1 = base - i * fh, base - (i + 1) * fh
        d.line([cx0, y0, cx1, y1], fill="black", width=2)
    d.text((cx0 - 20, base - 5 * fh - 60), "STAIR C (REAR SERVICE)", fill="black", font=F_LG)
    d.text((cx0 - 40, base + 15), "-> REAR VESTIBULE -> ALLEY GATE", fill="black", font=F_SM)
    for i in range(1, 5):
        d.text((cx1 + 15, base - i * fh - 60), "-> N.E. SERVICE HALL", fill="black", font=F_SM)
    frame(d, "A-301", "STAIR SECTION", sorted(NOTES + [(7, "STAIR C DOORS ARE FIRE DOORS.")]))
    img.save(path)


if __name__ == "__main__":
    os.makedirs(os.path.join(HERE, "sheets"), exist_ok=True)
    json.dump(model, open(os.path.join(HERE, "true_model.json"), "w", encoding="utf-8"), indent=1)
    draw_floor(1, os.path.join(HERE, "sheets", "A-1.png"), "A-1", "FIRST FLOOR PLAN")
    draw_floor(2, os.path.join(HERE, "sheets", "A-2.png"), "A-2", "TYPICAL FLOOR PLAN\n(FLOORS 2, 3, 5)")
    draw_floor(4, os.path.join(HERE, "sheets", "A-4.png"), "A-4", "FOURTH FLOOR PLAN")
    draw_section(os.path.join(HERE, "sheets", "A-301.png"))
    print(f"{len(spaces)} spaces, {len(openings)} openings, {len(verticals)} verticals, {len(entrances)} entrances")
    print(check(model))
