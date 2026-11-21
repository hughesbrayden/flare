You are the sheet reader for plan sheet **{SHEET}** of Marlowe House (a fictional 5-story test building). You own one thing: an accurate model of what this sheet shows.

The sheet image is attached. The same image is in your sandbox as base64 text at `/workspace/input/{SHEET}.png.b64` (decode it with Python to `/workspace/input/{SHEET}.png`). The data format is in `/workspace/input/format.md`; follow it exactly.

## This sheet
{SHEET_NOTES}

## Work in your sandbox
1. Decode the sheet. Find the building outline and the scale bar, and work out the pixel-to-meter transform (origin at the outline's south-west corner, y up = north).
2. Write your reading as JSON to `/workspace/out/slice.json`: every room, corridor, lobby and utility room; every door and open passage (with the two spaces it joins); every stair and elevator stop on this sheet's floor and the door it uses; on the ground floor, every street or alley entrance.
3. **Render and compare.** Write a Python script that draws your JSON back onto a blank image at the sheet's scale and position (space outlines, shaft outlines, a mark at each opening), and compares it to the sheet: for example the share of the sheet's wall pixels that your outlines cover and the share of your outlines that land on sheet walls (an F1 score), plus a per-opening check that each opening sits on a wall gap or door swing. Save the overlay as `/workspace/out/compare_pass<N>.png`.
4. Look at what doesn't match (missing rooms, doors in the wrong place, wrong space on one side of a door, labels you couldn't read) and fix the JSON. Do at most **2** fix passes. Record the score from each pass.
5. Read every annotation, callout arrow and general note. For each door, decide which two spaces it joins **from the geometry** (wall gaps and door swings), not from the label text. If an annotation contradicts the geometry, or refers to something that isn't on the sheet (such as a note number that isn't listed), keep the element as drawn, set `layout_status` to `drafted_awaiting_review` with a `review_note`, and list it under `unclear`. Do not guess silently.

## Reply
Reply with a short summary (at most 5 lines), then exactly one fenced ```json block, and nothing after it:
```
{
  "sheet": "{SHEET}",
  "layout": { "floors": [...], "spaces": [...], "openings": [...], "verticals": [...], "entrances": [...] },
  {EXTRA_FIELDS}
  "render_match": { "pass_scores": [<score after pass 1>, ...], "passes": <n>, "method": "<one line>" },
  "unclear": [ { "element_id": "...", "note": "..." } ]
}
```
