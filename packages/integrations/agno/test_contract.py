import asyncio
import base64
import re
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from agno.tools.mcp import MCPTools
from mcp import ClientSession
from mcp.types import CallToolResult, ImageContent, ListToolsResult, TextContent, Tool

from agent import FACADE_AGENT_INSTRUCTIONS, facade_session, server_params


def test_facade_tool_contract() -> None:
    async def check() -> None:
        async with facade_session() as tools:
            assert sorted(tools.functions) == ["run", "screenshot", "snapshot"]
            run_tool = tools.functions["run"]
            assert 'never "kind"' in run_tool.description
            assert set(run_tool.parameters["properties"]) == {"code", "actions"}

    asyncio.run(check())


def test_screenshot_reaches_agno_as_image() -> None:
    payload = b"\x89PNG\r\n\x1a\nexample"
    session = AsyncMock(spec=ClientSession)
    session.list_tools.return_value = ListToolsResult(
        tools=[Tool(name="screenshot", inputSchema={"type": "object", "properties": {}})]
    )
    session.call_tool.return_value = CallToolResult(
        content=[
            TextContent(type="text", text="Screenshot captured."),
            ImageContent(
                type="image", data=base64.b64encode(payload).decode(), mimeType="image/png"
            ),
        ]
    )

    async def check() -> None:
        tools = MCPTools(session=session)
        await tools.initialize()
        result = await tools.functions["screenshot"].entrypoint()
        assert "Screenshot captured." in result.content
        assert len(result.images) == 1
        assert result.images[0].content == payload
        assert result.images[0].mime_type == "image/png"
        session.call_tool.assert_awaited_once_with("screenshot", {})

    asyncio.run(check())


def test_server_params_keep_agent_credentials_in_host(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "agent-only-key")
    monkeypatch.setenv("STAGEHAND_MODEL_API_KEY", "facade-model-key")
    monkeypatch.setenv("BROWSERBASE_API_KEY", "browser-key")
    params = server_params()
    assert "OPENAI_API_KEY" not in params.env
    assert params.env["STAGEHAND_MODEL_API_KEY"] == "facade-model-key"
    assert params.env["BROWSERBASE_API_KEY"] == "browser-key"


def test_instructions_match_canonical_constant() -> None:
    contract = Path(__file__).parent / ".." / "core" / "src" / "facade" / "contract.ts"
    if not contract.is_file():
        pytest.skip("core contract.ts not present")
    match = re.search(r"FACADE_AGENT_INSTRUCTIONS = `([^`]+)`", contract.read_text())
    assert match, "FACADE_AGENT_INSTRUCTIONS not found in contract.ts"
    assert re.sub(r"\n{2,}", "\n", FACADE_AGENT_INSTRUCTIONS.strip()) == re.sub(
        r"\n{2,}", "\n", match.group(1).strip()
    )
