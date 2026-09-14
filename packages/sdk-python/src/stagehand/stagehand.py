from __future__ import annotations

import asyncio
import builtins
import inspect
import json
import sys
from collections.abc import Callable, Mapping
from typing import TypeVar, cast, overload

from pydantic import BaseModel

from . import client_models as _client_models
from ._generated import models as _models
from ._generated.input_types import Action as ActionInput
from ._generated.input_types import Locator as ProtocolLocator
from ._generated.input_types import ModelConfig, TelemetryConfig, Variables
from ._generated.models import (
    Action,
    ActOptions,
    ActResult,
    CallbackBatchOptions,
    CallbackBatchParams,
    CallbackBatchResult,
    ClientModelReference,
    EmptyParams,
    ExtractOptions,
    FieldSchema0,
    LLMGenerateParams,
    LLMGenerateResult,
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
)
from ._generated.protocol_version import STAGEHAND_PROTOCOL_VERSION
from ._sdk_identity import STAGEHAND_SDK_CLIENT_INFO
from .browser import (
    StagehandBrowser,
    _attach_browser_context,
    _claim_browser,
    _ClaimedBrowser,
    _detach_browser_context,
    _invalidate_browser,
    _release_browser,
)
from .browser_context import BrowserContext
from .cdp_client import CDPConnectionClosedError
from .client_models import (
    DefaultExtract,
    ExtractResult,
    _cache_config,
    _ExtractWireResult,
    _model_config,
)
from .client_types import Cache, LLMGenerateCallback, StagehandClientLoggingConfig
from .locator import Locator
from .page import Page
from .rpc_client import RPCClient, RPCError
from .timeouts import with_stagehand_init_deadline

ResultModel = TypeVar("ResultModel", bound=BaseModel)
_CONSTRUCTION_TOKEN = object()
_UNSET_BATCH_INPUT = object()
_MAX_CALLBACK_BATCH_TIMEOUT_MS = 2_147_483_647 - 10_000
_UNAVAILABLE_MESSAGE = (
    "Stagehand is unavailable. Create a new instance with await Stagehand.create()."
)


def _serialize_locator(locator: Locator, page_id: str, method: str) -> ProtocolLocator:
    if locator.page_id != page_id:
        raise TypeError(f"{method}() locator must belong to the target page")
    if locator.nth_index is not None:
        return ProtocolLocator(selector=locator.selector, nth=locator.nth_index)
    return ProtocolLocator(selector=locator.selector)


def _serialize_locators(
    locators: list[Locator] | None,
    page_id: str,
    method: str,
) -> list[ProtocolLocator] | None:
    if locators is None:
        return None
    return [_serialize_locator(locator, page_id, method) for locator in locators]


class Stagehand:
    def __init__(
        self,
        *,
        _token: object | None = None,
        browser: StagehandBrowser | None = None,
        create_config: _client_models.StagehandClientCreateConfig | None = None,
    ) -> None:
        if _token is not _CONSTRUCTION_TOKEN or browser is None or create_config is None:
            raise TypeError(
                "Stagehand cannot be constructed directly; use await Stagehand.create()"
            )
        self._browser_handle = browser
        self._create_config = create_config
        self._rpc_client: RPCClient | None = None
        self._remove_notification_listener: Callable[[], None] | None = None
        self._remove_client_llm_handler: Callable[[], None] | None = None
        self._initialized = False
        self._init_request_started = False
        self._close_task: asyncio.Task[None] | None = None

    @classmethod
    async def create(
        cls,
        *,
        browser: StagehandBrowser,
        api_key: str | None = None,
        api_url: str | None = None,
        model: str | LLMGenerateCallback | None = None,
        model_api_key: str | None = None,
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
        model_connection_options = (model_api_key, model_headers)
        if model is None and any(value is not None for value in model_connection_options):
            raise TypeError("model connection options require a model name")
        if callable(model) and any(value is not None for value in model_connection_options):
            raise TypeError("model connection options cannot be used with an LLM callback")

        resolved_model: _models.ModelConfig | _client_models.ClientLLM | None
        if isinstance(model, str):
            resolved_model = _model_config(
                model,
                api_key=model_api_key,
                headers=dict(model_headers) if model_headers is not None else None,
            )
        elif model is not None:
            resolved_model = _client_models.ClientLLM(generate=model)
        else:
            resolved_model = None

        values: dict[str, object] = {
            name: value
            for name, value in (
                ("api_key", api_key),
                ("api_url", api_url),
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
        create_config = _client_models.StagehandClientCreateConfig.model_validate(values)
        claimed = _claim_browser(browser)
        stagehand = cls(
            _token=_CONSTRUCTION_TOKEN,
            browser=browser,
            create_config=create_config,
        )
        try:
            await with_stagehand_init_deadline(stagehand._initialize(claimed))
        except BaseException as error:
            fail_closed = stagehand._initialization_failure_is_ambiguous(error)
            await asyncio.shield(stagehand._cleanup_failed_create(browser, fail_closed=fail_closed))
            raise
        return stagehand

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

    async def experimental_batch(
        self,
        source: str,
        input: object = _UNSET_BATCH_INPUT,
        *,
        timeout: int = 30_000,
        page: Page | None = None,
    ) -> object:
        """Run trusted JavaScript against the worker-local Stagehand object model."""
        if not isinstance(source, str) or not source.strip():
            raise TypeError("source must be a non-empty JavaScript string")
        if isinstance(timeout, bool) or not isinstance(timeout, int) or timeout <= 0:
            raise ValueError("timeout must be a positive number of milliseconds")
        if timeout > _MAX_CALLBACK_BATCH_TIMEOUT_MS:
            raise ValueError(
                f"timeout must not exceed {_MAX_CALLBACK_BATCH_TIMEOUT_MS} milliseconds"
            )
        input_model: _models.FieldSchema2 | None = None
        if input is not _UNSET_BATCH_INPUT:
            try:
                serialized_input = json.dumps(input, allow_nan=False)
                input_model = _models.FieldSchema2.model_validate_json(
                    serialized_input,
                    strict=True,
                )
            except (TypeError, ValueError) as error:
                raise TypeError("input must be JSON-serializable") from error
        options_model = CallbackBatchOptions(
            **({"page_id": page.page_id} if page is not None else {}),
            timeout=timeout,
        )
        params = (
            CallbackBatchParams(
                callback_source=source,
                options=options_model,
            )
            if input is _UNSET_BATCH_INPUT
            else CallbackBatchParams(
                callback_source=source,
                input=input_model,
                options=options_model,
            )
        )
        result = await self._connected_rpc_client.send(
            "stagehand.callback_batch",
            params,
            CallbackBatchResult,
        )
        return (
            result.value.model_dump(mode="json")
            if isinstance(result.value, BaseModel)
            else result.value
        )

    async def _initialize(self, claimed: _ClaimedBrowser) -> None:
        rpc_client = RPCClient(claimed.cdp_client)
        self._rpc_client = rpc_client
        self._remove_notification_listener = rpc_client.on_notification(
            "stagehand.log",
            StagehandLog,
            self._handle_stagehand_notification,
        )
        client_llm = self._create_config.model
        if isinstance(client_llm, _client_models.ClientLLM):

            async def generate(params: LLMGenerateParams) -> LLMGenerateResult:
                return LLMGenerateResult(root=await client_llm.generate(params.root))

            self._remove_client_llm_handler = rpc_client.on_request(
                "llm.generate",
                LLMGenerateParams,
                LLMGenerateResult,
                generate,
            )

        init_params = self._worker_init_params(claimed)
        self._init_request_started = True
        await rpc_client.send(
            "stagehand.init",
            init_params,
            StagehandInitResult,
        )
        _attach_browser_context(
            self._browser_handle,
            BrowserContext(rpc_client, self._browser_handle.close),
        )
        self._initialized = True

    async def act(
        self,
        instruction: str | ActionInput | Action,
        *,
        page: Page | None = None,
        model: ModelConfig | None = None,
        variables: Variables | None = None,
        timeout: float | None = None,
        locator: Locator | None = None,
        ignore_locators: list[Locator] | None = None,
        cache: Cache | None = None,
    ) -> ActResult:
        target_page = page or await self.browser.context.active_page()
        if target_page is None:
            raise RuntimeError("Stagehand has no active page")
        options = ActOptions.model_validate({
            name: value
            for name, value in (
                ("model", model),
                ("variables", variables),
                ("timeout", timeout),
                (
                    "locator",
                    _serialize_locator(locator, target_page.page_id, "act")
                    if locator is not None
                    else None,
                ),
                (
                    "ignore_locators",
                    _serialize_locators(ignore_locators, target_page.page_id, "act"),
                ),
                ("cache", _cache_config(cache) if cache is not None else None),
            )
            if value is not None
        })
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
        instruction: str | None = None,
        *,
        page: Page | None = None,
        model: ModelConfig | None = None,
        variables: Variables | None = None,
        timeout: float | None = None,
        locator: Locator | None = None,
        ignore_locators: list[Locator] | None = None,
        cache: Cache | None = None,
    ) -> ObserveResult:
        target_page = page or await self.browser.context.active_page()
        if target_page is None:
            raise RuntimeError("Stagehand has no active page")
        options = ObserveOptions.model_validate({
            name: value
            for name, value in (
                ("model", model),
                ("variables", variables),
                ("timeout", timeout),
                (
                    "locator",
                    _serialize_locator(locator, target_page.page_id, "observe")
                    if locator is not None
                    else None,
                ),
                (
                    "ignore_locators",
                    _serialize_locators(ignore_locators, target_page.page_id, "observe"),
                ),
                ("cache", _cache_config(cache) if cache is not None else None),
            )
            if value is not None
        })
        params = StagehandObserveParams(page_id=target_page.page_id, instruction=instruction)
        if options.model_fields_set:
            params.options = options
        result = await self._connected_rpc_client.send("stagehand.observe", params, ObserveResult)
        return result

    @overload
    async def extract(
        self,
        instruction: str,
        schema: builtins.type[DefaultExtract] = DefaultExtract,
        *,
        page: Page | None = None,
        model: ModelConfig | None = None,
        timeout: float | None = None,
        screenshot: bool | None = None,
        locator: Locator | None = None,
        ignore_locators: list[Locator] | None = None,
        cache: Cache | None = None,
    ) -> ExtractResult[DefaultExtract]: ...

    @overload
    async def extract(
        self,
        instruction: str,
        schema: builtins.type[ResultModel],
        *,
        page: Page | None = None,
        model: ModelConfig | None = None,
        timeout: float | None = None,
        screenshot: bool | None = None,
        locator: Locator | None = None,
        ignore_locators: list[Locator] | None = None,
        cache: Cache | None = None,
    ) -> ExtractResult[ResultModel]: ...

    async def extract(
        self,
        instruction: str,
        schema: builtins.type[ResultModel] = cast(builtins.type[ResultModel], DefaultExtract),
        *,
        page: Page | None = None,
        model: ModelConfig | None = None,
        timeout: float | None = None,
        screenshot: bool | None = None,
        locator: Locator | None = None,
        ignore_locators: list[Locator] | None = None,
        cache: Cache | None = None,
    ) -> ExtractResult[ResultModel]:
        target_page = page or await self.browser.context.active_page()
        if target_page is None:
            raise RuntimeError("Stagehand has no active page")
        options = ExtractOptions.model_validate({
            name: value
            for name, value in (
                ("model", model),
                ("timeout", timeout),
                ("screenshot", screenshot),
                (
                    "locator",
                    _serialize_locator(locator, target_page.page_id, "extract")
                    if locator is not None
                    else None,
                ),
                (
                    "ignore_locators",
                    _serialize_locators(ignore_locators, target_page.page_id, "extract"),
                ),
                ("cache", _cache_config(cache) if cache is not None else None),
            )
            if value is not None
        })
        params = StagehandExtractParams(
            page_id=target_page.page_id,
            instruction=instruction,
        )
        if schema is not DefaultExtract:
            params.schema_ = FieldSchema0.model_validate(schema.model_json_schema())
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
        async def close_impl() -> None:
            release_browser_claim = not self._initialized
            try:
                if self._initialized and self._rpc_client is not None:
                    try:
                        await self._rpc_client.send(
                            "stagehand.close",
                            EmptyParams(),
                            StagehandCloseResult,
                        )
                        release_browser_claim = True
                    except CDPConnectionClosedError:
                        release_browser_claim = True
            finally:
                try:
                    await asyncio.shield(self._release_resources())
                finally:
                    if release_browser_claim:
                        _release_browser(self._browser_handle)

        if self._close_task is None:
            self._close_task = asyncio.create_task(
                close_impl(),
                name="stagehand-close",
            )
        await asyncio.shield(self._close_task)

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
        if isinstance(self._create_config.model, _client_models.ClientLLM):
            values["model"] = ClientModelReference(source="client")
        elif self._create_config.model is not None:
            values["model"] = self._create_config.model
        values["protocol_version"] = STAGEHAND_PROTOCOL_VERSION
        values["client_info"] = STAGEHAND_SDK_CLIENT_INFO
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
        _detach_browser_context(self._browser_handle)
        self._initialized = False
        if rpc_client is not None:
            await rpc_client.close(RuntimeError("Stagehand closed"), close_transport=False)

    def _initialization_failure_is_ambiguous(self, error: BaseException) -> bool:
        if isinstance(error, (asyncio.CancelledError, TimeoutError)):
            return True
        return self._init_request_started and not isinstance(error, RPCError)

    async def _cleanup_failed_create(
        self,
        browser: StagehandBrowser,
        *,
        fail_closed: bool,
    ) -> None:
        if fail_closed:
            browser_invalidation = _invalidate_browser(browser)
            try:
                await self._release_resources()
            finally:
                await browser_invalidation
            return

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
