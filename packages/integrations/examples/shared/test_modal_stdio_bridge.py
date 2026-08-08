from __future__ import annotations

import io
import signal
import threading
import types
import unittest
from collections.abc import Callable, Iterator
from unittest.mock import patch

import modal_stdio_bridge as bridge


class FakeInput:
    def __init__(self) -> None:
        self.data = bytearray()
        self.eof_calls = 0
        self.eof = threading.Event()

    def write(self, data: bytes) -> None:
        self.data.extend(data)

    def write_eof(self) -> None:
        self.eof_calls += 1
        self.eof.set()

    def drain(self) -> None:
        pass


class FakeSandbox:
    def __init__(
        self,
        returncode: int,
        on_wait: Callable[[], None] | None = None,
    ) -> None:
        self.stdin = FakeInput()
        self.stdout = ["response\n"]
        self.stderr = ["warning\n"]
        self.returncode: int | None = None
        self._final_returncode = returncode
        self._on_wait = on_wait
        self.terminated = False
        self.detached = False

    def wait(self) -> None:
        if not self.stdin.eof.wait(timeout=2):
            raise TimeoutError("stdin EOF was not forwarded")
        if self._on_wait:
            self._on_wait()
        self.returncode = self._final_returncode

    def poll(self) -> int | None:
        return self.returncode

    def terminate(self) -> None:
        self.terminated = True
        self.returncode = 143

    def detach(self) -> None:
        self.detached = True


class ModalStdioBridgeTest(unittest.TestCase):
    def run_bridge(
        self,
        fake: FakeSandbox,
        stdin_chunks: Iterator[bytes],
        signal_handlers: dict[int, Callable[[int, object], None]] | None = None,
    ) -> tuple[int, bytes, bytes]:
        stdout = types.SimpleNamespace(buffer=io.BytesIO())
        stderr = types.SimpleNamespace(buffer=io.BytesIO())

        def start(owner: bridge.SandboxProcess) -> None:
            owner.sandbox = fake  # type: ignore[assignment]

        def register_signal(
            signum: int,
            handler: Callable[[int, object], None],
        ) -> None:
            if signal_handlers is not None:
                signal_handlers[signum] = handler

        with (
            patch.object(bridge.SandboxProcess, "start", start),
            patch.object(bridge, "_stdin_chunks", return_value=stdin_chunks),
            patch.object(bridge.atexit, "register"),
            patch.object(bridge.signal, "signal", side_effect=register_signal),
            patch.object(bridge.sys, "stdout", stdout),
            patch.object(bridge.sys, "stderr", stderr),
        ):
            exit_code = bridge.main()

        return exit_code, stdout.buffer.getvalue(), stderr.buffer.getvalue()

    def test_forwards_stdio_eof_and_process_returncode(self) -> None:
        fake = FakeSandbox(returncode=7)

        exit_code, stdout, stderr = self.run_bridge(fake, iter((b"request\n",)))

        self.assertEqual(exit_code, 7)
        self.assertEqual(fake.stdin.data, b"request\n")
        self.assertEqual(fake.stdin.eof_calls, 1)
        self.assertEqual(stdout, b"response\n")
        self.assertEqual(stderr, b"sandbox: warning\n")
        self.assertFalse(fake.terminated)
        self.assertTrue(fake.detached)

    def test_preserves_signal_exit_code(self) -> None:
        handlers: dict[int, Callable[[int, object], None]] = {}
        fake = FakeSandbox(
            returncode=0,
            on_wait=lambda: handlers[signal.SIGTERM](signal.SIGTERM, object()),
        )

        exit_code, _, _ = self.run_bridge(fake, iter(()), handlers)

        self.assertEqual(exit_code, 143)
        self.assertEqual(fake.stdin.eof_calls, 1)
        self.assertFalse(fake.terminated)


if __name__ == "__main__":
    unittest.main()
