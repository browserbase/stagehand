"""Own the TypeScript Vercel Sandbox lease from a Python framework example."""

from __future__ import annotations

import json
import os
import queue
import re
import subprocess
import threading
from builtins import BaseExceptionGroup
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType
from typing import TextIO
from urllib.parse import urlsplit

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
LEASE_PATH = (
    REPOSITORY_ROOT / "packages/integrations/examples/vercel-sandbox/src/lease.ts"
)
TSX_PATH = REPOSITORY_ROOT / "node_modules/.bin/tsx"
LEASE_SETUP_TIMEOUT_SECONDS = 3 * 60
LEASE_CLEANUP_TIMEOUT_SECONDS = 60
LEASE_TERMINATION_TIMEOUT_SECONDS = 60
LEASE_KILL_TIMEOUT_SECONDS = 5
LEASE_ENVIRONMENT_KEYS = (
    "PATH",
    "HOME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE",
    "NODE_EXTRA_CA_CERTS",
    "NODE_OPTIONS",
    "CI",
    "STAGEHAND_SANDBOX_ARTIFACTS",
    "BROWSERBASE_API_KEY",
    "BROWSERBASE_PROJECT_ID",
    "VERCEL_OIDC_TOKEN",
    "VERCEL_TEAM_ID",
    "VERCEL_PROJECT_ID",
    "VERCEL_TOKEN",
)


class StagehandSandboxLeaseError(RuntimeError):
    """The trusted sandbox owner could not start or clean up its lease."""


@dataclass(frozen=True)
class StagehandSandboxConnection:
    url: str
    token: str


class StagehandSandboxLease:
    """Start the reviewed Node lease and close it after the Python MCP client."""

    def __init__(self) -> None:
        self._process: subprocess.Popen[str] | None = None
        self._stderr_thread: threading.Thread | None = None
        self._closed = False

    def __enter__(self) -> StagehandSandboxConnection:
        return self.start()

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool:
        del exc_type, traceback
        try:
            self.close()
        except BaseException as cleanup_error:
            if exc_value is not None:
                raise BaseExceptionGroup(
                    "Python framework run and Vercel Sandbox cleanup both failed",
                    [exc_value, cleanup_error],
                )
            raise
        return False

    def start(self) -> StagehandSandboxConnection:
        if self._process is not None:
            raise StagehandSandboxLeaseError(
                "Stagehand sandbox lease was already started"
            )
        if not TSX_PATH.is_file() or not LEASE_PATH.is_file():
            raise StagehandSandboxLeaseError(
                "Install the workspace before starting the Stagehand sandbox lease"
            )

        try:
            process = subprocess.Popen(
                [str(TSX_PATH), str(LEASE_PATH)],
                cwd=REPOSITORY_ROOT,
                env=lease_environment(),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                bufsize=1,
            )
        except (OSError, subprocess.SubprocessError):
            raise self._lease_error("could not start the trusted owner") from None
        self._process = process
        assert process.stdout is not None
        assert process.stderr is not None
        self._stderr_thread = threading.Thread(
            target=self._drain_stderr,
            args=(process.stderr,),
            name="stagehand-sandbox-lease-stderr",
            daemon=True,
        )
        self._stderr_thread.start()

        line_queue: queue.Queue[str] = queue.Queue(maxsize=1)
        line_thread = threading.Thread(
            target=lambda: line_queue.put(process.stdout.readline()),
            name="stagehand-sandbox-lease-connection",
            daemon=True,
        )
        line_thread.start()

        try:
            try:
                line = line_queue.get(timeout=LEASE_SETUP_TIMEOUT_SECONDS)
            except queue.Empty:
                raise self._lease_error("timed out while starting") from None
            if not line:
                raise self._lease_error("exited before returning a connection")
            connection = parse_connection(line)
            if process.poll() is not None:
                raise self._lease_error(
                    "exited immediately after returning a connection"
                )
            return connection
        except BaseException as error:  # noqa: BLE001 -- cleanup must preserve any primary failure.
            primary_error = (
                error
                if isinstance(error, StagehandSandboxLeaseError)
                else self._lease_error("failed during setup")
            )
            try:
                self.close()
            except BaseException as cleanup_error:  # noqa: BLE001 -- preserve both failures.
                raise BaseExceptionGroup(
                    "Vercel Sandbox lease setup and cleanup both failed",
                    [primary_error, cleanup_error],
                )
            raise primary_error from None

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        process = self._process
        if process is None:
            return

        try:
            assert process.stdin is not None
            try:
                process.stdin.close()
            except BrokenPipeError:
                pass

            try:
                return_code = process.wait(timeout=LEASE_CLEANUP_TIMEOUT_SECONDS)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    return_code = process.wait(
                        timeout=LEASE_TERMINATION_TIMEOUT_SECONDS
                    )
                except subprocess.TimeoutExpired:
                    process.kill()
                    try:
                        return_code = process.wait(timeout=LEASE_KILL_TIMEOUT_SECONDS)
                    except subprocess.TimeoutExpired:
                        raise self._lease_error(
                            "could not stop the trusted owner"
                        ) from None
        except (OSError, subprocess.SubprocessError):
            raise self._lease_error("could not stop the trusted owner") from None

        if self._stderr_thread is not None:
            self._stderr_thread.join(timeout=1)
        if return_code != 0:
            raise self._lease_error(f"exited with status {return_code}")

    def _drain_stderr(self, stderr: TextIO) -> None:
        for _line in stderr:
            pass

    def _lease_error(self, message: str) -> StagehandSandboxLeaseError:
        return StagehandSandboxLeaseError(f"Stagehand sandbox lease {message}")


def lease_environment() -> dict[str, str]:
    """Return only the trusted lease inputs; outer model credentials stay outside."""
    return {
        key: value
        for key in LEASE_ENVIRONMENT_KEYS
        if (value := os.environ.get(key)) is not None
    }


def parse_connection(line: str) -> StagehandSandboxConnection:
    try:
        value = json.loads(line)
        url = value["url"]
        token = value["token"]
    except (json.JSONDecodeError, KeyError, TypeError):
        raise StagehandSandboxLeaseError(
            "Stagehand sandbox lease returned an invalid connection"
        ) from None
    if (
        not isinstance(url, str)
        or not isinstance(token, str)
        or re.fullmatch(r"[A-Za-z0-9_-]{43}", token) is None
    ):
        raise StagehandSandboxLeaseError(
            "Stagehand sandbox lease returned an invalid connection"
        )
    parsed = urlsplit(url)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.path != "/mcp"
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise StagehandSandboxLeaseError(
            "Stagehand sandbox lease returned an invalid connection"
        )
    return StagehandSandboxConnection(url=url, token=token)
