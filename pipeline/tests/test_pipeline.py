"""Unit tests and prompt leak guard for the Track B pipeline.

Every test writes strictly to a temporary directory, never to eval/.
"""
import copy
import json
import os
import re
import tempfile
import unittest

from pipeline import config, fast_mode, orchestrator, schema, scorer, stitch
from pipeline.agent_client import MockClient


FORBIDDEN_PROMPT_PATTERNS = [
    r"f4-east-lobby",
    r"stair-a\b",
    r"door-f4-stair-c",
    r"\b142\s*(?:-\s*144\s*)?marlowe",
    r"\b144\s*marlowe",
    r"note\s*7\b",
    r"f4-apt-4c",
    r"f4-west-corr",
    r"f4-ne-hall",
    r"east\s+lobby",
    r"ent-142",
    r"ent-144",
]


class TrackBPipelineTests(unittest.TestCase):
    def test_prompts_have_no_marlowe_leaks(self):
        """Leak guard: fail if any prompt file contains Marlowe-specific IDs or trap answers."""
        hits = []
        for fname in sorted(os.listdir(config.PROMPTS_DIR)):
            fpath = os.path.join(config.PROMPTS_DIR, fname)
            if not os.path.isfile(fpath):
                continue
            text = open(fpath, encoding="utf-8").read()
            for pat in FORBIDDEN_PROMPT_PATTERNS:
                m = re.search(pat, text, flags=re.IGNORECASE)
                if m:
                    hits.append(f"{fname}: matched /{pat}/ -> {m.group(0)!r}")
        self.assertEqual(hits, [], "Marlowe leak(s) found in prompts:\n" + "\n".join(hits))

    def test_normalize_layout_adds_callout(self):
        layout = {
            "spaces": [],
            "openings": [
                {"id": "o1", "source_ref": {"sheet": "A-1", "region_norm": [0, 0, 1, 1]}}
            ],
            "verticals": [],
            "entrances": [],
        }
        schema.normalize_layout(layout)
        self.assertEqual(layout["openings"][0]["source_ref"]["callout"], "")

    def test_scorer_penalizes_extra_spaces(self):
        truth = scorer.load_truth()
        perfect = scorer.score(truth, truth)
        self.assertEqual(perfect["spaces_f1"], 1.0)
        self.assertEqual(perfect["connections_f1"], 1.0)
        self.assertEqual(perfect["overall"], 1.0)

        with_extra = copy.deepcopy(truth)
        with_extra["spaces"].append(
            {
                "id": "f1-extra-void",
                "type": "utility",
                "label": "VOID",
                "floor": 1,
                "bbox_m": [10.0, 0.0, 14.0, 2.0],
                "source_ref": {"sheet": "A-1", "region_norm": [0.3, 0.6, 0.4, 0.7], "callout": ""},
                "layout_status": "drafted_awaiting_review",
                "review_note": "Extra unlabeled void",
            }
        )
        scored = scorer.score(with_extra, truth)
        self.assertLess(scored["spaces_precision"], 1.0)
        self.assertLess(scored["spaces_f1"], 1.0)
        self.assertLess(scored["overall"], 1.0)

    def test_apply_ambiguities_ignores_related_ids(self):
        layout = {
            "spaces": [
                {"id": "sp-lobby", "layout_status": "verified_on_plan"},
            ],
            "verticals": [
                {"id": "stair-x", "layout_status": "verified_on_plan"},
            ],
            "openings": [],
            "entrances": [],
        }
        finding = {
            "check": "contradictory_callout",
            "severity": "ambiguity",
            "element_ids": ["stair-x"],
            "related_ids": ["sp-lobby"],
            "message": "Callout contradicts door swing.",
        }
        orchestrator.apply_ambiguities(layout, [finding])
        self.assertEqual(layout["verticals"][0]["layout_status"], "drafted_awaiting_review")
        self.assertEqual(layout["spaces"][0]["layout_status"], "verified_on_plan")

    def test_has_valid_evidence_guard(self):
        self.assertTrue(orchestrator._has_valid_evidence({"source": "deterministic"}))
        self.assertTrue(
            orchestrator._has_valid_evidence(
                {"source": "visual", "evidence": {"sheet": "A-4", "region_norm": [0.1, 0.2, 0.3, 0.4]}}
            )
        )
        self.assertFalse(orchestrator._has_valid_evidence({"source": "visual"}))
        self.assertFalse(
            orchestrator._has_valid_evidence(
                {"source": "visual", "evidence": {"sheet": "", "region_norm": [0.1, 0.2, 0.3, 0.4]}}
            )
        )

    def test_mock_pipeline_in_temp_dir_never_touches_eval(self):
        live_run = os.path.join(config.EVAL_DIR, "run.json")
        before_mtime = os.path.getmtime(live_run) if os.path.exists(live_run) else None

        with tempfile.TemporaryDirectory() as tmp:
            client = MockClient(seed=11)
            oat = orchestrator.one_agent_test(client, tmp)
            self.assertTrue(oat["ok"])
            res = orchestrator.full_pipeline(client, tmp)
            self.assertEqual(res["status"], "completed")
            self.assertIn("one_agent_test", res)
            self.assertIn("spaces_f1", res["accuracy"]["summary"])
            self.assertIn("connections_f1", res["accuracy"]["summary"])
            self.assertTrue(os.path.exists(os.path.join(tmp, "run.json")))
            self.assertTrue(os.path.exists(os.path.join(tmp, "model.json")))

        if before_mtime is not None:
            self.assertEqual(os.path.getmtime(live_run), before_mtime)

    def test_stitch_preserves_floor4_vertical_drafted_status_and_normalizes_callout(self):
        slices = {
            "A-1": {
                "sheet": "A-1",
                "layout": {
                    "floors": [{"floor": 1, "label": "Floor 1", "elevation_m": 0.0, "height_m": 3.0, "sheet_id": "A-1"}],
                    "spaces": [
                        {"id": "f1-hall", "type": "hall", "label": "HALL", "floor": 1, "bbox_m": [0, 0, 10, 5],
                         "source_ref": {"sheet": "A-1", "region_norm": [0, 0, 1, 1]}, "layout_status": "verified_on_plan"}
                    ],
                    "openings": [],
                    "verticals": [
                        {"id": "stair-x", "kind": "stair", "label": "STAIR X", "floors_connected": [1],
                         "stops": [{"floor": 1, "bbox_m": [10, 9, 12, 12], "opening_id": "door-f1-stair-x", "space_id": "f1-hall"}],
                         "source_ref": {"sheet": "A-1", "region_norm": [0, 0, 1, 1]}, "layout_status": "verified_on_plan"}
                    ],
                    "entrances": [],
                },
            },
            "A-4": {
                "sheet": "A-4",
                "layout": {
                    "floors": [{"floor": 4, "label": "Floor 4", "elevation_m": 9.0, "height_m": 3.0, "sheet_id": "A-4"}],
                    "spaces": [
                        {"id": "f4-lobby", "type": "lobby", "label": "LOBBY", "floor": 4, "bbox_m": [10, 5, 14, 9],
                         "source_ref": {"sheet": "A-4", "region_norm": [0, 0, 1, 1]}, "layout_status": "verified_on_plan"}
                    ],
                    "openings": [],
                    "verticals": [
                        {"id": "stair-x", "kind": "stair", "label": "STAIR X", "floors_connected": [4],
                         "stops": [{"floor": 4, "bbox_m": [10, 9, 12, 12], "opening_id": "door-f4-stair-x", "space_id": "f4-lobby"}],
                         "source_ref": {"sheet": "A-4", "region_norm": [0, 0, 1, 1]},
                         "layout_status": "drafted_awaiting_review",
                         "review_note": "Contradictory callout on floor 4."}
                    ],
                    "entrances": [],
                },
            },
            "A-301": {"sheet": "A-301", "layout": {"floors": [], "spaces": [], "openings": [], "verticals": [], "entrances": []}, "section": []},
        }
        layout, _ = stitch.stitch(slices)
        vert = layout["verticals"][0]
        self.assertEqual(vert["layout_status"], "drafted_awaiting_review")
        self.assertIn("Contradictory callout", vert.get("review_note", ""))
        self.assertEqual(vert["floors_connected"], [1, 4])
        self.assertEqual(layout["spaces"][0]["source_ref"]["callout"], "")

    def test_fast_pipeline_mock_in_temp_dir_never_touches_eval(self):
        live_run = os.path.join(config.EVAL_DIR, "run.json")
        before_mtime = os.path.getmtime(live_run) if os.path.exists(live_run) else None

        with tempfile.TemporaryDirectory() as tmp:
            client = MockClient(seed=13)
            res = fast_mode.fast_pipeline(client, tmp)
            self.assertEqual(res["status"], "completed")
            self.assertIn("time_to_model_s", res)
            self.assertIn("time_to_checker_s", res)
            self.assertIn("dispatch_call", res)
            self.assertEqual(res["dispatch_call"]["result"]["target_space_id"], "f4-apt-4c")
            self.assertTrue(os.path.exists(os.path.join(tmp, "fast_run.json")))
            self.assertTrue(os.path.exists(os.path.join(tmp, "fast_model.json")))
            self.assertFalse(os.path.exists(os.path.join(tmp, "run.json")))

        if before_mtime is not None:
            self.assertEqual(os.path.getmtime(live_run), before_mtime)


if __name__ == "__main__":
    unittest.main()
