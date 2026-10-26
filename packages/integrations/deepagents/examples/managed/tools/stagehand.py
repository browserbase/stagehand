# No `from __future__ import annotations`: with a JSON-schema args_schema, LangChain
# finds the injected `runtime: ToolRuntime` parameter only from real annotations.
import asyncio
import json
import logging
import os
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal

from langchain.tools import ToolRuntime, tool
from langchain_core.tools import BaseTool
from stagehand import Stagehand, StagehandBrowser, browserbase
from stagehand_middleware.facade import StagehandFacadeTools, facade_tools
from stagehand_middleware.facade.tools import sanitize_error_message


def _positive_int_env(name: str, default: int) -> int:
    value = int(os.environ.get(name, default))
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return value


def _sanitize_error(message: str) -> str:
    """Redact credential-bearing fragments before errors reach the model."""
    return sanitize_error_message(message)


_LOGGER = logging.getLogger(__name__)


async def _release_session(api_key: str, api_url: str, session_id: str) -> bool:
    """Release a keep-alive session so expiry doesn't strand it; False if it failed."""
    from browserbase import AsyncBrowserbase

    try:
        async with AsyncBrowserbase(api_key=api_key, base_url=api_url) as client:
            await client.sessions.update(session_id, status="REQUEST_RELEASE")
    except Exception as error:
        _LOGGER.warning(
            "Failed to release Browserbase session %s: %s",
            session_id,
            _sanitize_error(str(error)),
        )
        return False
    return True


class _BrowserRuntime:
    def __init__(
        self,
        stagehand: Stagehand,
        browser: StagehandBrowser,
        *,
        browserbase_api_key: str,
        browserbase_api_url: str,
    ) -> None:
        self.stagehand = stagehand
        self.browser = browser
        self.browserbase_api_key = browserbase_api_key
        self.browserbase_api_url = browserbase_api_url
        self.session_id = browser.session_id
        # Set when run code called browser.close(): later calls get the facade's
        # terminal closed error instead of a relaunched browser.
        self.closed_by_agent = False
        self._shut_down = False
        self._released = False
        self.tools = StagehandFacadeTools(
            stagehand,
            artifact_root=os.environ.get("STAGEHAND_ARTIFACT_ROOT") or None,
            # run code calling browser.close() closes and releases the session.
            on_close_requested=self._close_requested,
            quiet_wait=os.environ.get("STAGEHAND_FACADE_QUIET_WAIT", "").lower()
            in {"1", "true", "yes", "on"},
        )

    @classmethod
    async def start(cls, *, session_id: str | None = None) -> "_BrowserRuntime":
        api_key = os.environ.get("BROWSERBASE_API_KEY", "")
        if not api_key:
            raise RuntimeError("BROWSERBASE_API_KEY is required")
        api_url = os.environ.get("BROWSERBASE_API_URL", "https://api.browserbase.com")
        if session_id is not None:
            # Reconnect to a keep-alive session that already carries the
            # extension from its original launch.
            browser = await browserbase.connect(
                api_key=api_key,
                base_url=api_url,
                session_id=session_id,
            )
            return await cls._attach(
                browser,
                browserbase_api_key=api_key,
                browserbase_api_url=api_url,
            )
        # The published stagehand wheel bundles the extension;
        # browserbase.launch provisions it automatically. STAGEHAND_EXTENSION_ID
        # remains available for pre-uploaded extensions.
        configured_extension_id = os.environ.get("STAGEHAND_EXTENSION_ID") or None
        browser = await browserbase.launch(
            api_key=api_key,
            base_url=api_url,
            browser_settings={"viewport": {"width": 1280.0, "height": 720.0}},
            extension_id=configured_extension_id,
            keep_alive=True,
        )
        return await cls._attach(
            browser,
            browserbase_api_key=api_key,
            browserbase_api_url=api_url,
        )

    @classmethod
    async def _attach(
        cls,
        browser: StagehandBrowser,
        *,
        browserbase_api_key: str,
        browserbase_api_url: str,
    ) -> "_BrowserRuntime":
        try:
            model = os.environ.get("STAGEHAND_MODEL") or None
            model_api_key = os.environ.get("STAGEHAND_MODEL_API_KEY") or None
            if model_api_key and not model:
                raise RuntimeError("STAGEHAND_MODEL_API_KEY requires STAGEHAND_MODEL")
            create_options: dict[str, object] = {}
            if model:
                create_options["model"] = model
            if model_api_key:
                create_options["model_api_key"] = model_api_key
            stagehand_api_url = os.environ.get("STAGEHAND_API_URL") or None
            if stagehand_api_url:
                create_options["api_url"] = stagehand_api_url
            stagehand = await Stagehand.create(browser=browser, **create_options)
            return cls(
                stagehand,
                browser,
                browserbase_api_key=browserbase_api_key,
                browserbase_api_url=browserbase_api_url,
            )
        except BaseException:
            await browser.close()
            raise

    async def _close_requested(self) -> None:
        self.closed_by_agent = True
        await self.close()

    async def close(self) -> None:
        # Shutting down happens once; a failed release is retried by later close()
        # calls (the registry's expiry sweep closes agent-closed entries again).
        try:
            if not self._shut_down:
                self._shut_down = True
                try:
                    await self.stagehand.close()
                finally:
                    await self.browser.close()
        finally:
            if self.session_id is not None and not self._released:
                # keep-alive sessions outlive close(); release explicitly
                # so expired registry entries don't strand paid sessions.
                self._released = await _release_session(
                    self.browserbase_api_key, self.browserbase_api_url, self.session_id
                )


@dataclass
class _RegistryEntry:
    browser: _BrowserRuntime
    last_used: float


class _BrowserRegistry:
    def __init__(self) -> None:
        self.entries: dict[str, _RegistryEntry] = {}
        self.lock = asyncio.Lock()

    async def get(self, thread_id: str) -> "_BrowserRuntime":
        now = time.monotonic()
        async with self.lock:
            await self._close_expired(now)
            entry = self.entries.get(thread_id)
            if entry is not None and entry.browser.closed_by_agent:
                # An intentional close is not a crash; keep answering with the
                # facade's closed error until the entry expires.
                entry.last_used = now
                return entry.browser
            if entry is not None and not await _runtime_alive(entry.browser):
                # The handle is dead (socket drop, resume elsewhere) — closed
                # never flips on its own, so probe liveness. The keep-alive
                # session may still be running; reconnect by id before falling
                # back to a fresh launch.
                stale = self.entries.pop(thread_id)
                entry = None
                if stale.browser.session_id is not None:
                    try:
                        revived = await _BrowserRuntime.start(session_id=stale.browser.session_id)
                        entry = _RegistryEntry(revived, now)
                        self.entries[thread_id] = entry
                    except Exception:
                        # Reconnect failed — release the old keep-alive session
                        # best-effort so the replacement doesn't strand it.
                        if stale.browser.browserbase_api_key:
                            await _release_session(
                                stale.browser.browserbase_api_key,
                                stale.browser.browserbase_api_url,
                                stale.browser.session_id,
                            )
                        entry = None
            if entry is None:
                entry = _RegistryEntry(await _BrowserRuntime.start(), now)
                self.entries[thread_id] = entry
            entry.last_used = now
            return entry.browser

    async def _close_expired(self, now: float) -> None:
        ttl = _positive_int_env("STAGEHAND_SESSION_TTL_SECONDS", 1800)
        expired = [
            thread_id for thread_id, entry in self.entries.items() if now - entry.last_used >= ttl
        ]
        for thread_id in expired:
            # A failing close must not surface in the unrelated tool call that
            # triggered the sweep, nor abort cleanup of other expired entries.
            try:
                await self.entries.pop(thread_id).browser.close()
            except Exception:
                pass


async def _runtime_alive(runtime: _BrowserRuntime) -> bool:
    if runtime.browser.closed:
        return False
    try:
        await runtime.browser.context.pages()
    except Exception:
        return False
    return True


_REGISTRY = _BrowserRegistry()


def _thread_id(runtime: ToolRuntime) -> str:
    info = runtime.execution_info
    identifier = info.thread_id or info.run_id
    if identifier is None:
        raise RuntimeError("Stagehand tools require a managed thread or run ID")
    return str(identifier)


_CONTRACT = {spec["name"]: spec for spec in facade_tools()}


def _contract_tool(name: str) -> Callable[[Callable[..., Awaitable[object]]], BaseTool]:
    """`@tool` with the facade contract's description and input schema."""
    return tool(
        name,
        description=_CONTRACT[name]["description"],
        args_schema=_CONTRACT[name]["inputSchema"],
    )


@_contract_tool("run")
async def run(
    code: str | None = None,
    actions: list[dict[str, Any]] | None = None,
    *,
    runtime: ToolRuntime,
) -> str:
    browser = await _REGISTRY.get(_thread_id(runtime))
    try:
        result = await browser.tools.run(code=code, actions=actions)
    except Exception as error:
        raise RuntimeError(_sanitize_error(str(error))) from None
    return json.dumps(result, default=str, separators=(",", ":"))


@_contract_tool("snapshot")
async def snapshot(includeIframes: bool = True, *, runtime: ToolRuntime) -> str:
    browser = await _REGISTRY.get(_thread_id(runtime))
    try:
        return await browser.tools.snapshot(include_iframes=includeIframes)
    except Exception as error:
        raise RuntimeError(_sanitize_error(str(error))) from None


@_contract_tool("screenshot")
async def screenshot(
    fullPage: bool | None = None,
    type: Literal["png", "jpeg"] = "png",
    quality: float | None = None,
    *,
    runtime: ToolRuntime,
) -> list[dict[str, object]]:
    browser = await _REGISTRY.get(_thread_id(runtime))
    try:
        image = await browser.tools.screenshot(full_page=fullPage, type=type, quality=quality)
    except Exception as error:
        raise RuntimeError(_sanitize_error(str(error))) from None
    return [
        {"type": "text", "text": "Screenshot of the current page:"},
        {"type": "image", "url": f"data:{image['mimeType']};base64,{image['data']}"},
    ]
