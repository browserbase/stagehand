import copy
import importlib.util
import json
from pathlib import Path
import unittest
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("rubric_clarify", HERE / "rubric-clarify.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ClarifierTests(unittest.TestCase):
    def test_corpus_transform_is_idempotent_and_nonrubric_fields_never_change(self):
        rows = [json.loads(line) for line in (HERE / "../../datasets/hardbenchmark/HardBenchmark_data.jsonl").resolve().read_text().splitlines()]
        before = copy.deepcopy(rows)
        updated = module.clarify_rows(rows)
        self.assertEqual(rows, before)
        for original, clarified in zip(rows, updated):
            for key in original.keys() - {"precomputed_rubric", "rubric_version", "clarifications"}:
                self.assertEqual(original[key], clarified[key])
        self.assertEqual(module.clarify_rows(updated), updated)

    def test_adds_rules_once_and_preserves_question_and_tier(self):
        row = {"id": "example", "ques": "Create a table.", "set": "holdout", "slug": "example-task", "precomputed_rubric": {"items": [{"criterion": "Table", "description": "Return a table with required fields.", "maxPoints": 2}]}}
        updated = module.clarify_rows([row])[0]
        self.assertEqual(updated["rubric_version"], "1.2")
        self.assertEqual(updated["clarifications"], ["table-format"])
        for key in ["ques", "set", "slug"]:
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


    def test_relative_day_and_month_forms_receive_the_date_convention_once(self):
        for phrase in ["next month", "next day", "following day"]:
            with self.subTest(phrase=phrase):
                row = {"id": "date", "ques": "Find the event", "precomputed_rubric": {"items": [
                    {"criterion": "Match the date", "description": f"Find an event {phrase}.", "maxPoints": 1}
                ]}}
                updated = module.clarify_rows([row])
                self.assertIn("relative-dates", updated[0]["clarifications"])
                self.assertIn("Date convention:", updated[0]["precomputed_rubric"]["items"][0]["description"])
                self.assertEqual(module.clarify_rows(updated), updated)

    def test_cli_rejects_dataset_as_any_output_even_with_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.jsonl"
            original = json.dumps({"id": "x", "ques": "Task", "precomputed_rubric": {"items": [
                {"criterion": "Task", "description": "Complete it", "maxPoints": 1}
            ]}}) + "\n"
            source.write_text(original)
            alias = Path(directory) / "source-link.jsonl"
            alias.symlink_to(source)
            for options in [
                ["--out", str(source)],
                ["--out", str(alias)],
                ["--out", str(Path(directory) / "output.jsonl"), "--overrides", str(source)],
            ]:
                with self.subTest(options=options):
                    result = subprocess.run([
                        sys.executable, str(HERE / "rubric-clarify.py"),
                        "--dataset", str(source), "--overwrite", *options,
                    ], text=True, capture_output=True)
                    self.assertEqual(result.returncode, 2)
                    self.assertIn("Dataset and output paths must differ", result.stderr)
                    self.assertEqual(source.read_text(), original)
                    self.assertFalse((Path(directory) / "output.jsonl").exists())


if __name__ == "__main__":
    unittest.main()
