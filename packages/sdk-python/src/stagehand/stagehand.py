from __future__ import annotations

import asyncio
import builtins
import inspect
import json
import sys
from collections.abc import Callable, Mapping
from importlib.metadata import version
from typing import TypeVar

from pydantic import BaseModel

from ._generated.models import (
    Action,
    ActOptions,
    ActResult,
    ClientModelReference,
    EmptyParams,
    ExtractOptions,
    ImplementationInfo,
    LLMGenerateParams,
    LLMGenerateResult,
    ModelConfig,
    ObserveOptions,
    ObserveResult,
    StagehandActParams,
    StagehandCloseResult,
    StagehandExtractParams,
    StagehandInitParams,
    StagehandInitResult,
    StagehandLog,
    StagehandMetrics,
    StagehandObserveParams,
    TelemetryConfig,
    Variables,
)
from ._generated.models import (
    Locator as ProtocolLocator,
)
from ._generated.protocol_version import STAGEHAND_PROTOCOL_VERSION
from .browser import StagehandBrowser, _claim_browser, _ClaimedBrowser, _release_browser
from .browser_context import BrowserContext
from .cdp_client import CDPConnectionClosedError
from .client_models import (
    Cache,
    ClientLLM,
    ExtractResult,
    LLMGenerateCallback,
    StagehandClientCreateConfig,
    StagehandClientLoggingConfig,
    _cache_config,
    _ExtractWireResult,
    _model_config,
)
from .page import Page
from .rpc_client import RPCClient

ResultModel = TypeVar("ResultModel", bound=BaseModel)
_CONSTRUCTION_TOKEN = object()
_UNAVAILABLE_MESSAGE = (
    "Stagehand is unavailable. Create a new instance with await Stagehand.create()."
)


class Stagehand:
    def __init__(
        self,
        *,
        _token: object | None = None,
        browser: StagehandBrowser | None = None,
        create_config: StagehandClientCreateConfig | None = None,
    ) -> None:
        if _token is not _CONSTRUCTION_TOKEN or browser is None or create_config is None:
            raise TypeError(
                "Stagehand cannot be constructed directly; use await Stagehand.create()"
            )
        self._browser_handle = browser
        self._create_config = create_config
        self._browser_context: BrowserContext | None = None
        self._rpc_client: RPCClient | None = None
        self._remove_notification_listener: Callable[[], None] | None = None
        self._remove_client_llm_handler: Callable[[], None] | None = None
        self._initialized = False
        self._close_task: asyncio.Task[None] | None = None

    @classmethod
    async def create(
        cls,
        *,
        browser: StagehandBrowser,
        api_key: str | None = None,
        model: str | LLMGenerateCallback | None = None,
        model_api_key: str | None = None,
        model_base_url: str | None = None,
        model_headers: Mapping[str, str] | None = None,
        telemetry: TelemetryConfig | None = None,
        system_prompt: str | None = None,
        self_heal: bool | None = None,
        dom_settle_timeout_ms: int | None = None,
        cache: Cache | None = None,
        logging: StagehandClientLoggingConfig | None = None,
    ) -> Stagehand:
        if not isinstance(browser, StagehandBrowser):
            raise TypeError("browser must be created by local_browser or browserbase")
        model_connection_options = (model_api_key, model_base_url, model_headers)
        if model is None and any(value is not None for value in model_connection_options):
            raise TypeError("model connection options require a model name")
        if callable(model) and any(value is not None for value in model_connection_options):
            raise TypeError("model connection options cannot be used with an LLM callback")

        resolved_model: ModelConfig | ClientLLM | None
        if isinstance(model, str):
            resolved_model = _model_config(
                model,
                api_key=model_api_key,
                base_url=model_base_url,
                headers=dict(model_headers) if model_headers is not None else None,
            )
        elif model is not None:
            resolved_model = ClientLLM(generate=model)
        else:
            resolved_model = None

        values: dict[str, object] = {
            name: value
            for name, value in (
                ("api_key", api_key),
                ("system_prompt", system_prompt),
                ("self_heal", self_heal),
                ("dom_settle_timeout_ms", dom_settle_timeout_ms),
                ("cache", _cache_config(cache) if cache is not None else None),
                ("logging", logging),
            )
            if value is not None
        }
        if resolved_model is not None:
            values["model"] = resolved_model
        if telemetry is not None:
            values["telemetry"] = telemetry
        create_config = StagehandClientCreateConfig.model_validate(values)
        claimed = _claim_browser(browser)
        stagehand = cls(
            _token=_CONSTRUCTION_TOKEN,
            browser=browser,
            create_config=create_config,
        )
        try:
            await stagehand._initialize(claimed)
        except BaseException:
            await asyncio.shield(stagehand._cleanup_failed_create(browser))
            raise
        return stagehand

    @property
    def context(self) -> BrowserContext:
        if self._browser_context is None:
            raise RuntimeError(_UNAVAILABLE_MESSAGE)
        return self._browser_context

    @property
    def browser(self) -> StagehandBrowser:
        return self._browser_handle

    @property
    def initialized(self) -> bool:
        return self._initialized

    async def metrics(self) -> StagehandMetrics:
        return await self._connected_rpc_client.send(
            "stagehand.metrics",
            EmptyParams(),
            StagehandMetrics,
        )

    async def _initialize(self, claimed: _ClaimedBrowser) -> None:
        rpc_client = RPCClient(
            claimed.cdp_client,
            request_timeout_ms=claimed.command_timeout_ms,
        )
        self._rpc_client = rpc_client
        self._remove_notification_listener = rpc_client.on_notification(
            "stagehand.log",
            StagehandLog,
            self._handle_stagehand_notification,
        )
        client_llm = self._create_config.model
        if isinstance(client_llm, ClientLLM):

            async def generate(params: LLMGenerateParams) -> LLMGenerateResult:
                return LLMGenerateResult(root=await client_llm.generate(params.root))

            self._remove_client_llm_handler = rpc_client.on_request(
                "llm.generate",
                LLMGenerateParams,
                LLMGenerateResult,
                generate,
            )

        await rpc_client.send(
            "stagehand.init",
            self._worker_init_params(claimed),
            StagehandInitResult,
        )
        self._browser_context = BrowserContext(rpc_client)
        self._initialized = True

    async def act(
        self,
        instruction: str | Action,
        *,
        page: Page | None = None,
        model: ModelConfig | None = None,
        variables: Variables | None = None,
        timeout: float | None = None,
        locator: ProtocolLocator | None = None,
        cache: Cache | None = None,
    ) -> ActResult:
        options = ActOptions.model_validate({
            name: value
            for name, value in (
                ("model", model),
                ("variables", variables),
                ("timeout", timeout),
                ("locator", locator),
                ("cache", _cache_config(cache) if cache is not None else None),
            )
            if value is not None
        })
        target_page = page or await self.context.active_page()
        if target_page is None:
            raise RuntimeError("Stagehand has no active page")
        params = StagehandActParams.model_validate({
            "page_id": target_page.page_id,
            "instruction": instruction,
        })
        if options.model_fields_set:
            params.options = options
        result = await self._connected_rpc_client.send("stagehand.act", params, ActResult)
        return result

    async def observe(
        self,
        *,
        instruction: str | None = None,
        page: Page | None = None,
        model: ModelConfig | None = None,
        variables: Variables | None = None,
        timeout: float | None = None,
        selector: str | None = None,
        ignore_selectors: list[str] | None = None,
        locator: ProtocolLocator | None = None,
        cache: Cache | None = None,
    ) -> ObserveResult:
        options = ObserveOptions.model_validate({
            name: value
            for name, value in (
                ("model", model),
                ("variables", variables),
                ("timeout", timeout),
                ("selector", selector),
                ("ignore_selectors", ignore_selectors),
                ("locator", locator),
                ("cache", _cache_config(cache) if cache is not None else None),
            )
            if value is not None
        })
        target_page = page or await self.context.active_page()
        if target_page is None:
            raise RuntimeError("Stagehand has no active page")
        params = StagehandObserveParams(page_id=target_page.page_id, instruction=instruction)
        if options.model_fields_set:
            params.options = options
        result = await self._connected_rpc_client.send("stagehand.observe", params, ObserveResult)
        return result

    async def extract(
        self,
        *,
        instruction: str,
        schema: builtins.type[ResultModel],
        page: Page | None = None,
        model: ModelConfig | None = None,
        timeout: float | None = None,
        selector: str | None = None,
        ignore_selectors: list[str] | None = None,
        screenshot: bool | None = None,
        locator: ProtocolLocator | None = None,
        cache: Cache | None = None,
    ) -> ExtractResult[ResultModel]:
        options = ExtractOptions.model_validate({
            name: value
            for name, value in (
                ("model", model),
                ("timeout", timeout),
                ("selector", selector),
                ("ignore_selectors", ignore_selectors),
                ("screenshot", screenshot),
                ("locator", locator),
                ("cache", _cache_config(cache) if cache is not None else None),
            )
            if value is not None
        })
        target_page = page or await self.context.active_page()
        if target_page is None:
            raise RuntimeError("Stagehand has no active page")
        params = StagehandExtractParams(
            page_id=target_page.page_id,
            instruction=instruction,
            schema_=schema.model_json_schema(),
        )
        if options.model_fields_set:
            params.options = options
        result = await self._connected_rpc_client.send(
            "stagehand.extract", params, _ExtractWireResult
        )
        return ExtractResult(
            data=schema.model_validate(result.data),
            metadata=result.metadata,
        )

    async def close(self) -> None:
        if self._close_task is None:
            self._close_task = asyncio.create_task(
                self.close(),
                name="stagehand-close",
            )
            await asyncio.shield(self._close_task)
            return
        if asyncio.current_task() is not self._close_task:
            await asyncio.shield(self._close_task)
            return
        try:
            if self._browser_context is not None and self._rpc_client is not None:
                try:
                    await self._rpc_client.send(
                        "stagehand.close",
                        EmptyParams(),
                        StagehandCloseResult,
                    )
                except CDPConnectionClosedError:
                    pass
        finally:
            await asyncio.shield(self._release_resources())

    @property
    def _connected_rpc_client(self) -> RPCClient:
        if not self._initialized or self._rpc_client is None:
            raise RuntimeError(_UNAVAILABLE_MESSAGE)
        return self._rpc_client

    def _worker_init_params(self, claimed: _ClaimedBrowser) -> StagehandInitParams:
        browser_cdp_url = claimed.cdp_client.web_socket_debugger_url
        if browser_cdp_url is None:
            raise RuntimeError("The browser CDP WebSocket URL is unavailable")
        values = self._create_config.model_dump(
            exclude={"logging", "model"},
            exclude_unset=True,
        )
        if isinstance(self._create_config.model, ClientLLM):
            values["model"] = ClientModelReference(source="client")
        elif self._create_config.model is not None:
            values["model"] = self._create_config.model
        values["protocol_version"] = STAGEHAND_PROTOCOL_VERSION
        values["client_info"] = ImplementationInfo(
            name="stagehand-sdk-python",
            version=version("stagehand"),
        )
        values["browser_cdp_url"] = browser_cdp_url
        values["log_level"] = self._create_config.logging.level
        metadata = claimed.worker_init_metadata
        if metadata.api_key is not None:
            values["api_key"] = metadata.api_key
        if metadata.browser is not None:
            values["browser"] = metadata.browser
        return StagehandInitParams.model_validate(values)

    async def _handle_stagehand_notification(self, notification: StagehandLog) -> None:
        logging = self._create_config.logging
        if not _is_log_level_enabled(notification.level.value, logging.level):
            return

        sys.stderr.write(_render_stagehand_log(notification, logging.format) + "\n")
        if logging.on_log is None:
            return

        try:
            result = logging.on_log(notification)
            if inspect.isawaitable(result):
                await result
        except Exception as error:
            sys.stderr.write(f"[stagehand] ERROR on_log callback failed: {error}\n")

    async def _release_resources(self) -> None:
        if self._remove_client_llm_handler is not None:
            self._remove_client_llm_handler()
            self._remove_client_llm_handler = None
        if self._remove_notification_listener is not None:
            self._remove_notification_listener()
            self._remove_notification_listener = None
        rpc_client = self._rpc_client
        self._rpc_client = None
        self._browser_context = None
        self._initialized = False
        if rpc_client is not None:
            await rpc_client.close(RuntimeError("Stagehand closed"), close_transport=False)

    async def _cleanup_failed_create(self, browser: StagehandBrowser) -> None:
        try:
            await self._release_resources()
        finally:
            _release_browser(browser)


_LOG_LEVEL_PRIORITY = {
    "debug": 10,
    "info": 20,
    "warn": 30,
    "error": 40,
    "off": float("inf"),
}


def _is_log_level_enabled(level: str, threshold: str) -> bool:
    return _LOG_LEVEL_PRIORITY[level] >= _LOG_LEVEL_PRIORITY[threshold]


def _render_stagehand_log(notification: StagehandLog, format_: str) -> str:
    data = notification.data.model_dump(mode="json")
    record = {
        "level": notification.level.value,
        "message": notification.message,
        "data": data,
    }
    if format_ == "json":
        return json.dumps(record, separators=(",", ":"))

    suffix = "" if not data else f" {json.dumps(data, separators=(',', ':'))}"
    return f"[stagehand] {notification.level.value.upper()} {notification.message}{suffix}"
