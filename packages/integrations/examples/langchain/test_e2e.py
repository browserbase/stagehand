from __future__ import annotations

import unittest

from e2e import StagehandLangChainResultError, successful_result


class SuccessfulResultTest(unittest.TestCase):
    def test_accepts_successful_structured_result(self) -> None:
        self.assertEqual(
            successful_result(
                {"structuredContent": {"ok": True, "value": {"title": "Example"}}}
            ),
            {"title": "Example"},
        )

    def test_rejects_invalid_json_without_reflecting_payload(self) -> None:
        secret = "invalid-json-secret-do-not-reflect"
        with self.assertRaises(StagehandLangChainResultError) as raised:
            successful_result(secret)
        self.assertNotIn(secret, str(raised.exception))

    def test_rejects_failed_result_without_reflecting_payload(self) -> None:
        secret = "failure-secret-do-not-reflect"
        with self.assertRaises(StagehandLangChainResultError) as raised:
            successful_result({"ok": False, "error": secret})
        self.assertNotIn(secret, str(raised.exception))

    def test_rejects_non_object_value(self) -> None:
        with self.assertRaises(StagehandLangChainResultError):
            successful_result({"ok": True, "value": ["unexpected"]})


if __name__ == "__main__":
    unittest.main()
