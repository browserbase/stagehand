import copy
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("rubric_clarify", HERE / "rubric-clarify.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ClarifierTests(unittest.TestCase):
    def test_frozen_corpus_is_idempotent_and_nonrubric_fields_never_change(self):
        rows = [json.loads(line) for line in (HERE / "../../datasets/hardbenchmark/HardBenchmark_data.jsonl").resolve().read_text().splitlines()]
        before = copy.deepcopy(rows)
        updated = module.clarify_rows(rows)
        self.assertEqual(rows, before)
        self.assertEqual(updated, rows)
        self.assertEqual(module.clarify_rows(updated), updated)

    def test_adds_rules_once_and_preserves_question_validity_and_provenance(self):
        row = {"id": "example", "ques": "Create a table.", "valid": False, "invalid_reason": "manual", "parent": "family", "precomputed_rubric": {"items": [{"criterion": "Table", "description": "Return a table with required fields.", "maxPoints": 2}]}}
        updated = module.clarify_rows([row])[0]
        self.assertEqual(updated["rubric_version"], "1.2")
        self.assertEqual(updated["clarifications"], ["table-format"])
        for key in ["ques", "valid", "invalid_reason", "parent"]:
            self.assertEqual(updated[key], row[key])
        self.assertEqual(module.clarify_rows([updated]), [updated])
        self.assertNotIn("rubric_version", row)

    def test_rejects_duplicate_ids_and_malformed_rubrics(self):
        row = {"id": "x", "ques": "Task", "precomputed_rubric": {"items": [{"criterion": "Do", "description": "Do it", "maxPoints": 1}]}}
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            module.clarify_rows([row, row])
        with self.assertRaisesRegex(ValueError, "Missing rubric"):
            module.clarify_rows([{**row, "precomputed_rubric": None}])
        with self.assertRaisesRegex(ValueError, "Malformed"):
            module.clarify_rows([{**row, "precomputed_rubric": {"items": [None]}}])


if __name__ == "__main__":
    unittest.main()
