#!/usr/bin/env python3
"""Forward local stdio to a Stagehand code-mode MCP in a Modal Sandbox.

This process is trusted host-side glue. The MCP server and every generated
JavaScript body run inside the sandbox; this process only copies stdio and owns
the sandbox lifecycle.
"""

from __future__ import annotations

import atexit
import os
import signal
import sys
import threading
import time
from collections.abc import Iterator

import modal

DEFAULT_ENTRYPOINT = "/opt/stagehand-codemode/dist/codemode/stdio-server.mjs"
DEFAULT_OUTBOUND_DOMAINS = "*.browserbase.com"
DEFAULT_TIMEOUT_SECONDS = 10 * 60
DEFAULT_IDLE_TIMEOUT_SECONDS = 5 * 60


def _required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _integer_env(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name)
    try:
        value = default if raw is None else int(raw)
    except ValueError as error:
        raise RuntimeError(f"{name} must be an integer") from error
    if not minimum <= value <= maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


def _resolve_image() -> modal.Image:
    # Maintainers can point at an already-built Modal image while the proposed
    # public GHCR image is being published. End users should set a versioned or
    # digest-pinned STAGEHAND_CODEMODE_IMAGE reference.
    modal_image_id = os.environ.get("STAGEHAND_CODEMODE_MODAL_IMAGE_ID", "").strip()
    if modal_image_id:
        return modal.Image.from_id(modal_image_id)
    return modal.Image.from_registry(_required_env("STAGEHAND_CODEMODE_IMAGE"))


def _browserbase_secret() -> modal.Secret:
    # This is the complete guest credential allowlist. Outer-agent provider
    # credentials are never injected into the guest. Stagehand-specific model
    # settings are opt-in for Stagehand AI methods such as act and extract.
    values = {
        "STAGEHAND_BROWSER": "browserbase",
        "BROWSERBASE_API_KEY": _required_env("BROWSERBASE_API_KEY"),
    }
    project_id = os.environ.get("BROWSERBASE_PROJECT_ID", "").strip()
    if project_id:
        values["BROWSERBASE_PROJECT_ID"] = project_id
    for name in ("STAGEHAND_MODEL_NAME", "STAGEHAND_MODEL_API_KEY"):
        value = os.environ.get(name, "").strip()
        if value:
            values[name] = value
    return modal.Secret.from_dict(values)


def _outbound_domains() -> list[str]:
    raw = os.environ.get("STAGEHAND_CODEMODE_OUTBOUND_DOMAINS", DEFAULT_OUTBOUND_DOMAINS)
    domains = [domain.strip() for domain in raw.split(",") if domain.strip()]
    if not domains:
        raise RuntimeError(
            "STAGEHAND_CODEMODE_OUTBOUND_DOMAINS must allow required Browserbase hosts"
        )
    return domains


class SandboxProcess:
    def __init__(self) -> None:
        self.sandbox: modal.Sandbox | None = None
        self._shutdown_requested = False
        self._closed = False

    def start(self) -> None:
        app = modal.App.lookup(
            os.environ.get("STAGEHAND_CODEMODE_MODAL_APP", "stagehand-codemode"),
            create_if_missing=True,
        )
        timeout = _integer_env(
            "STAGEHAND_CODEMODE_TIMEOUT_SECONDS",
            DEFAULT_TIMEOUT_SECONDS,
            30,
            24 * 60 * 60,
        )
        idle_timeout = _integer_env(
            "STAGEHAND_CODEMODE_IDLE_TIMEOUT_SECONDS",
            DEFAULT_IDLE_TIMEOUT_SECONDS,
            30,
            timeout,
        )
        entrypoint = os.environ.get("STAGEHAND_CODEMODE_ENTRYPOINT", DEFAULT_ENTRYPOINT)
        self.sandbox = modal.Sandbox.create(
            "node",
            entrypoint,
            app=app,
            image=_resolve_image(),
            secrets=[_browserbase_secret()],
            timeout=timeout,
            idle_timeout=idle_timeout,
            outbound_domain_allowlist=_outbound_domains(),
        )
        # The MCP is the sandbox's primary process. EOF therefore lets its own
        # shutdown handler close Stagehand and the Browserbase browser before
        # the sandbox finishes.
        print("Stagehand code-mode MCP started in a Modal Sandbox", file=sys.stderr)

    def request_shutdown(self) -> None:
        if self._shutdown_requested:
            return
        self._shutdown_requested = True
        if self.sandbox is not None:
            try:
                self.sandbox.stdin.write_eof()
                self.sandbox.stdin.drain()
            except Exception:
                pass

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self.request_shutdown()
        if self.sandbox is not None:
            try:
                deadline = time.monotonic() + 5
                while self.sandbox.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.1)
                if self.sandbox.poll() is None:
                    self.sandbox.terminate()
            except Exception:
                pass
            try:
                self.sandbox.detach()
            except Exception:
                pass


def _stdin_chunks() -> Iterator[bytes]:
    while True:
        chunk = os.read(sys.stdin.fileno(), 64 * 1024)
        if not chunk:
            return
        yield chunk


def _forward_stdin(owner: SandboxProcess) -> None:
    assert owner.sandbox is not None
    try:
        for chunk in _stdin_chunks():
            owner.sandbox.stdin.write(chunk)
            owner.sandbox.stdin.drain()
    finally:
        owner.request_shutdown()


def _forward_stdout(owner: SandboxProcess) -> None:
    assert owner.sandbox is not None
    for line in owner.sandbox.stdout:
        data = line.encode() if isinstance(line, str) else line
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()


def _forward_stderr(owner: SandboxProcess) -> None:
    assert owner.sandbox is not None
    for line in owner.sandbox.stderr:
        data = line.encode() if isinstance(line, str) else line
        sys.stderr.buffer.write(b"sandbox: " + data)
        sys.stderr.buffer.flush()


def main() -> int:
    owner = SandboxProcess()
    signal_exit_code: int | None = None
    atexit.register(owner.close)

    def stop(_signum: int, _frame: object) -> None:
        nonlocal signal_exit_code
        signal_exit_code = 128 + _signum
        owner.request_shutdown()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    try:
        owner.start()
        threads = [
            threading.Thread(target=_forward_stdin, args=(owner,), daemon=True),
            threading.Thread(target=_forward_stdout, args=(owner,), daemon=True),
            threading.Thread(target=_forward_stderr, args=(owner,), daemon=True),
        ]
        for thread in threads:
            thread.start()
        assert owner.sandbox is not None
        owner.sandbox.wait()
        for thread in threads[1:]:
            thread.join(timeout=5)
        return signal_exit_code or owner.sandbox.returncode or 0
    finally:
        owner.close()


if __name__ == "__main__":
    raise SystemExit(main())
