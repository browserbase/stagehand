from __future__ import annotations

import unittest
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


if __name__ == "__main__":
    unittest.main()
