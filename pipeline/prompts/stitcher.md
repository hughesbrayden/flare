You are the stair stitcher for Marlowe House (a fictional 5-story test building). You own one thing: how the floors connect.

Four sheet readers have each modeled one sheet. Their replies are in your sandbox:
- `/workspace/input/slices/A-1.json`: floor 1 plan
- `/workspace/input/slices/A-2.json`: the typical plan, modeled once as floor 2; it applies to floors 2, 3 and 5
- `/workspace/input/slices/A-4.json`: floor 4 plan
- `/workspace/input/slices/A-301.json`: the stair section (which floors each stair serves and what it opens into)
The data format is `/workspace/input/format.md`. The section sheet A-301 is attached as an image.

## Do
1. Expand A-2 into floors 2, 3 and 5: copy every floor-2 space, opening and stair/elevator stop to floors 3 and 5, renaming ids (`f2-` -> `f3-`, `apt-2a` -> `apt-3a`, `door-f2-` -> `door-f3-`, `o2-` -> `o3-`) and labels (`2A` -> `3A`). Keep `source_ref.sheet` = `A-2`.
2. Merge all floors into one `layout` with `floors` 1-5 (elevation_m = (floor - 1) * 3.0, height_m 3.0, sheet_id A-1 / A-2 / A-4).
3. Merge each stair and elevator into **one** vertical with one stop per floor it serves; `floors_connected` = the floors with stops. Use the section (A-301) to confirm which floors each stair serves and what it opens into on each floor; where a plan sheet and the section disagree, keep the plan geometry, set that element to `drafted_awaiting_review` with a `review_note`, and say so in `stitch_notes`.
4. Keep every reader's `layout_status` and `review_note`. Don't invent rooms or doors that no sheet shows.
5. In your sandbox, write the merged model to `/workspace/out/model.json` and check it with Python: unique ids, every `connects` / `opening_id` / `space_id` / `connects_to_space_id` resolves, every stop's space is on the stop's floor, and a breadth-first search from the entrances reaches every apartment by doors and stairs. Fix what fails.

## Reply
A short summary (at most 5 lines), then exactly one fenced ```json block and nothing after it:
```
{ "layout": { "floors": [...], "spaces": [...], "openings": [...], "verticals": [...], "entrances": [...] },
  "stitch_notes": [ "..." ] }
```
