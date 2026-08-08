from __future__ import annotations

import unittest
from contextlib import asynccontextmanager
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
            self.assertRaises(agent.StagehandLangChainToolContractError),
        ):
            await agent.load_stagehand_code_tool(SimpleNamespace())

    async def test_tool_discovery_sanitizes_adapter_failure(self) -> None:
        secret = "https://sandbox.example.test/mcp?token=do-not-reflect"
        with (
            patch.object(
                agent,
                "load_mcp_tools",
                AsyncMock(side_effect=RuntimeError(secret)),
            ),
            self.assertRaises(agent.StagehandLangChainConnectionError) as raised,
        ):
            await agent.load_stagehand_code_tool(SimpleNamespace())

        self.assertNotIn(secret, str(raised.exception))

    async def test_session_scopes_loaded_tool_to_one_client_session(self) -> None:
        connection = SimpleNamespace(
            url="https://sandbox.example.test/mcp", token="secret"
        )
        session = SimpleNamespace()
        code_tool = SimpleNamespace(
            name="code_execute",
            description="# Stagehand V4 code-mode syntax",
        )
        session_names: list[str] = []

        @asynccontextmanager
        async def session_context(name: str):
            session_names.append(name)
            yield session

        client = SimpleNamespace(session=session_context)
        load_tool = AsyncMock(return_value=code_tool)
        with (
            patch.object(agent, "create_stagehand_mcp_client", return_value=client),
            patch.object(agent, "load_stagehand_code_tool", load_tool),
        ):
            async with agent.stagehand_code_session(connection) as loaded:
                self.assertIs(loaded, code_tool)

        self.assertEqual(session_names, ["stagehand"])
        load_tool.assert_awaited_once_with(session)

    def test_build_agent_uses_canonical_tool_description_as_system_prompt(self) -> None:
        code_tool = SimpleNamespace(
            name="code_execute",
            description="# Stagehand V4 code-mode syntax\nCanonical instructions.",
        )
        built_agent = SimpleNamespace()
        with patch.object(
            agent, "create_deep_agent", return_value=built_agent
        ) as create_agent:
            result = agent.build_stagehand_agent(code_tool, model="test-model")

        self.assertIs(result, built_agent)
        create_agent.assert_called_once_with(
            model="test-model",
            tools=[code_tool],
            system_prompt=code_tool.description,
        )

    def test_build_agent_rejects_non_code_execute_tool_without_reflection(self) -> None:
        secret = "unexpected-secret-tool"
        code_tool = SimpleNamespace(name=secret, description="untrusted")

        with self.assertRaises(agent.StagehandLangChainToolContractError) as raised:
            agent.build_stagehand_agent(code_tool)

        self.assertNotIn(secret, str(raised.exception))

    async def test_run_agent_uses_one_session_tool_and_bounded_recursion(self) -> None:
        connection = SimpleNamespace(
            url="https://sandbox.example.test/mcp", token="secret"
        )
        code_tool = SimpleNamespace(name="code_execute", description="canonical")
        expected = {"messages": []}
        deep_agent = SimpleNamespace(ainvoke=AsyncMock(return_value=expected))

        @asynccontextmanager
        async def code_session(actual_connection):
            self.assertIs(actual_connection, connection)
            yield code_tool

        with (
            patch.object(agent, "stagehand_code_session", code_session),
            patch.object(
                agent, "build_stagehand_agent", return_value=deep_agent
            ) as build_agent,
        ):
            result = await agent.run_stagehand_agent(
                connection, "Open example.com", model="test-model"
            )

        self.assertIs(result, expected)
        build_agent.assert_called_once_with(code_tool, "test-model")
        deep_agent.ainvoke.assert_awaited_once_with(
            {
                "messages": [
                    {"role": "user", "content": "Open example.com"},
                ]
            },
            config={"recursion_limit": 20},
        )

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
