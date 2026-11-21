# Building layout format (D5, layout layer)

You write only the `layout` part of the building model. JSON, UTF-8, no comments.

## Coordinates
- Meters. Origin (0, 0) is the **south-west outer corner of the building outline** (bottom-left on the sheet; Marlowe St is south, the service alley is north).
- `x` runs west -> east, `y` runs south -> north. The building footprint is 24.0 m (x) by 14.0 m (y).
- Use the sheet's scale bar to convert pixels to meters. All floors share the same origin.
- `bbox_m` is `[x0, y0, x1, y1]` with `x0 < x1`, `y0 < y1`. Walls are lines: rooms that share a wall share that coordinate.
- `source_ref.region_norm` is `[x0, y0, x1, y1]` normalized 0..1 **on the sheet image** (x to the right, y downward, over the whole image).

## layout
```
layout
  floors[]     { floor:int, label, elevation_m, height_m (3.0), sheet_id }
  spaces[]     { id, type, label, floor:int, bbox_m, source_ref, layout_status, review_note? }
  openings[]   { id, kind, floor:int, connects:[idA, idB], pos_m:[x,y], fire_rated:bool, source_ref, layout_status, review_note? }
  verticals[]  { id, kind:"stair"|"elevator", label, floors_connected:int[],
                 stops:[{ floor, bbox_m, opening_id, space_id }], source_ref, layout_status, review_note? }
  entrances[]  { id, label, floor, street_label, connects_to_space_id, pos_m:[x,y], access_confirmed:bool,
                 source_ref, layout_status, review_note? }
```
- `type` (spaces): `apartment`, `hall` (corridors, passages), `lobby` (lobbies, vestibules), `utility` (mech, boiler, trash, refuse), `room`, `other`. Do not add stair or elevator shafts as spaces; they are `verticals`, and each stop's `bbox_m` is the shaft footprint on that floor.
- `kind` (openings): `door`, `fire_door` (stair doors), `open_passage` (a gap in a wall with no door leaf), `elevator_door`, `other`.
- A stair or elevator door is an opening whose `connects` is `[<vertical id>, <space id>]`; the stop's `opening_id` points to it and `space_id` is the space the door opens into.
- `source_ref`: `{ "sheet": "A-4", "region_norm": [..], "callout": "<text printed on the sheet, if any>" }`.

## layout_status (exactly one of)
- `verified_on_plan`: you read it clearly on the sheet.
- `drafted_awaiting_review`: you drew it but the sheet is unclear or contradicts itself (for example an annotation that points somewhere the geometry doesn't, or a reference to a note that doesn't exist). Always add `review_note` saying what is unclear.
- `not_in_plan`: never used by sheet readers.

## Id conventions (so slices from different sheets join up)
- Spaces: `f<floor>-<slug of label>`, e.g. `f2-main-lobby`, `f1-boiler-rm`. Apartments: `f<floor>-apt-<unit>`, e.g. `f2-apt-2a`.
- Verticals: `stair-<letter>` (e.g. `stair-x`), `elevator-<name>` (e.g. `elevator-e1`). Same id on every sheet.
- Stair/elevator doors: `door-f<floor>-<vertical id>`, e.g. `door-f2-stair-x`.
- Other openings: `o<floor>-<short-a>-<short-b>`, unique.
- Entrances: `ent-<slug>`, e.g. `ent-front`, `ent-rear-alley`.
- Every id is unique across the whole model.

## Small example (one space, one stair stop)
```json
{
  "floors": [{"floor": 2, "label": "Floor 2", "elevation_m": 3.0, "height_m": 3.0, "sheet_id": "X-2"}],
  "spaces": [{"id": "f2-north-corridor", "type": "hall", "label": "NORTH CORRIDOR", "floor": 2,
              "bbox_m": [14.0, 6.0, 21.5, 8.0],
              "source_ref": {"sheet": "X-2", "region_norm": [0.48, 0.48, 0.71, 0.57], "callout": "NORTH CORRIDOR"},
              "layout_status": "verified_on_plan"}],
  "openings": [{"id": "door-f2-stair-x", "kind": "fire_door", "floor": 2, "connects": ["stair-x", "f2-north-corridor"],
                "pos_m": [16.0, 8.0], "fire_rated": true,
                "source_ref": {"sheet": "X-2", "region_norm": [0.55, 0.45, 0.58, 0.49], "callout": "X"},
                "layout_status": "verified_on_plan"}],
  "verticals": [{"id": "stair-x", "kind": "stair", "label": "STAIR X", "floors_connected": [2],
                 "stops": [{"floor": 2, "bbox_m": [15.0, 8.0, 17.0, 11.0], "opening_id": "door-f2-stair-x", "space_id": "f2-north-corridor"}],
                 "source_ref": {"sheet": "X-2", "region_norm": [0.51, 0.30, 0.57, 0.45], "callout": "X"},
                 "layout_status": "verified_on_plan"}],
  "entrances": []
}
```
(The example is illustrative only; it is not this building.)
