from __future__ import annotations

import asyncio
import builtins
import inspect
import json
import sys
from collections.abc import Callable
from pathlib import Path
from types import TracebackType
from typing import Self, TypeVar, cast

from pydantic import BaseModel

from ._generated.models import (
    Action,
    ActResult,
    BrowserGetVersionResult,
    ClientModelReference,
    EmptyParams,
    LLMGenerateParams,
    LLMGenerateResult,
    ObserveResult,
    RuntimeLoopbackStatusResult,
    StagehandActParams,
    StagehandCloseResult,
    StagehandExtractParams,
    StagehandInitParams,
    StagehandInitResult,
    StagehandLog,
    StagehandMetrics,
    StagehandObserveParams,
    StagehandPingResult,
)
from .browser_context import BrowserContext
from .browser_source import ResolvedBrowserSource, resolve_browser_source
from .cdp_client import CDPConnectionClosedError
from .client_models import (
    ClientLLM,
    ExtractResult,
    _ExtractWireResult,
)
from .client_models import (
    StagehandClientInitParams as _StagehandClientInitParams,
)
from .client_types import (
    StagehandClientActOptions,
    StagehandClientExtractOptions,
    StagehandClientInitParams,
    StagehandClientObserveOptions,
)
from .page import Page
from .rpc_client import RPCClient, connect_rpc_client

ResultModel = TypeVar("ResultModel", bound=BaseModel)


class Stagehand:
    def __init__(self, options: StagehandClientInitParams) -> None:
        self.init_params = _StagehandClientInitParams.model_validate(options)
        self._browser_context: BrowserContext | None = None
        self._rpc_client: RPCClient | None = None
        self._remove_notification_listener: Callable[[], None] | None = None
        self._remove_client_llm_handler: Callable[[], None] | None = None
        self._browser: ResolvedBrowserSource | None = None
        self._initialized = False
        self._lifecycle_lock = asyncio.Lock()

    @property
    def context(self) -> BrowserContext:
        if self._browser_context is None:
            raise RuntimeError(
                "Stagehand is not initialized. Call stagehand.init() before using context."
            )
        return self._browser_context

    @property
    def browser(self) -> ResolvedBrowserSource:
        if self._browser is None:
            raise RuntimeError(
                "Stagehand is not initialized. Call stagehand.init() before using browser."
            )
        return self._browser

    @property
    def initialized(self) -> bool:
        return self._initialized

    async def ping(self) -> StagehandPingResult:
        return await self._connected_rpc_client.send(
            "ping",
            EmptyParams(),
            StagehandPingResult,
        )

    async def runtime_loopback_status(self) -> RuntimeLoopbackStatusResult:
        return await self._connected_rpc_client.send(
            "runtime.loopback_status",
            EmptyParams(),
            RuntimeLoopbackStatusResult,
        )

    async def browser_get_version(self) -> BrowserGetVersionResult:
        return await self._connected_rpc_client.send(
            "browser.get_version",
            EmptyParams(),
            BrowserGetVersionResult,
        )

    async def metrics(self) -> StagehandMetrics:
        return await self._connected_rpc_client.send(
            "stagehand.metrics",
            EmptyParams(),
            StagehandMetrics,
        )

    async def init(self) -> None:
        async with self._lifecycle_lock:
            if self._initialized:
                return

            browser = await resolve_browser_source(self.init_params)
            self._browser = browser
            extension_dir = Path(__file__).with_name("_extension")
            if not (extension_dir / "manifest.json").is_file():
                extension_dir = Path(__file__).resolve().parents[3] / "server" / "dist"

            try:
                rpc_client = await connect_rpc_client(
                    cdp_url=browser.cdp_url,
                    extension_dir=str(extension_dir),
                    service_worker_url_includes="service-worker.js",
                    cdp_connect_timeout_ms=browser.connect_timeout_ms or 10_000,
                    telemetry=self.init_params.telemetry,
                    log_level=self.init_params.logging.level,
                )
                self._rpc_client = rpc_client
                self._remove_notification_listener = rpc_client.on_notification(
                    "stagehand.log",
                    StagehandLog,
                    self._handle_stagehand_notification,
                )
                client_llm = self.init_params.model
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
                    self._worker_init_params(),
                    StagehandInitResult,
                )
                self._browser_context = BrowserContext(rpc_client)
            except BaseException:
                await asyncio.shield(self._release_resources())
                raise

            self._initialized = True

    async def act(
        self,
        input: str | Action,
        options: StagehandClientActOptions | None = None,
    ) -> ActResult:
        protocol_options = dict(options or {})
        page = cast(Page | None, protocol_options.pop("page", None))
        target_page = page or await self.context.active_page()
        if target_page is None:
            raise RuntimeError("Stagehand has no active page")
        params = StagehandActParams.model_validate({
            "page_id": target_page.page_id,
            "input": input,
            **({"options": protocol_options} if protocol_options else {}),
        })
        result = await self._connected_rpc_client.send("stagehand.act", params, ActResult)
        return result

    async def observe(
        self,
        instruction: str | None = None,
        options: StagehandClientObserveOptions | None = None,
    ) -> ObserveResult:
        protocol_options = dict(options or {})
        page = cast(Page | None, protocol_options.pop("page", None))
        target_page = page or await self.context.active_page()
        if target_page is None:
            raise RuntimeError("Stagehand has no active page")
        params = StagehandObserveParams.model_validate({
            "page_id": target_page.page_id,
            **({"instruction": instruction} if instruction is not None else {}),
            **({"options": protocol_options} if protocol_options else {}),
        })
        result = await self._connected_rpc_client.send("stagehand.observe", params, ObserveResult)
        return result

    async def extract(
        self,
        instruction: str,
        schema: builtins.type[ResultModel],
        options: StagehandClientExtractOptions | None = None,
    ) -> ExtractResult[ResultModel]:
        protocol_options = dict(options or {})
        page = cast(Page | None, protocol_options.pop("page", None))
        target_page = page or await self.context.active_page()
        if target_page is None:
            raise RuntimeError("Stagehand has no active page")
        params = StagehandExtractParams.model_validate({
            "page_id": target_page.page_id,
            "instruction": instruction,
            "schema": schema.model_json_schema(),
            **({"options": protocol_options} if protocol_options else {}),
        })
        result = await self._connected_rpc_client.send(
            "stagehand.extract", params, _ExtractWireResult
        )
        return ExtractResult(
            data=schema.model_validate(result.data),
            metadata=result.metadata,
        )

    async def close(self) -> None:
        async with self._lifecycle_lock:
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

    async def __aenter__(self) -> Self:
        await self.init()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.close()

    @property
    def _connected_rpc_client(self) -> RPCClient:
        if not self._initialized or self._rpc_client is None:
            raise RuntimeError(
                "Stagehand is not initialized. Call stagehand.init() before using it."
            )
        return self._rpc_client

    def _worker_init_params(self) -> StagehandInitParams:
        values = self.init_params.model_dump(
            exclude={"browser", "logging", "model"},
            exclude_unset=True,
        )
        if isinstance(self.init_params.model, ClientLLM):
            values["model"] = ClientModelReference(source="client")
        elif self.init_params.model is not None:
            values["model"] = self.init_params.model
        return StagehandInitParams.model_validate(values)

    async def _handle_stagehand_notification(self, notification: StagehandLog) -> None:
        logging = self.init_params.logging
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
        browser = self._browser
        self._browser = None
        self._browser_context = None
        self._initialized = False
        try:
            if rpc_client is not None:
                await rpc_client.close()
        finally:
            if browser is not None and not browser.keep_alive:
                await browser.close()


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
