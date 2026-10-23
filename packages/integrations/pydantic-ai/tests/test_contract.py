import base64
from unittest.mock import AsyncMock, patch

import pytest
from pydantic_ai import Agent, BinaryContent, ModelRetry
from pydantic_ai.models.test import TestModel
from stagehand_middleware.facade import (
    StagehandFacadeInputError,
    StagehandFacadeTools,
    facade_instructions,
    facade_tools,
)

from agent import PageReport, browser_session, browser_tools, build_agent, run_instruction


def test_tools_use_shared_contract() -> None:
    facade = AsyncMock(spec=StagehandFacadeTools)
    tools = browser_tools(facade)
    for tool, definition in zip(tools, facade_tools(), strict=True):
        assert tool.name == definition["name"]
        assert tool.description == definition["description"]
        assert tool.function_schema.json_schema == definition["inputSchema"]
        assert tool.sequential
    result = build_agent(structured=False, model="test").run_sync("Inspect page")
    assert result.all_messages()[0].instructions == facade_instructions()


async def test_tools_translate_arguments_and_images() -> None:
    facade = AsyncMock(spec=StagehandFacadeTools)
    facade.run.return_value = {"title": "Example"}
    facade.snapshot.return_value = "[1-1] button Submit"
    facade.screenshot.return_value = {
        "data": base64.b64encode(b"image").decode(),
        "mimeType": "image/jpeg",
    }
    tools = {tool.name: tool.function for tool in browser_tools(facade)}
    assert await tools["run"](code="return await page.title();") == {"title": "Example"}
    facade.run.assert_awaited_once_with(code="return await page.title();")
    assert await tools["snapshot"](includeIframes=False) == "[1-1] button Submit"
    facade.snapshot.assert_awaited_once_with(include_iframes=False)
    image = await tools["screenshot"](fullPage=True, type="jpeg", quality=40)
    assert isinstance(image, BinaryContent)
    assert image.data == b"image"
    assert image.media_type == "image/jpeg"
    facade.screenshot.assert_awaited_once_with(full_page=True, type="jpeg", quality=40)
    with pytest.raises(ModelRetry):
        await tools["snapshot"](includeIframes="false")
    with pytest.raises(ModelRetry):
        await tools["run"](actions=[{"op": "unknown", "id": "1-1"}])

    facade.run.side_effect = StagehandFacadeInputError("Snapshot ID is stale; snapshot again")
    with pytest.raises(ModelRetry, match="snapshot again"):
        await tools["run"](actions=[{"op": "click", "id": "1-1"}])


async def test_run_uses_native_tools_and_closes_browser(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STAGEHAND_BROWSER", "local")
    browser = AsyncMock()
    stagehand = AsyncMock()
    stagehand.browser = browser
    with (
        patch("agent.local_browser.launch", AsyncMock(return_value=browser)),
        patch("agent.Stagehand.create", AsyncMock(return_value=stagehand)),
        patch("agent.build_agent", return_value=build_agent(structured=False, model="test")),
        patch("agent.StagehandFacadeTools.run", AsyncMock(return_value={"title": "Example"})),
        patch("agent.StagehandFacadeTools.snapshot", AsyncMock(return_value="Example")),
        patch(
            "agent.StagehandFacadeTools.screenshot",
            AsyncMock(
                return_value={"data": base64.b64encode(b"image").decode(), "mimeType": "image/png"}
            ),
        ),
    ):
        assert await run_instruction("Inspect the page", structured=False)
    stagehand.close.assert_awaited_once()
    browser.close.assert_awaited_once()


async def test_browser_cleanup_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STAGEHAND_BROWSER", "local")
    browser = AsyncMock()
    with (
        patch("agent.local_browser.launch", AsyncMock(return_value=browser)),
        patch("agent.Stagehand.create", AsyncMock(side_effect=RuntimeError("attach failed"))),
        pytest.raises(RuntimeError, match="attach failed"),
    ):
        async with browser_session():
            pytest.fail("session must not start")
    browser.close.assert_awaited_once()


def test_structured_output_uses_page_report_model() -> None:
    agent: Agent[None, PageReport] = build_agent(structured=True, model="test")  # type: ignore[assignment]
    with agent.override(model=TestModel()):
        result = agent.run_sync("Open https://example.com and report the title.")
    assert isinstance(result.output, PageReport)
    assert result.output.title
    assert result.output.url
    assert result.output.notes
