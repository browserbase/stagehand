from __future__ import annotations

import io
import os
import subprocess
import unittest
from builtins import BaseExceptionGroup
from pathlib import Path
from unittest.mock import patch

import vercel_sandbox_lease as lease


class FakeProcess:
    def __init__(self, *, exit_code: int = 0, stderr: str = "") -> None:
        self.stdin = io.StringIO()
        self.stdout = io.StringIO(
            '{"url":"https://sandbox.example.vercel.run/mcp","token":"token"}\n'
        )
        self.stderr = io.StringIO(stderr)
        self.returncode: int | None = None
        self._exit_code = exit_code
        self.waited_after_stdin_closed = False

    def poll(self) -> int | None:
        return self.returncode

    def wait(self, timeout: float) -> int:
        del timeout
        self.waited_after_stdin_closed = self.stdin.closed
        self.returncode = self._exit_code
        return self._exit_code

    def terminate(self) -> None:
        self.returncode = -15

    def kill(self) -> None:
        self.returncode = -9


class StagehandSandboxLeaseTest(unittest.TestCase):
    def test_model_credentials_are_excluded_from_lease_environment(self) -> None:
        environment = {
            "PATH": "/usr/bin",
            "BROWSERBASE_API_KEY": "browserbase-secret",
            "VERCEL_OIDC_TOKEN": "vercel-token",
            "OPENAI_API_KEY": "model-secret",
            "ANTHROPIC_API_KEY": "other-model-secret",
        }
        with patch.dict(os.environ, environment, clear=True):
            child_environment = lease.lease_environment()

        self.assertEqual(child_environment["BROWSERBASE_API_KEY"], "browserbase-secret")
        self.assertEqual(child_environment["VERCEL_OIDC_TOKEN"], "vercel-token")
        self.assertNotIn("OPENAI_API_KEY", child_environment)
        self.assertNotIn("ANTHROPIC_API_KEY", child_environment)

    def test_context_returns_connection_then_closes_stdin_before_waiting(self) -> None:
        process = FakeProcess()
        with (
            patch.object(lease, "TSX_PATH", Path(__file__)),
            patch.object(lease, "LEASE_PATH", Path(__file__)),
            patch.object(subprocess, "Popen", return_value=process),
            lease.StagehandSandboxLease() as connection,
        ):
            self.assertEqual(connection.url, "https://sandbox.example.vercel.run/mcp")
            self.assertEqual(connection.token, "token")

        self.assertTrue(process.waited_after_stdin_closed)

    def test_cleanup_failure_preserves_primary_failure(self) -> None:
        process = FakeProcess(exit_code=1, stderr="cleanup failed\n")
        with self.assertRaises(BaseExceptionGroup) as raised:
            with (
                patch.object(lease, "TSX_PATH", Path(__file__)),
                patch.object(lease, "LEASE_PATH", Path(__file__)),
                patch.object(subprocess, "Popen", return_value=process),
                lease.StagehandSandboxLease(),
            ):
                raise ValueError("primary failed")

        self.assertEqual(len(raised.exception.exceptions), 2)
        self.assertIsInstance(raised.exception.exceptions[0], ValueError)
        self.assertIsInstance(
            raised.exception.exceptions[1], lease.StagehandSandboxLeaseError
        )


if __name__ == "__main__":
    unittest.main()
