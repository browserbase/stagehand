import json
import tempfile
import unittest
from pathlib import Path

from main import Book, Checkpoint, SavedPage, atomic_json
from pydantic import ValidationError


class CheckpointTests(unittest.TestCase):
    def test_atomic_recovery_and_validation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            state = Checkpoint(
                source="https://catalog.test/",
                pages=[
                    SavedPage(
                        url="https://catalog.test/1",
                        books=[Book(title=" Book ", price="1", availability="yes")],
                    )
                ],
            )
            atomic_json(path, state.model_dump())
            recovered = Checkpoint.model_validate_json(path.read_text())
            self.assertEqual(recovered.pages[0].books[0].title, "Book")
            self.assertFalse(recovered.complete)
            recovered.complete = True
            atomic_json(path, recovered.model_dump())
            self.assertTrue(json.loads(path.read_text())["complete"])
            self.assertFalse(path.with_suffix(".json.tmp").exists())
        for payload in [
            dict(title=" ", price="1", availability="yes"),
            dict(title="Book", price="", availability="yes"),
        ]:
            with self.assertRaises(ValidationError):
                Book(**payload)
        with self.assertRaises(ValidationError):
            Checkpoint(version=2, source="https://catalog.test/")


if __name__ == "__main__":
    unittest.main()
