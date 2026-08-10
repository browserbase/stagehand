from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass
from importlib.resources import files
from typing import Any, Literal

from stagehand import Page, Stagehand, StagehandBrowser, browserbase, local_browser

BrowserProvider = Literal["local", "browserbase"]
ImageType = Literal["png", "jpeg"]

_ACTION_SOURCE = """async (stagehand, input) => {
  let completed = 0;
  for (const action of input.actions) {
    const locator = stagehand.page.locator(action.selector);
    switch (action.op) {
      case "click": await locator.click(); break;
      case "hover": await locator.hover(); break;
      case "fill": await locator.fill(action.value); break;
      case "type": await locator.type(
        action.text,
        action.delay === undefined ? undefined : { delay: action.delay },
      ); break;
      case "press": await locator.click(); await stagehand.page.keyPress(action.key); break;
      case "select": await locator.selectOption(action.values); break;
      default: throw new Error("Unsupported ref action: " + String(action.op));
    }
    completed += 1;
  }
  return { completed };
}"""

_TEXT_NODE_SUFFIX = re.compile(r"/text\(\)(?:\[\d+\])?$")


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def _env_positive_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None:
        return default
    parsed = int(value)
    if parsed <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return parsed


@dataclass(frozen=True)
class RuntimeConfig:
    provider: BrowserProvider = "local"
    headless: bool = True
    start_url: str | None = None
    stagehand_model: str | None = None
    stagehand_model_api_key: str | None = None
    stagehand_api_url: str | None = None
    browserbase_api_key: str | None = None
    run_timeout_ms: int = 60_000

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
            headless=_env_bool("STAGEHAND_HEADLESS", True),
            start_url=os.environ.get("STAGEHAND_START_URL") or None,
            stagehand_model=stagehand_model,
            stagehand_model_api_key=stagehand_model_api_key,
            stagehand_api_url=os.environ.get("STAGEHAND_API_URL") or None,
            browserbase_api_key=os.environ.get("BROWSERBASE_API_KEY") or None,
            run_timeout_ms=_env_positive_int("STAGEHAND_RUN_TIMEOUT_MS", 60_000),
        )


@dataclass(frozen=True)
class _SnapshotState:
    url: str
    xpath_by_id: dict[str, str]


class BrowserTools:
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
        self._snapshots_by_page: dict[str, _SnapshotState] = {}
        self._lock = asyncio.Lock()
        self._closed = False

    @classmethod
    async def start(cls, config: RuntimeConfig | None = None) -> BrowserTools:
        resolved = config or RuntimeConfig.from_env()
        if resolved.provider == "browserbase":
            if not resolved.browserbase_api_key:
                raise ValueError(
                    "BROWSERBASE_API_KEY is required when STAGEHAND_BROWSER=browserbase"
                )
            browser = await browserbase.launch(
                api_key=resolved.browserbase_api_key,
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
        if self._closed:
            return
        self._closed = True
        try:
            await self._stagehand.close()
        finally:
            await self._browser.close()

    async def snapshot(self, *, include_iframes: bool = True) -> str:
        async with self._lock:
            page = await self._active_page()
            snapshot = await page.snapshot(include_iframes=include_iframes)
            self._snapshots_by_page[page.page_id] = _SnapshotState(
                url=await page.url(),
                xpath_by_id=dict(snapshot.xpath_map),
            )
            return snapshot.formatted_tree

    async def screenshot(
        self,
        *,
        full_page: bool | None = None,
        type: ImageType = "png",
        quality: int | None = None,
    ) -> tuple[bytes, str]:
        if quality is not None:
            if not 0 <= quality <= 100:
                raise ValueError("quality must be between 0 and 100")
            quality = round(quality)
        if type == "png" and quality is not None:
            raise ValueError("quality is only valid for jpeg screenshots")
        async with self._lock:
            page = await self._active_page()
            image = await page.screenshot(full_page=full_page, type=type, quality=quality)
            return image, "image/jpeg" if type == "jpeg" else "image/png"

    async def run(
        self,
        *,
        code: str | None = None,
        actions: list[dict[str, Any]] | None = None,
    ) -> object:
        if (code is None) == (actions is None):
            raise ValueError("run requires exactly one of code or actions")
        if code is not None and not code.strip():
            raise ValueError("run code must not be empty")
        if actions is not None and not actions:
            raise ValueError("run actions must not be empty")

        async with self._lock:
            page = await self._active_page()
            if code is not None:
                return await self._run_code(page=page, code=code)
            return await self._run_actions(page=page, actions=actions or [])

    async def _run_code(self, *, page: Page, code: str) -> object:
        facade_source = (
            files("stagehand_deepagents")
            .joinpath("_assets/playwright_facade.js")
            .read_text(encoding="utf-8")
        )
        source = f"""async (batchStagehand, input) => {{
  "use strict";
  const __stagehandCompatIdentity = (target) => target;
  for (let index = 0; index <= 32; index += 1) {{
    globalThis[index === 0 ? "__name" : "__name" + index] = __stagehandCompatIdentity;
  }}
  {facade_source}
  const runtime = await createPlaywrightCompatRuntime(batchStagehand);
  const page = runtime.page;
  const context = runtime.context;
  const browser = runtime.browser;
  const startUrl = input.startUrl;
  const task = input.task;
  return await (async () => {{
    {code}
  }})();
}}"""
        return await self._stagehand.experimental_batch(
            source,
            {"startUrl": self._config.start_url or "", "task": {}},
            page=page,
            timeout=self._config.run_timeout_ms,
        )

    async def _run_actions(self, *, page: Page, actions: list[dict[str, Any]]) -> object:
        snapshot = self._snapshots_by_page.get(page.page_id)
        if snapshot is None:
            raise ValueError("No hydrated snapshot exists for the active page; call snapshot first")
        current_url = await page.url()
        if current_url != snapshot.url:
            self._snapshots_by_page.pop(page.page_id, None)
            raise ValueError("The active page navigated after its snapshot; call snapshot again")

        hydrated = [self._hydrate_action(action, snapshot) for action in actions]
        result = await self._stagehand.experimental_batch(
            _ACTION_SOURCE,
            {"actions": hydrated},
            page=page,
            timeout=self._config.run_timeout_ms,
        )
        completed = (
            result.get("completed", len(hydrated)) if isinstance(result, dict) else len(hydrated)
        )
        return {"completed": completed, "url": await page.url()}

    def _hydrate_action(
        self,
        action: dict[str, Any],
        snapshot: _SnapshotState,
    ) -> dict[str, Any]:
        if not isinstance(action, dict):
            raise TypeError("each action must be an object")
        op = action.get("op")
        identifier = action.get("id")
        if op not in {"click", "hover", "fill", "type", "press", "select"}:
            raise ValueError(f"Unsupported ref action: {op!r}")
        if not isinstance(identifier, str) or not identifier:
            raise ValueError('each action requires a non-empty string "id"')
        self._validate_action_fields(op, action)
        xpath = snapshot.xpath_by_id.get(identifier)
        if xpath is None:
            raise ValueError(
                f'Snapshot ID "{identifier}" is stale or not actionable; snapshot again'
            )
        return {**action, "selector": f"xpath={_TEXT_NODE_SUFFIX.sub('', xpath)}"}

    @staticmethod
    def _validate_action_fields(op: object, action: dict[str, Any]) -> None:
        required = {
            "fill": ("value", str),
            "type": ("text", str),
            "press": ("key", str),
        }
        requirement = required.get(op)
        if requirement is not None:
            name, expected = requirement
            if not isinstance(action.get(name), expected):
                raise ValueError(f'{op} requires string field "{name}"')
        if op == "select":
            values = action.get("values")
            valid = isinstance(values, str) or (
                isinstance(values, list)
                and bool(values)
                and all(isinstance(value, str) for value in values)
            )
            if not valid:
                raise ValueError('select requires "values" as a string or non-empty string list')
        delay = action.get("delay")
        if delay is not None and (not isinstance(delay, int | float) or delay < 0):
            raise ValueError("action delay must be a non-negative number")

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
