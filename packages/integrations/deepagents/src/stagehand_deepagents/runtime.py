from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from typing import Any, Literal

from stagehand import Page, Stagehand, StagehandBrowser, browserbase, local_browser
from stagehand_middleware.facade import StagehandFacadeTools

BrowserProvider = Literal["local", "browserbase"]
ImageType = Literal["png", "jpeg"]


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class RuntimeConfig:
    provider: BrowserProvider = "local"
    headless: bool = False
    start_url: str | None = None
    stagehand_model: str | None = None
    stagehand_model_api_key: str | None = None
    stagehand_api_url: str | None = None
    browserbase_api_key: str | None = None
    # Experimental: page.waitForTimeout(ms) in run code returns once the page is
    # quiet, never later than ms (STAGEHAND_FACADE_QUIET_WAIT).
    quiet_wait: bool = False
    # Where screenshots that run code saves with a path are written; None is the
    # current directory (STAGEHAND_ARTIFACT_ROOT).
    artifact_root: str | None = None

    @classmethod
    def from_env(cls) -> RuntimeConfig:
        raw_provider = os.environ.get("STAGEHAND_BROWSER", "local").lower()
        if raw_provider not in {"local", "browserbase"}:
            raise ValueError("STAGEHAND_BROWSER must be 'local' or 'browserbase'")
        stagehand_model = os.environ.get("STAGEHAND_MODEL") or None
        stagehand_model_api_key = os.environ.get("STAGEHAND_MODEL_API_KEY") or None
        if stagehand_model_api_key and not stagehand_model:
            raise ValueError("STAGEHAND_MODEL_API_KEY requires STAGEHAND_MODEL")
        return cls(
            provider=raw_provider,
            headless=_env_bool("STAGEHAND_HEADLESS", False),
            start_url=os.environ.get("STAGEHAND_START_URL") or None,
            stagehand_model=stagehand_model,
            stagehand_model_api_key=stagehand_model_api_key,
            stagehand_api_url=os.environ.get("STAGEHAND_API_URL") or None,
            browserbase_api_key=os.environ.get("BROWSERBASE_API_KEY") or None,
            quiet_wait=_env_bool("STAGEHAND_FACADE_QUIET_WAIT", False),
            artifact_root=os.environ.get("STAGEHAND_ARTIFACT_ROOT") or None,
        )


class BrowserTools:
    """The facade's run, snapshot and screenshot tools over a launched browser."""

    def __init__(
        self,
        *,
        stagehand: Stagehand,
        browser: StagehandBrowser,
        config: RuntimeConfig,
    ) -> None:
        self._stagehand = stagehand
        self._browser = browser
        self._config = config
        self._facade = StagehandFacadeTools(
            stagehand,
            artifact_root=config.artifact_root,
            # Also runs when run code calls browser.close(); the facade runs it once.
            on_close_requested=self._shutdown,
            quiet_wait=config.quiet_wait,
        )
        self._closed = False

    @classmethod
    async def start(cls, config: RuntimeConfig | None = None) -> BrowserTools:
        resolved = config or RuntimeConfig.from_env()
        if resolved.provider == "browserbase":
            api_key = resolved.browserbase_api_key or os.environ.get("BROWSERBASE_API_KEY")
            if not api_key:
                raise ValueError(
                    "BROWSERBASE_API_KEY is required when STAGEHAND_BROWSER=browserbase"
                )
            browser = await browserbase.launch(
                api_key=api_key,
                browser_settings={"viewport": {"width": 1280.0, "height": 720.0}},
            )
        else:
            browser = await local_browser.launch(headless=resolved.headless)

        try:
            create_options: dict[str, object] = {}
            if resolved.stagehand_model:
                create_options["model"] = resolved.stagehand_model
            if resolved.stagehand_model_api_key:
                create_options["model_api_key"] = resolved.stagehand_model_api_key
            if resolved.stagehand_api_url:
                create_options["api_url"] = resolved.stagehand_api_url
            stagehand = await Stagehand.create(browser=browser, **create_options)
        except BaseException:
            await browser.close()
            raise

        tools = cls(stagehand=stagehand, browser=browser, config=resolved)
        try:
            if resolved.start_url:
                await (await tools._active_page()).goto(resolved.start_url)
        except BaseException:
            await tools.close()
            raise
        return tools

    async def close(self) -> None:
        await self._facade.close()

    async def _shutdown(self) -> None:
        self._closed = True
        try:
            await self._stagehand.close()
        finally:
            await self._browser.close()

    async def snapshot(self, *, include_iframes: bool = True) -> str:
        return await self._facade.snapshot(include_iframes=include_iframes)

    async def screenshot(
        self,
        *,
        full_page: bool | None = None,
        type: ImageType = "png",
        quality: float | None = None,
    ) -> tuple[bytes, str]:
        if quality is not None and not 0 <= quality <= 100:
            raise ValueError("quality must be between 0 and 100")
        if type == "png" and quality is not None:
            raise ValueError("quality is only valid for jpeg screenshots")
        image = await self._facade.screenshot(full_page=full_page, type=type, quality=quality)
        return base64.b64decode(image["data"]), image["mimeType"]

    async def run(
        self,
        *,
        code: str | None = None,
        actions: list[dict[str, Any]] | None = None,
    ) -> object:
        return await self._facade.run(code=code, actions=actions)

    async def _active_page(self) -> Page:
        if self._closed:
            raise RuntimeError("Stagehand browser tools are closed")
        page = await self._browser.context.active_page()
        if page is None:
            page = await self._browser.context.new_page()
        return page


def stringify_result(value: object) -> str:
    if isinstance(value, str):
        return value
    if value is None:
        return "null"
    return json.dumps(value, indent=2, ensure_ascii=False)
