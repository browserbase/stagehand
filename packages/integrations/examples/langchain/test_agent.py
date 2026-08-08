from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import agent


class LangChainStagehandAgentTest(unittest.IsolatedAsyncioTestCase):
    def test_client_uses_authenticated_streamable_http(self) -> None:
        client = agent.create_stagehand_mcp_client(
            SimpleNamespace(url="https://sandbox.example/mcp", token="secret")
        )

        self.assertEqual(
            client.connections,
            {
                "stagehand": {
                    "transport": "streamable_http",
                    "url": "https://sandbox.example/mcp",
                    "headers": {"Authorization": "Bearer secret"},
                }
            },
        )

    async def test_tool_discovery_requires_canonical_code_execute(self) -> None:
        tool = SimpleNamespace(
            name="code_execute",
            description="# Stagehand V4 code-mode syntax\nUse Stagehand.",
        )
        with patch.object(agent, "load_mcp_tools", AsyncMock(return_value=[tool])):
            self.assertIs(await agent.load_stagehand_code_tool(SimpleNamespace()), tool)

    async def test_tool_discovery_rejects_noncanonical_description(self) -> None:
        tool = SimpleNamespace(
            name="code_execute", description="Execute arbitrary code."
        )
        with (
            patch.object(agent, "load_mcp_tools", AsyncMock(return_value=[tool])),
            self.assertRaisesRegex(RuntimeError, "canonical guidance"),
        ):
            await agent.load_stagehand_code_tool(SimpleNamespace())

    def test_model_tool_call_counter_ignores_other_tools(self) -> None:
        result = {
            "messages": [
                SimpleNamespace(
                    tool_calls=[
                        {"name": "write_todos"},
                        {"name": "code_execute"},
                    ]
                )
            ]
        }
        self.assertEqual(agent.stagehand_tool_call_count(result), 1)


if __name__ == "__main__":
    unittest.main()
