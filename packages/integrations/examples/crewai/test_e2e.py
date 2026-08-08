from __future__ import annotations

import json
import unittest

from e2e import StagehandCrewAIResultError, successful_result


class SuccessfulResultTest(unittest.TestCase):
    def test_accepts_successful_object_value(self) -> None:
        value = {"title": "Example Domain"}
        self.assertEqual(
            successful_result(json.dumps({"ok": True, "value": value})), value
        )

    def test_rejects_invalid_json_without_reflecting_it(self) -> None:
        secret = "not-json-do-not-reflect"
        with self.assertRaises(StagehandCrewAIResultError) as raised:
            successful_result(secret)
        self.assertNotIn(secret, str(raised.exception))

    def test_rejects_failed_result_without_reflecting_it(self) -> None:
        secret = "remote-error-do-not-reflect"
        with self.assertRaises(StagehandCrewAIResultError) as raised:
            successful_result(json.dumps({"ok": False, "error": secret}))
        self.assertNotIn(secret, str(raised.exception))

    def test_rejects_non_object_value(self) -> None:
        with self.assertRaises(StagehandCrewAIResultError):
            successful_result(json.dumps({"ok": True, "value": ["unexpected"]}))


if __name__ == "__main__":
    unittest.main()
