"""Offline tests for the investigator agents (mock agent only).

Every test writes to a temporary directory, never to eval/ or logs/.
"""
import copy
import json
import os
import tempfile
import unittest

from pipeline import config, investigate as inv

DRAFTED = inv.DRAFTED


def _model():
    layout = {
        "floors": [{"floor": 1}],
        "spaces": [
            {"id": "sp-a", "label": "ROOM A", "floor": 1, "bbox_m": [0, 0, 2, 2],
             "source_ref": {"sheet": "A-1", "region_norm": [0.1, 0.1, 0.2, 0.2], "callout": "ROOM A"},
             "layout_status": "verified_on_plan"},
            {"id": "sp-b", "label": "ROOM B", "floor": 1, "bbox_m": [2, 0, 4, 2],
             "source_ref": {"sheet": "A-1", "region_norm": [0.3, 0.1, 0.4, 0.2], "callout": "ROOM B"},
             "layout_status": DRAFTED, "review_note": "Room B has no door drawn. | second note"},
            {"id": "sp-c", "label": "ROOM C", "floor": 2, "bbox_m": [2, 0, 4, 2],
             "source_ref": {"sheet": "A-2", "region_norm": [0.3, 0.1, 0.4, 0.2], "callout": "ROOM C"},
             "layout_status": DRAFTED, "review_note": "Room C has no door drawn."},
        ],
        "openings": [
            {"id": "door-x", "kind": "fire_door", "fire_rated": True, "floor": 1, "connects": ["sp-a", "sp-b"],
             "pos_m": [2, 1], "source_ref": {"sheet": "A-4", "region_norm": [0.5, 0.5, 0.6, 0.6], "callout": "SEE NOTE 12"},
             "layout_status": DRAFTED, "review_note": "Callout cites note 12, not listed on this sheet."},
        ],
        "verticals": [], "entrances": [],
    }
    return {"schema_version": "1.0", "layout": layout, "conditions": []}


def _run():
    return {"checker_catches": [
        {"severity": "ambiguity", "finding": {
            "check": "missing_referenced_note", "severity": "ambiguity", "element_ids": ["door-x"],
            "message": "Callout 'SEE NOTE 12' on A-4 cites a note A-4 does not list.",
            "suggested_fix": "Probably note 12 from A-1 ('ALL HATCHES ARE LOCKED AT NIGHT') applies."}},
        {"severity": "error", "finding": {"check": "x", "severity": "error", "element_ids": ["sp-a"], "message": "m"}},
    ]}


class InvestigatorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.model_path = os.path.join(self.tmp.name, "model.json")
        self.run_path = os.path.join(self.tmp.name, "run.json")
        json.dump(_model(), open(self.model_path, "w", encoding="utf-8"))
        json.dump(_run(), open(self.run_path, "w", encoding="utf-8"))
        self.out = os.path.join(self.tmp.name, "investigations.json")
        self.logs = os.path.join(self.tmp.name, "logs")

    def tearDown(self):
        self.tmp.cleanup()

    def _go(self, client):
        return inv.run_investigations(client, self.model_path, self.run_path, self.out, self.logs)

    def test_collect_flags_from_checker_and_model(self):
        flags = inv.collect_flags(_model(), _run())
        self.assertEqual([f["element_ids"] for f in flags], [["door-x"], ["sp-b"], ["sp-c"]])
        self.assertEqual(flags[0]["source"], "checker")
        self.assertEqual(flags[1]["flag_text"], "Room B has no door drawn.")   # first note only
        self.assertTrue(all(set(f["layout_status_before"].values()) == {DRAFTED} for f in flags))

    def test_prompt_is_neutral(self):
        model, run = _model(), _run()
        for fl in inv.collect_flags(model, run):
            prompt, _ = inv.build_prompt(fl, model["layout"])
            self.assertNotIn("HATCHES", prompt)             # the proposed answer never reaches the agent
            self.assertNotIn("Probably", prompt)
            self.assertNotIn("review_note", prompt)
            self.assertNotIn("fire_rated", prompt)
            self.assertTrue(inv.check_neutral(prompt, run, model))
        with self.assertRaises(ValueError):
            inv.check_neutral("text with all hatches are locked at night inside", run, model)

    def test_prompts_from_real_flags_are_neutral(self):
        model = json.load(open(os.path.join(config.EVAL_DIR, "model.json"), encoding="utf-8"))
        rp = os.path.join(config.EVAL_DIR, "run.json")
        run = json.load(open(rp, encoding="utf-8")) if os.path.exists(rp) else None
        flags = inv.collect_flags(model, run)
        self.assertGreater(len(flags), 0)
        for fl in flags:
            prompt, _ = inv.build_prompt(fl, model["layout"])
            inv.check_neutral(prompt, run, model)
            for c in (run or {}).get("checker_catches", []):
                fix = (c.get("finding") or {}).get("suggested_fix") or ""
                if fix:
                    self.assertNotIn(fix, prompt)

    def test_validate_reply(self):
        fl = inv.collect_flags(_model(), _run())[0]
        good = {"element_id": "door-x", "question": "q?", "probable_meaning": "p",
                "evidence": [{"sheet": "A-1", "region_norm": [0.1, 0.1, 0.2, 0.2], "quote": "12. TEXT"}],
                "confidence": "medium", "keep_status": DRAFTED}
        self.assertEqual(inv.validate_reply(good, fl), [])
        for mutate in (lambda o: o.update(keep_status="verified_on_plan"),
                       lambda o: o.update(layout_status="verified_on_plan"),
                       lambda o: o.update(element_id="sp-a"),
                       lambda o: o.update(confidence="certain"),
                       lambda o: o.update(evidence=[]),
                       lambda o: o["evidence"][0].update(sheet="Z-9"),
                       lambda o: o["evidence"][0].update(region_norm=[0.5, 0.5, 0.1, 0.1]),
                       lambda o: o["evidence"][0].update(quote="")):
            bad = copy.deepcopy(good); mutate(bad)
            self.assertNotEqual(inv.validate_reply(bad, fl), [], bad)

    def test_mock_run_in_parallel_writes_temp_only_and_keeps_status(self):
        eval_out = os.path.join(config.EVAL_DIR, "investigations.json")
        eval_mtime = os.path.getmtime(eval_out) if os.path.exists(eval_out) else None
        model_mtime = os.path.getmtime(self.model_path)
        client = inv.MockInvestigatorClient()
        rec = self._go(client)
        self.assertEqual(rec["flags"], 3)
        self.assertEqual(rec["valid_replies"], 3)
        self.assertTrue(rec["mock"])
        self.assertEqual(len(client.tasks), 3)
        for t in client.tasks:
            self.assertEqual(len(t.images), len(config.SHEET_IDS))
            mounted = {p for p, _ in t.sources}
            for s in config.SHEET_IDS:
                self.assertIn(f"/workspace/input/sheets/{s}.png.b64", mounted)
        for r in rec["results"]:
            self.assertEqual(r["reply"]["keep_status"], DRAFTED)
            self.assertEqual(r["layout_status_after"], r["layout_status_before"])
        self.assertTrue(os.path.exists(self.out))
        self.assertEqual(os.path.getmtime(self.model_path), model_mtime)
        self.assertEqual(json.load(open(self.model_path, encoding="utf-8")), _model())
        if eval_mtime is not None:
            self.assertEqual(os.path.getmtime(eval_out), eval_mtime)

    def test_bad_json_is_retried_once(self):
        rec = self._go(inv.MockInvestigatorClient(bad_first={"sp-b"}))
        r = next(r for r in rec["results"] if r["element_ids"] == ["sp-b"])
        self.assertTrue(r["valid"]); self.assertEqual(r["turns"], 2)

    def test_status_change_attempt_is_rejected(self):
        rec = self._go(inv.MockInvestigatorClient(status_grab={"door-x"}))
        r = next(r for r in rec["results"] if r["element_ids"] == ["door-x"])
        self.assertFalse(r["valid"]); self.assertIsNone(r["reply"])
        self.assertEqual(r["layout_status_after"], {"door-x": DRAFTED})
        self.assertEqual(rec["valid_replies"], 2)

    def test_attach_evidence_never_changes_status(self):
        model = _model()
        res = [{"flag_id": "f1", "element_ids": ["door-x"], "valid": True,
                "reply": {"probable_meaning": "p", "confidence": "low", "evidence": []}}]
        out = inv.attach_evidence(model, res)
        _, el = inv.find_element(out["layout"], "door-x")
        self.assertEqual(el["layout_status"], DRAFTED)
        self.assertEqual(len(el["investigation"]), 1)
        self.assertEqual(model, _model())   # input untouched
        with self.assertRaises(AssertionError):
            inv.assert_status_unchanged({"a": DRAFTED}, {"a": "verified_on_plan"})


if __name__ == "__main__":
    unittest.main()
