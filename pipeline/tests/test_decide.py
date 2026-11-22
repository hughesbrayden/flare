"""Offline tests for pipeline/decide.py (Decisions API). Mocked transport; writes only to a temp dir."""
import json
import os
import tempfile
import unittest

from pipeline import config, decide

LAYOUT = {
    "spaces": [
        {"id": "f9-apt-9x", "label": "9X", "floor": 9, "type": "apartment"},
        {"id": "f9-hall", "label": "HALL", "floor": 9, "type": "hall"},
    ]
}


def _answer(probs):
    top = max(probs, key=probs.get)
    return {"type": "choice", "choice": top, "probabilities": probs, "confidence": probs[top]}


def fake_post(target_p=0.95):
    calls = []

    def post(url, body, key):
        calls.append((url, body, key))
        return {
            "answers": {
                "target": _answer({"f9-apt-9x": target_p, "f9-hall": round(1 - target_p, 4)}),
                "condition": _answer({"f9-apt-9x": 0.05, "f9-hall": 0.9, "none": 0.05}),
                "kind": _answer({"smoke": 0.97, "fire": 0.01, "blocked": 0.01, "clear": 0.005, "other": 0.005}),
            },
            "usage": {"total_input_tokens": 120, "total_output_tokens": 0, "total_tokens": 120},
        }

    post.calls = calls
    return post


class DecideTests(unittest.TestCase):
    def test_request_matches_documented_shape(self):
        body = decide.build_request(LAYOUT, "smoke in 9X")
        self.assertEqual(body["model"], "gemini-decision-1")
        self.assertEqual(body["input"][0]["type"], "text")
        self.assertEqual(set(body["questions"]), {"target", "condition", "kind"})
        for q in body["questions"].values():
            self.assertEqual(q["type"], "choice")
            self.assertIsInstance(q["criteria"], dict)
            self.assertTrue(2 <= len(q["criteria"]) <= 255)
        self.assertIn("none", body["questions"]["condition"]["criteria"])
        self.assertNotIn("none", body["questions"]["target"]["criteria"])

    def test_confident_mapping_is_applied(self):
        post = fake_post(0.95)
        rec = decide.decide(LAYOUT, "smoke in 9X hall", post=post, key="test-key")
        self.assertEqual(len(post.calls), 1, "all three questions go in one request")
        self.assertIsNone(rec["error"])
        self.assertFalse(rec["needs_confirmation"])
        self.assertEqual(rec["applied"]["target_space_id"], "f9-apt-9x")
        self.assertEqual(rec["applied"]["report"], {"space_id": "f9-hall", "kind": "smoke"})
        self.assertEqual(rec["answers"]["target"]["probability"], 0.95)
        self.assertNotIn("test-key", json.dumps(rec))

    def test_low_confidence_needs_confirmation_and_is_not_applied(self):
        rec = decide.decide(LAYOUT, "smoke somewhere", post=fake_post(0.55), key="test-key", threshold=0.7)
        self.assertTrue(rec["needs_confirmation"])
        self.assertEqual(rec["low_confidence"], ["target"])
        self.assertIsNone(rec["applied"])

    def test_api_error_is_reported_not_faked(self):
        rec = decide.decide(LAYOUT, "x", post=lambda u, b, k: {"error": {"code": 400, "message": "bad"}}, key="k")
        self.assertIsNotNone(rec["error"])
        self.assertNotIn("answers", rec)

    def test_run_demo_writes_only_where_told(self):
        before = set(os.listdir(config.EVAL_DIR))
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "decisions_run.json")
            out = decide.run_demo(LAYOUT, path, post=fake_post(), key="k")
            self.assertTrue(os.path.exists(path))
            self.assertEqual(out["status"], "completed")
            self.assertEqual(len(out["calls"]), len(decide.DEMO_TEXTS))
        self.assertEqual(set(os.listdir(config.EVAL_DIR)), before)


if __name__ == "__main__":
    unittest.main()
