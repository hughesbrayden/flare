"""At-dispatch report mapping with the Gemini Decisions API (model gemini-decision-1).

One POST to /v1beta/decisions asks three closed-set questions about a dispatch text:
  target    which space is the target unit            (options: the model's spaces)
  condition where is the reported condition            (options: spaces + "none")
  kind      what kind of report is it                  (smoke / fire / blocked / clear / other)

Each answer carries a calibrated probability for its top option. If that probability is below
the threshold (default 0.7, env FLARE_DECISION_THRESHOLD), the mapping is marked
needs_confirmation and is not applied: Flare asks the officer instead of guessing (DECISIONS.md Y5).

The API key comes from agent_client.load_api_key (GEMINI_API_KEY, pipeline/.env or FLARE_ENV_FILE)
and is never printed, logged or written.
"""
import json
import os
import time

from .agent_client import Redactor, load_api_key, now_iso

DECISION_MODEL = os.environ.get("FLARE_DECISION_MODEL", "gemini-decision-1")
DECISIONS_URL = "https://generativelanguage.googleapis.com/v1beta/decisions"
THRESHOLD = float(os.environ.get("FLARE_DECISION_THRESHOLD", "0.7"))
NONE_OPTION = "none"
MAX_OPTIONS = 255

KIND_CRITERIA = {
    "smoke": "Smoke is reported (smoke showing, smoke condition, haze).",
    "fire": "Visible fire or flames are reported.",
    "blocked": "A door, stair, hall or route is blocked, jammed or impassable.",
    "clear": "A space or route is reported clear or passable.",
    "other": "Anything else, or no condition reported.",
}


def _space_criteria(layout):
    crit = {}
    for s in layout.get("spaces", []):
        name = s.get("label") or s["id"]
        if s.get("type") == "apartment":
            name = f"Apartment {name}"
        elif s.get("type"):
            name = f"{name} ({s['type']})"
        crit[s["id"]] = f"{name}, floor {s['floor']}" if s.get("floor") is not None else name
    if len(crit) + 1 > MAX_OPTIONS:
        raise ValueError(f"{len(crit)} spaces exceed the {MAX_OPTIONS}-option limit for a choice question")
    return crit


def build_request(layout, text):
    """Request body exactly as documented: model, input content blocks, questions map."""
    spaces = _space_criteria(layout)
    return {
        "model": DECISION_MODEL,
        "input": [{"type": "text", "text": f"Fire dispatch report:\n{text}"}],
        "questions": {
            "target": {
                "type": "choice",
                "instructions": "Which space in this building is the target unit the crew is dispatched to?",
                "criteria": spaces,
            },
            "condition": {
                "type": "choice",
                "instructions": (
                    "Where in this building is the reported condition (smoke, fire or blockage)? "
                    "If a condition is reported in a space other than the target unit, pick that other space. "
                    f"Pick '{NONE_OPTION}' if no location for a condition is mentioned."
                ),
                "criteria": {**spaces, NONE_OPTION: "No location for a condition is mentioned."},
            },
            "kind": {
                "type": "choice",
                "instructions": "What kind of report is this?",
                "criteria": KIND_CRITERIA,
            },
        },
    }


def parse_response(body, threshold=THRESHOLD):
    """Keep the top option and its probability per question; gate on the calibrated confidence."""
    if "error" in body and "answers" not in body:
        raise RuntimeError(f"Decisions API error: {body['error']}")
    answers = {}
    for key in ("target", "condition", "kind"):
        a = body["answers"][key]
        probs = a.get("probabilities") or {}
        top = a.get("choice")
        p = a.get("confidence", probs.get(top))
        ranked = sorted(probs.items(), key=lambda kv: -kv[1])[:3]
        answers[key] = {
            "choice": top,
            "probability": round(float(p), 4) if p is not None else None,
            "runner_up": [{"option": o, "probability": round(float(v), 4)} for o, v in ranked[1:3]],
            "needs_confirmation": p is None or float(p) < threshold,
        }
    needs = [k for k, v in answers.items() if v["needs_confirmation"]]
    return {
        "answers": answers,
        "needs_confirmation": bool(needs),
        "low_confidence": needs,
        # Only a fully confident mapping is applied; otherwise Flare asks the officer.
        "applied": None if needs else {
            "target_space_id": answers["target"]["choice"],
            "report": {
                "space_id": answers["condition"]["choice"],
                "kind": answers["kind"]["choice"],
            },
        },
        "usage": body.get("usage"),
    }


_SESSION = None


def _http_post(url, body, key, timeout=60):
    global _SESSION
    import requests
    _SESSION = _SESSION or requests.Session()  # reuse the TLS connection across calls
    r = _SESSION.post(
        url,
        headers={"x-goog-api-key": key, "Content-Type": "application/json"},
        data=json.dumps(body),
        timeout=timeout,
    )
    try:
        payload = r.json()
    except ValueError:
        payload = {"error": {"code": r.status_code, "message": r.text[:500]}}
    if r.status_code != 200 and "error" not in payload:
        payload = {"error": {"code": r.status_code, "message": str(payload)[:500]}}
    return payload


def decide(layout, text, threshold=THRESHOLD, post=None, key=None):
    """One Decisions API request for one dispatch text. `post(url, body, key)` is injectable for tests."""
    key = key or load_api_key()
    if not key:
        raise RuntimeError("No GEMINI_API_KEY in the environment, pipeline/.env or FLARE_ENV_FILE")
    redact = Redactor(key)
    body = build_request(layout, text)
    post = post or _http_post
    t0 = time.perf_counter()
    try:
        resp = post(DECISIONS_URL, body, key)
    except Exception as e:  # network errors; never let the key leak into the message
        return {"text": text, "model": DECISION_MODEL, "latency_ms": None, "error": redact(e)}
    latency_ms = round((time.perf_counter() - t0) * 1000)
    rec = {"text": text, "model": DECISION_MODEL, "threshold": threshold, "latency_ms": latency_ms, "at": now_iso()}
    try:
        rec.update(parse_response(resp, threshold))
        rec["error"] = None
    except (RuntimeError, KeyError, TypeError) as e:
        rec["error"] = redact(e)
    return rec


DEMO_TEXTS = [
    ("real", "Engine 7 respond 144 Marlowe St, smoke showing from apartment 4C, "
             "caller reports heavy smoke in the fourth floor east lobby."),
    ("clear", "Ladder 3 respond 144 Marlowe St, apartment 2B, kitchen fire, flames visible from the stove."),
    ("ambiguous", "Smoke on the fourth floor, can't tell which apartment."),
    ("blockage", "East lobby door jammed, can't get through."),
    ("radio", "Engine 7 to command, on scene, 4 Charlie, smoke condition in the public hall, fourth floor, east side."),
]


def run_demo(layout, out_path, texts=DEMO_TEXTS, threshold=THRESHOLD, post=None, key=None, baseline=None):
    """Run each demo text as its own request, write the record atomically, return it."""
    calls = []
    for label, text in texts:
        rec = decide(layout, text, threshold=threshold, post=post, key=key)
        rec["case"] = label
        calls.append(rec)
    ok = [c for c in calls if c.get("error") is None]
    lat = sorted(c["latency_ms"] for c in ok)
    out = {
        "model": DECISION_MODEL,
        "endpoint": DECISIONS_URL,
        "threshold": threshold,
        "started": calls[0].get("at") if calls else None,
        "status": "completed" if calls and len(ok) == len(calls) else "failed",
        "latency_ms": {
            "min": lat[0] if lat else None,
            "median": lat[len(lat) // 2] if lat else None,
            "max": lat[-1] if lat else None,
        },
        "baseline": baseline,
        "calls": calls,
    }
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    os.replace(tmp, out_path)
    return out
