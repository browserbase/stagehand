from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from langchain.agents import create_agent
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, BaseMessage, ToolMessage
from langchain_core.outputs import ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from stagehand_middleware.facade import StagehandFacadeExecutionError, facade_instructions

from stagehand_deepagents import RuntimeConfig, StagehandMiddleware
from stagehand_deepagents.runtime import BrowserTools


class FakeBrowser:
    def __init__(self) -> None:
        self.closed = False

    async def run(self, *, code: str | None = None, actions: object = None) -> object:
        if code == "throw":
            raise StagehandFacadeExecutionError("TypeError", "boom")
        return {"code": code, "actions": actions}

    async def snapshot(self, *, include_iframes: bool = True) -> str:
        return f"[0-1] RootWebArea (iframes={include_iframes})"

    async def screenshot(self, **_: object) -> tuple[bytes, str]:
        return b"png", "image/png"

    async def close(self) -> None:
        self.closed = True


class ScriptedModel(GenericFakeChatModel):
    seen: list[list[BaseMessage]] = []

    def bind_tools(self, *_: object, **__: object) -> ScriptedModel:
        return self

    def _generate(self, messages: list[BaseMessage], *args: object, **kwargs: object) -> ChatResult:
        self.seen.append(messages)
        return super()._generate(messages, *args, **kwargs)


@pytest.fixture
def browsers(monkeypatch: pytest.MonkeyPatch) -> list[FakeBrowser]:
    launched: list[FakeBrowser] = []

    async def start(config: RuntimeConfig | None = None) -> FakeBrowser:
        launched.append(FakeBrowser())
        return launched[-1]

    monkeypatch.setattr(BrowserTools, "start", staticmethod(start))
    return launched


def calls(*steps: tuple[str, dict[str, Any]]) -> Iterator[AIMessage]:
    for i, (name, args) in enumerate(steps):
        yield AIMessage("", tool_calls=[{"name": name, "args": args, "id": f"call-{i}"}])
    yield AIMessage("done")


async def invoke(
    middleware: StagehandMiddleware, *steps: tuple[str, dict[str, Any]], thread: str = "t1"
) -> tuple[list[ToolMessage], ScriptedModel]:
    model = ScriptedModel(messages=calls(*steps), seen=[])
    agent = create_agent(model, middleware=[middleware], checkpointer=InMemorySaver())
    result = await agent.ainvoke(
        {"messages": [{"role": "user", "content": "browse"}]},
        {"configurable": {"thread_id": thread}},
    )
    return [m for m in result["messages"] if isinstance(m, ToolMessage)], model


def test_tools_are_the_facade_surface_prefixed() -> None:
    tools = StagehandMiddleware(RuntimeConfig()).tools
    names = [tool.name for tool in tools]
    assert names == ["browser_run", "browser_snapshot", "browser_screenshot"]


async def test_tools_drive_one_browser_per_run(browsers: list[FakeBrowser]) -> None:
    middleware = StagehandMiddleware(RuntimeConfig())
    results, model = await invoke(
        middleware,
        ("browser_run", {"code": "return 1"}),
        ("browser_snapshot", {"includeIframes": False}),
        ("browser_screenshot", {"type": "png"}),
    )
    assert len(browsers) == 1
    assert results[0].content == '{"code": "return 1", "actions": null}'
    assert results[1].content == "[0-1] RootWebArea (iframes=False)"
    assert results[2].content[1] == {"type": "image", "base64": "cG5n", "mime_type": "image/png"}
    # The browser closes when the run ends.
    assert browsers[0].closed
    system = model.seen[0][0]
    assert facade_instructions() in system.text


async def test_errors_go_to_the_model(browsers: list[FakeBrowser]) -> None:
    results, _ = await invoke(
        StagehandMiddleware(RuntimeConfig()),
        ("browser_run", {"code": "throw"}),
        ("browser_snapshot", {"include_iframes": True}),
    )
    assert results[0].content == "error: TypeError: boom"
    assert results[1].content == "error: unexpected arguments: include_iframes"


async def test_launch_errors_are_redacted(monkeypatch: pytest.MonkeyPatch) -> None:
    async def start(config: RuntimeConfig | None = None) -> FakeBrowser:
        raise RuntimeError("wss://connect.browserbase.com?apiKey=bb_live_secretsecret")

    monkeypatch.setattr(BrowserTools, "start", staticmethod(start))
    results, _ = await invoke(StagehandMiddleware(RuntimeConfig()), ("browser_snapshot", {}))
    assert "secretsecret" not in results[0].content
    assert results[0].content.startswith("error: RuntimeError:")


async def test_browser_can_outlive_the_run(browsers: list[FakeBrowser]) -> None:
    middleware = StagehandMiddleware(RuntimeConfig(), close_after_run=False)
    await invoke(middleware, ("browser_snapshot", {}))
    await invoke(middleware, ("browser_snapshot", {}))
    await invoke(middleware, ("browser_snapshot", {}), thread="t2")
    assert len(browsers) == 2  # one per thread
    assert not any(browser.closed for browser in browsers)
    await middleware.aclose()
    assert all(browser.closed for browser in browsers)
