from __future__ import annotations

import io
import os
import subprocess
import unittest
from builtins import BaseExceptionGroup
from pathlib import Path
from unittest.mock import patch

import vercel_sandbox_lease as lease

VALID_TOKEN = "A" * 43
SHORT_TOKEN = "A" * 42
LONG_TOKEN = "A" * 44


class FakeProcess:
    def __init__(self, *, exit_code: int = 0, stderr: str = "") -> None:
        self.stdin = io.StringIO()
        self.stdout = io.StringIO(
            '{"url":"https://sandbox.example.vercel.run/mcp",'
            f'"token":"{VALID_TOKEN}"}}\n'
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


class EscalatingFakeProcess(FakeProcess):
    def __init__(self) -> None:
        super().__init__()
        self.wait_calls = 0
        self.terminated = False
        self.killed = False

    def wait(self, timeout: float) -> int:
        self.wait_calls += 1
        self.waited_after_stdin_closed = self.stdin.closed
        if self.wait_calls < 3:
            raise subprocess.TimeoutExpired("stagehand-lease", timeout)
        self.returncode = -9
        return -9

    def terminate(self) -> None:
        self.terminated = True

    def kill(self) -> None:
        self.killed = True


class UnstoppableFakeProcess(EscalatingFakeProcess):
    def wait(self, timeout: float) -> int:
        self.wait_calls += 1
        self.waited_after_stdin_closed = self.stdin.closed
        raise subprocess.TimeoutExpired("stagehand-lease", timeout)


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
            self.assertEqual(connection.token, VALID_TOKEN)

        self.assertTrue(process.waited_after_stdin_closed)

    def test_cleanup_failure_preserves_primary_failure(self) -> None:
        secret = "cleanup-secret-do-not-reflect"
        process = FakeProcess(exit_code=1, stderr=f"cleanup failed: {secret}\n")
        with (
            self.assertRaises(BaseExceptionGroup) as raised,
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
        self.assertNotIn(secret, str(raised.exception.exceptions[1]))

    def test_setup_timeout_is_typed_and_closes_the_owner(self) -> None:
        process = FakeProcess()
        with (
            patch.object(lease, "TSX_PATH", Path(__file__)),
            patch.object(lease, "LEASE_PATH", Path(__file__)),
            patch.object(subprocess, "Popen", return_value=process),
            patch.object(
                lease.queue.Queue,
                "get",
                side_effect=lease.queue.Empty,
            ),
            self.assertRaises(lease.StagehandSandboxLeaseError) as raised,
        ):
            lease.StagehandSandboxLease().start()

        self.assertEqual(
            str(raised.exception), "Stagehand sandbox lease timed out while starting"
        )
        self.assertTrue(process.waited_after_stdin_closed)

    def test_keyboard_interrupt_during_setup_is_preserved(self) -> None:
        process = FakeProcess()
        with (
            patch.object(lease, "TSX_PATH", Path(__file__)),
            patch.object(lease, "LEASE_PATH", Path(__file__)),
            patch.object(subprocess, "Popen", return_value=process),
            patch.object(
                lease.queue.Queue,
                "get",
                side_effect=KeyboardInterrupt,
            ),
            self.assertRaises(KeyboardInterrupt),
        ):
            lease.StagehandSandboxLease().start()

        self.assertTrue(process.waited_after_stdin_closed)

    def test_unexpected_setup_exception_is_sanitized(self) -> None:
        process = FakeProcess()
        with (
            patch.object(lease, "TSX_PATH", Path(__file__)),
            patch.object(lease, "LEASE_PATH", Path(__file__)),
            patch.object(subprocess, "Popen", return_value=process),
            patch.object(
                lease.queue.Queue,
                "get",
                side_effect=ValueError("setup-secret-do-not-reflect"),
            ),
            self.assertRaises(lease.StagehandSandboxLeaseError) as raised,
        ):
            lease.StagehandSandboxLease().start()

        self.assertEqual(
            str(raised.exception), "Stagehand sandbox lease failed during setup"
        )
        self.assertTrue(process.waited_after_stdin_closed)

    def test_connection_parser_rejects_untrusted_shapes(self) -> None:
        invalid_connections = (
            "not-json",
            f'{{"url":"http://sandbox.example.test/mcp","token":"{VALID_TOKEN}"}}',
            f'{{"url":"https://sandbox.example.test/not-mcp","token":"{VALID_TOKEN}"}}',
            f'{{"url":"https://user:pass@sandbox.example.test/mcp","token":"{VALID_TOKEN}"}}',
            f'{{"url":"https://sandbox.example.test/mcp?x=1","token":"{VALID_TOKEN}"}}',
            f'{{"url":"https://sandbox.example.test/mcp#fragment","token":"{VALID_TOKEN}"}}',
            f'{{"url":"https://sandbox.example.test/mcp","token":"{SHORT_TOKEN}"}}',
            f'{{"url":"https://sandbox.example.test/mcp","token":"{LONG_TOKEN}"}}',
            '{"url":"https://sandbox.example.test/mcp","token":""}',
        )
        for connection in invalid_connections:
            with (
                self.subTest(connection=connection),
                self.assertRaises(lease.StagehandSandboxLeaseError),
            ):
                lease.parse_connection(connection)

    def test_close_escalates_from_terminate_to_kill(self) -> None:
        process = EscalatingFakeProcess()
        owner = lease.StagehandSandboxLease()
        owner._process = process

        with self.assertRaises(lease.StagehandSandboxLeaseError):
            owner.close()

        self.assertTrue(process.waited_after_stdin_closed)
        self.assertTrue(process.terminated)
        self.assertTrue(process.killed)
        self.assertEqual(process.wait_calls, 3)

    def test_close_reports_owner_that_survives_kill(self) -> None:
        process = UnstoppableFakeProcess()
        owner = lease.StagehandSandboxLease()
        owner._process = process

        with self.assertRaises(lease.StagehandSandboxLeaseError) as raised:
            owner.close()

        self.assertEqual(
            str(raised.exception),
            "Stagehand sandbox lease could not stop the trusted owner",
        )
        self.assertTrue(process.waited_after_stdin_closed)
        self.assertTrue(process.terminated)
        self.assertTrue(process.killed)
        self.assertEqual(process.wait_calls, 3)


if __name__ == "__main__":
    unittest.main()
