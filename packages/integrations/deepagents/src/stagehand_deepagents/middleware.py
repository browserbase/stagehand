"""Stagehand's browser tools as a LangChain agent middleware.

``StagehandMiddleware`` gives an agent the facade's ``run``, ``snapshot`` and
``screenshot`` tools, named ``browser_run`` and so on, and adds the facade's
instructions to the system prompt. Each thread gets its own browser, launched on the
thread's first browser call and closed when the agent's run ends.
"""

from __future__ import annotations

import asyncio
import base64
import json
from collections.abc import Awaitable, Callable
from typing import Any, Literal, TypeVar

from langchain.agents.middleware import AgentMiddleware, AgentState, ModelRequest, ModelResponse
from langchain.tools import BaseTool, ToolRuntime, tool
from langchain_core.messages import SystemMessage
from langgraph.config import get_config
from langgraph.runtime import Runtime
from stagehand_middleware.facade import (
    StagehandFacadeExecutionError,
    StagehandFacadeInputError,
    facade_instructions,
    facade_tools,
)
from stagehand_middleware.facade.tools import sanitize_error_message

from .runtime import BrowserTools, RuntimeConfig

T = TypeVar("T")

# The facade's text and errors name its tools `run` and so on; ours gain `browser_`.
_RENAMED = (
    "These tools are named browser_run, browser_snapshot and browser_screenshot: "
    "call those wherever this text or an error names run, snapshot or screenshot."
)


class StagehandMiddleware(AgentMiddleware):
    """Give the agent a Stagehand browser through ``browser_run``, ``browser_snapshot`` and
    ``browser_screenshot``.

    Args:
        config: Which browser to launch (local Chrome or Browserbase) and how. Defaults
            to `RuntimeConfig.from_env()`, which reads ``STAGEHAND_*`` and
            ``BROWSERBASE_API_KEY``.
        close_after_run: Close the thread's browser when the agent's run ends. Pass
            ``False`` to keep it, and its open pages, for the thread's next run; then
            call `aclose` when done.
    """

    def __init__(
        self, config: RuntimeConfig | None = None, *, close_after_run: bool = True
    ) -> None:
        super().__init__()
        self.config = config or RuntimeConfig.from_env()
        self.close_after_run = close_after_run
        self.tools = self._tools()
        self._instructions = f"{facade_instructions()}\n\n{_RENAMED}"
        self._browsers: dict[str | None, BrowserTools] = {}
        self._locks: dict[str | None, asyncio.Lock] = {}

    async def aclose(self) -> None:
        """Close every thread's browser."""
        browsers, self._browsers = self._browsers, {}
        await asyncio.gather(*(browser.close() for browser in browsers.values()))

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        system = request.system_message
        blocks = [
            *(system.content_blocks if system else []),
            {"type": "text", "text": self._instructions},
        ]
        return await handler(request.override(system_message=SystemMessage(content_blocks=blocks)))

    async def aafter_agent(self, state: AgentState, runtime: Runtime) -> None:  # noqa: ARG002
        if self.close_after_run:
            thread = _thread_id(runtime)
            async with self._locks.setdefault(thread, asyncio.Lock()):
                if browser := self._browsers.pop(thread, None):
                    await browser.close()

    async def _call(
        self, runtime: ToolRuntime, fn: Callable[[BrowserTools], Awaitable[T]]
    ) -> T | str:
        """Run ``fn`` on the thread's browser, launching it first. Errors go to the model."""
        thread = _thread_id(runtime)
        async with self._locks.setdefault(thread, asyncio.Lock()):
            try:
                if thread not in self._browsers:
                    self._browsers[thread] = await BrowserTools.start(self.config)
                return await fn(self._browsers[thread])
            except StagehandFacadeInputError as err:
                return f"error: {err}"
            except StagehandFacadeExecutionError as err:  # thrown by run code
                return f"error: {err.name}: {err}"
            except Exception as err:  # noqa: BLE001 - reported to the model
                return f"error: {sanitize_error_message(f'{type(err).__name__}: {err}')}"

    def _tools(self) -> list[BaseTool]:
        """The facade's tools as its hosts advertise them, names prefixed ``browser_``."""
        facade = {entry["name"]: entry for entry in facade_tools()}

        def advertised(name: str) -> Callable[[Callable[..., Awaitable[object]]], BaseTool]:
            entry = facade[name]
            return tool(
                f"browser_{name}",
                description=entry["description"],
                args_schema=entry["inputSchema"],
            )

        @advertised("run")
        async def run(
            runtime: ToolRuntime,
            code: str | None = None,
            actions: list[dict[str, Any]] | None = None,
            **unexpected: object,
        ) -> str:
            if unexpected:
                return _unexpected(unexpected)
            result = await self._call(runtime, lambda b: b.run(code=code, actions=actions))
            return result if isinstance(result, str) else json.dumps(result, default=str)

        @advertised("snapshot")
        async def snapshot(
            runtime: ToolRuntime,
            includeIframes: bool = True,  # noqa: N803 - the facade's name
            **unexpected: object,
        ) -> str:
            if unexpected:
                return _unexpected(unexpected)
            return await self._call(runtime, lambda b: b.snapshot(include_iframes=includeIframes))

        @advertised("screenshot")
        async def screenshot(
            runtime: ToolRuntime,
            fullPage: bool | None = None,  # noqa: N803 - the facade's name
            type: Literal["png", "jpeg"] = "png",
            quality: float | None = None,
            **unexpected: object,
        ) -> list[dict[str, str]] | str:
            if unexpected:
                return _unexpected(unexpected)
            shot = await self._call(
                runtime, lambda b: b.screenshot(full_page=fullPage, type=type, quality=quality)
            )
            if isinstance(shot, str):
                return shot
            image, mime_type = shot
            return [
                {"type": "text", "text": "Screenshot of the current page."},
                {
                    "type": "image",
                    "base64": base64.b64encode(image).decode(),
                    "mime_type": mime_type,
                },
            ]

        return [run, snapshot, screenshot]


def _thread_id(runtime: ToolRuntime | Runtime) -> str | None:
    """The thread whose browser to use; ``None`` for an agent run without a checkpointer."""
    config = getattr(runtime, "config", None)
    if config is None:  # an agent hook's Runtime has no config
        config = get_config()
    return (config.get("configurable") or {}).get("thread_id")


def _unexpected(arguments: dict[str, object]) -> str:
    """JSON-schema tools take their arguments unchecked, so turn away unknown names."""
    return f"error: unexpected arguments: {', '.join(sorted(arguments))}"
