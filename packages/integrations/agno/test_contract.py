import asyncio
import base64
from unittest.mock import AsyncMock, patch

import pytest
from agno.tools.function import ToolResult
from stagehand_middleware.facade import StagehandFacadeTools, facade_instructions, facade_tools

from agent import browser_session, browser_tools, build_agent


def test_tools_use_shared_contract() -> None:
    facade = AsyncMock(spec=StagehandFacadeTools)
    for tool, definition in zip(browser_tools(facade), facade_tools(), strict=True):
        tool.process_entrypoint()
        assert tool.name == definition["name"]
        assert tool.description == definition["description"]
        assert tool.parameters == definition["inputSchema"]
    assert build_agent(facade).instructions == facade_instructions()


def test_tools_translate_arguments_and_images() -> None:
    async def check() -> None:
        facade = AsyncMock(spec=StagehandFacadeTools)
        facade.run.return_value = {"title": "Example"}
        facade.snapshot.return_value = "[1-1] button Submit"
        facade.screenshot.return_value = {
            "data": base64.b64encode(b"image").decode(),
            "mimeType": "image/jpeg",
        }
        tools = {tool.name: tool.entrypoint for tool in browser_tools(facade)}
        assert await tools["run"](code="return await page.title();") == '{"title": "Example"}'
        facade.run.assert_awaited_once_with(code="return await page.title();")
        assert await tools["snapshot"](includeIframes=False) == "[1-1] button Submit"
        facade.snapshot.assert_awaited_once_with(include_iframes=False)
        result = await tools["screenshot"](fullPage=True, type="jpeg", quality=40)
        assert isinstance(result, ToolResult)
        assert result.images[0].content == b"image"
        assert result.images[0].mime_type == "image/jpeg"
        facade.screenshot.assert_awaited_once_with(full_page=True, type="jpeg", quality=40)
        with pytest.raises(ValueError):
            await tools["snapshot"](includeIframes="false")
        with pytest.raises(ValueError):
            await tools["run"](actions=[{"op": "unknown", "id": "1-1"}])

    asyncio.run(check())


def test_session_closes_on_agent_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STAGEHAND_BROWSER", "local")

    async def check() -> None:
        browser = AsyncMock()
        stagehand = AsyncMock()
        stagehand.browser = browser
        with (
            patch("agent.local_browser.launch", AsyncMock(return_value=browser)),
            patch("agent.Stagehand.create", AsyncMock(return_value=stagehand)),
            pytest.raises(RuntimeError, match="agent failed"),
        ):
            async with browser_session():
                raise RuntimeError("agent failed")
        stagehand.close.assert_awaited_once()
        browser.close.assert_awaited_once()

    asyncio.run(check())


def test_session_closes_on_attach_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STAGEHAND_BROWSER", "local")

    async def check() -> None:
        browser = AsyncMock()
        with (
            patch("agent.local_browser.launch", AsyncMock(return_value=browser)),
            patch("agent.Stagehand.create", AsyncMock(side_effect=RuntimeError("attach failed"))),
            pytest.raises(RuntimeError, match="attach failed"),
        ):
            async with browser_session():
                pytest.fail("session must not start")
        browser.close.assert_awaited_once()

    asyncio.run(check())
