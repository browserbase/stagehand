from __future__ import annotations

import unittest
from builtins import BaseExceptionGroup
from threading import Event
from types import SimpleNamespace
from unittest.mock import patch

import agent


class FakeAdapter:
    def __init__(
        self, tools: object, *, discovery_error: Exception | None = None
    ) -> None:
        self._tools = tools
        self._discovery_error = discovery_error
        self.stop_error: Exception | None = None

    @property
    def tools(self) -> object:
        if self._discovery_error is not None:
            raise self._discovery_error
        return self._tools

    def stop(self) -> None:
        if self.stop_error is not None:
            raise self.stop_error


class StagehandCodeToolsTest(unittest.TestCase):
    connection = SimpleNamespace(
        url="https://sandbox.example.test/mcp", token="secret-token"
    )

    def test_sanitizes_adapter_discovery_failure(self) -> None:
        secret = "https://sandbox.example.test/mcp?token=do-not-reflect"
        adapter = FakeAdapter([], discovery_error=RuntimeError(secret))
        with (
            patch.object(agent, "MCPServerAdapter", return_value=adapter),
            self.assertRaises(agent.StagehandCrewAIConnectionError) as raised,
            agent.stagehand_code_tools(self.connection),
        ):
            pass
        self.assertNotIn(secret, str(raised.exception))

    def test_rejects_unexpected_remote_tool_without_reflecting_name(self) -> None:
        secret = "unexpected-secret-tool"
        adapter = FakeAdapter(
            [SimpleNamespace(name=secret, description="untrusted description")]
        )
        with (
            patch.object(agent, "MCPServerAdapter", return_value=adapter),
            self.assertRaises(agent.StagehandCrewAIToolContractError) as raised,
            agent.stagehand_code_tools(self.connection),
        ):
            pass
        self.assertNotIn(secret, str(raised.exception))

    def test_sanitizes_adapter_cleanup_failure(self) -> None:
        adapter = FakeAdapter(
            [
                SimpleNamespace(
                    name="code_execute",
                    description="# Stagehand V4 code-mode syntax",
                )
            ]
        )
        adapter.stop_error = RuntimeError("cleanup-secret-do-not-reflect")
        with (
            patch.object(agent, "MCPServerAdapter", return_value=adapter),
            self.assertRaises(agent.StagehandCrewAICleanupError) as raised,
            agent.stagehand_code_tools(self.connection),
        ):
            pass
        self.assertEqual(
            str(raised.exception), "Could not close the CrewAI Stagehand MCP adapter."
        )

    def test_adapter_cleanup_has_a_deadline(self) -> None:
        release = Event()
        adapter = FakeAdapter([])
        adapter.stop = release.wait
        try:
            with (
                patch.object(agent, "ADAPTER_STOP_TIMEOUT_SECONDS", 0.001),
                self.assertRaises(agent.StagehandCrewAICleanupError),
            ):
                agent.stop_adapter(adapter)
        finally:
            release.set()

    def test_setup_and_cleanup_failures_preserve_order_and_types(self) -> None:
        adapter = FakeAdapter([], discovery_error=RuntimeError("discovery-secret"))
        adapter.stop_error = RuntimeError("cleanup-secret")
        with (
            patch.object(agent, "MCPServerAdapter", return_value=adapter),
            self.assertRaises(BaseExceptionGroup) as raised,
            agent.stagehand_code_tools(self.connection),
        ):
            pass

        self.assertEqual(len(raised.exception.exceptions), 2)
        self.assertIsInstance(
            raised.exception.exceptions[0], agent.StagehandCrewAIConnectionError
        )
        self.assertIsInstance(
            raised.exception.exceptions[1], agent.StagehandCrewAICleanupError
        )

    def test_run_and_cleanup_failures_preserve_order_and_types(self) -> None:
        adapter = FakeAdapter(
            [
                SimpleNamespace(
                    name="code_execute",
                    description="# Stagehand V4 code-mode syntax",
                )
            ]
        )
        adapter.stop_error = RuntimeError("cleanup-secret")
        primary = ValueError("run failed")
        with (
            patch.object(agent, "MCPServerAdapter", return_value=adapter),
            self.assertRaises(BaseExceptionGroup) as raised,
            agent.stagehand_code_tools(self.connection),
        ):
            raise primary

        self.assertEqual(len(raised.exception.exceptions), 2)
        self.assertIs(raised.exception.exceptions[0], primary)
        self.assertIsInstance(
            raised.exception.exceptions[1], agent.StagehandCrewAICleanupError
        )


if __name__ == "__main__":
    unittest.main()
