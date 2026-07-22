from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from types import TracebackType
from typing import Literal, Self, overload

from ._generated.models import (
    BrowserbaseBrowserSettings,
    BrowserbaseProxyConfig,
    BrowserbaseRegion,
    ClientModelReference,
    EmptyParams,
    ExternalProxyConfig,
    LLMGenerateParams,
    LLMGenerateResult,
    ModelConfig,
    ProxyConfig,
    StagehandCloseResult,
    StagehandInitParams,
    StagehandInitResult,
    StagehandLog,
    TelemetryConfig,
)
from .browser_context import BrowserContext
from .browser_source import ResolvedBrowserSource, resolve_browser_source
from .client_models import (
    BrowserbaseBrowserSource,
    Cache,
    CdpBrowserSource,
    ClientLLM,
    LLMGenerateCallback,
    LocalBrowserSource,
    LocalProxyConfig,
    LocalViewport,
    StagehandClientInitParams,
    _cache_config,
    _model_config,
)
from .rpc_client import RPCClient, connect_rpc_client

_LOGGER = logging.getLogger("stagehand")


class Stagehand:
    @overload
    def __init__(
        self,
        *,
        browser: Literal["local"],
        api_key: str | None = None,
        args: Sequence[str] | None = None,
        executable_path: str | Path | None = None,
        port: int | None = None,
        user_data_dir: str | Path | None = None,
        preserve_user_data_dir: bool | None = None,
        headless: bool | None = None,
        devtools: bool | None = None,
        chromium_sandbox: bool | None = None,
        ignore_default_args: bool | Sequence[str] | None = None,
        proxy_server: str | None = None,
        proxy_bypass: str | None = None,
        proxy_username: str | None = None,
        proxy_password: str | None = None,
        locale: str | None = None,
        viewport_width: int | None = None,
        viewport_height: int | None = None,
        device_scale_factor: float | None = None,
        has_touch: bool | None = None,
        ignore_https_errors: bool | None = None,
        connect_timeout_ms: int | None = None,
        downloads_path: str | Path | None = None,
        accept_downloads: bool | None = None,
        keep_alive: bool | None = None,
        model: str | LLMGenerateCallback | None = None,
        model_api_key: str | None = None,
        model_base_url: str | None = None,
        model_headers: Mapping[str, str] | None = None,
        telemetry: TelemetryConfig | None = None,
        system_prompt: str | None = None,
        self_heal: bool | None = None,
        dom_settle_timeout_ms: int | None = None,
        cache: Cache | None = None,
    ) -> None: ...

    @overload
    def __init__(
        self,
        *,
        browser: Literal["cdp"],
        cdp_url: str,
        headers: Mapping[str, str] | None = None,
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
    ) -> None: ...

    @overload
    def __init__(
        self,
        *,
        api_key: str,
        browser: Literal["browserbase"] = "browserbase",
        browser_settings: BrowserbaseBrowserSettings | None = None,
        extension_id: str | None = None,
        keep_alive: bool | None = None,
        proxies: bool | Sequence[BrowserbaseProxyConfig | ExternalProxyConfig] | None = None,
        region: BrowserbaseRegion
        | Literal["us-west-2", "us-east-1", "eu-central-1", "ap-southeast-1"]
        | None = None,
        timeout: float | None = None,
        user_metadata: Mapping[str, object] | None = None,
        model: str | LLMGenerateCallback | None = None,
        model_api_key: str | None = None,
        model_base_url: str | None = None,
        model_headers: Mapping[str, str] | None = None,
        telemetry: TelemetryConfig | None = None,
        system_prompt: str | None = None,
        self_heal: bool | None = None,
        dom_settle_timeout_ms: int | None = None,
        cache: Cache | None = None,
    ) -> None: ...

    def __init__(
        self,
        *,
        browser: Literal["browserbase", "local", "cdp"] = "browserbase",
        api_key: str | None = None,
        browser_settings: BrowserbaseBrowserSettings | None = None,
        extension_id: str | None = None,
        proxies: bool | Sequence[BrowserbaseProxyConfig | ExternalProxyConfig] | None = None,
        region: BrowserbaseRegion
        | Literal["us-west-2", "us-east-1", "eu-central-1", "ap-southeast-1"]
        | None = None,
        timeout: float | None = None,
        user_metadata: Mapping[str, object] | None = None,
        args: Sequence[str] | None = None,
        executable_path: str | Path | None = None,
        port: int | None = None,
        user_data_dir: str | Path | None = None,
        preserve_user_data_dir: bool | None = None,
        headless: bool | None = None,
        devtools: bool | None = None,
        chromium_sandbox: bool | None = None,
        ignore_default_args: bool | Sequence[str] | None = None,
        proxy_server: str | None = None,
        proxy_bypass: str | None = None,
        proxy_username: str | None = None,
        proxy_password: str | None = None,
        locale: str | None = None,
        viewport_width: int | None = None,
        viewport_height: int | None = None,
        device_scale_factor: float | None = None,
        has_touch: bool | None = None,
        ignore_https_errors: bool | None = None,
        connect_timeout_ms: int | None = None,
        downloads_path: str | Path | None = None,
        accept_downloads: bool | None = None,
        keep_alive: bool | None = None,
        cdp_url: str | None = None,
        headers: Mapping[str, str] | None = None,
        model: str | LLMGenerateCallback | None = None,
        model_api_key: str | None = None,
        model_base_url: str | None = None,
        model_headers: Mapping[str, str] | None = None,
        telemetry: TelemetryConfig | None = None,
        system_prompt: str | None = None,
        self_heal: bool | None = None,
        dom_settle_timeout_ms: int | None = None,
        cache: Cache | None = None,
    ) -> None:
        if browser == "browserbase":
            browser_source = BrowserbaseBrowserSource.model_validate({
                "type": "browserbase",
                **{
                    name: value
                    for name, value in (
                        ("browser_settings", browser_settings),
                        ("extension_id", extension_id),
                        ("keep_alive", keep_alive),
                        (
                            "proxies",
                            (
                                proxies
                                if isinstance(proxies, bool) or proxies is None
                                else [ProxyConfig(root=proxy) for proxy in proxies]
                            ),
                        ),
                        ("region", region),
                        ("timeout", timeout),
                        (
                            "user_metadata",
                            dict(user_metadata) if user_metadata is not None else None,
                        ),
                    )
                    if value is not None
                },
            })
        elif browser == "local":
            if (viewport_width is None) != (viewport_height is None):
                raise TypeError("viewport_width and viewport_height must be provided together")
            if proxy_server is None and any(
                value is not None for value in (proxy_bypass, proxy_username, proxy_password)
            ):
                raise TypeError("proxy_server is required when configuring a local proxy")
            browser_source = LocalBrowserSource.model_validate({
                "type": "local",
                **{
                    name: value
                    for name, value in (
                        ("args", list(args) if args is not None else None),
                        (
                            "executable_path",
                            str(executable_path) if executable_path is not None else None,
                        ),
                        ("port", port),
                        (
                            "user_data_dir",
                            str(user_data_dir) if user_data_dir is not None else None,
                        ),
                        ("preserve_user_data_dir", preserve_user_data_dir),
                        ("headless", headless),
                        ("devtools", devtools),
                        ("chromium_sandbox", chromium_sandbox),
                        (
                            "ignore_default_args",
                            (
                                list(ignore_default_args)
                                if not isinstance(ignore_default_args, bool)
                                and ignore_default_args is not None
                                else ignore_default_args
                            ),
                        ),
                        (
                            "proxy",
                            (
                                LocalProxyConfig(
                                    server=proxy_server,
                                    bypass=proxy_bypass,
                                    username=proxy_username,
                                    password=proxy_password,
                                )
                                if proxy_server is not None
                                else None
                            ),
                        ),
                        ("locale", locale),
                        (
                            "viewport",
                            (
                                LocalViewport(width=viewport_width, height=viewport_height)
                                if viewport_width is not None and viewport_height is not None
                                else None
                            ),
                        ),
                        ("device_scale_factor", device_scale_factor),
                        ("has_touch", has_touch),
                        ("ignore_https_errors", ignore_https_errors),
                        ("connect_timeout_ms", connect_timeout_ms),
                        (
                            "downloads_path",
                            str(downloads_path) if downloads_path is not None else None,
                        ),
                        ("accept_downloads", accept_downloads),
                        ("keep_alive", keep_alive),
                    )
                    if value is not None
                },
            })
        elif browser == "cdp":
            if cdp_url is None:
                raise TypeError("cdp_url is required when browser='cdp'")
            browser_source = CdpBrowserSource(
                type="cdp",
                cdp_url=cdp_url,
                **({"headers": dict(headers)} if headers is not None else {}),
            )
        else:
            raise ValueError(f"Unsupported browser source: {browser}")

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
            )
            if value is not None
        }
        values["browser"] = browser_source
        if resolved_model is not None:
            values["model"] = resolved_model
        if telemetry is not None:
            values["telemetry"] = telemetry
        self.init_params = StagehandClientInitParams.model_validate(values)
        self._browser_context: BrowserContext | None = None
        self._rpc_client: RPCClient | None = None
        self._remove_notification_listener: Callable[[], None] | None = None
        self._remove_client_llm_handler: Callable[[], None] | None = None
        self.browser: ResolvedBrowserSource | None = None
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
    def initialized(self) -> bool:
        return self._initialized

    async def init(self) -> None:
        async with self._lifecycle_lock:
            if self._initialized:
                return

            browser = await resolve_browser_source(self.init_params)
            self.browser = browser
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
                )
                self._rpc_client = rpc_client
                self._remove_notification_listener = rpc_client.on_notification(
                    "stagehand.log",
                    StagehandLog,
                    _render_stagehand_notification,
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

    async def close(self) -> None:
        async with self._lifecycle_lock:
            try:
                if self._browser_context is not None and self._rpc_client is not None:
                    await self._rpc_client.send(
                        "stagehand.close",
                        EmptyParams(),
                        StagehandCloseResult,
                    )
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

    def _worker_init_params(self) -> StagehandInitParams:
        values = self.init_params.model_dump(
            exclude={"browser", "model"},
            exclude_unset=True,
        )
        if isinstance(self.init_params.model, ClientLLM):
            values["model"] = ClientModelReference(source="client")
        elif self.init_params.model is not None:
            values["model"] = self.init_params.model
        return StagehandInitParams.model_validate(values)

    async def _release_resources(self) -> None:
        if self._remove_client_llm_handler is not None:
            self._remove_client_llm_handler()
            self._remove_client_llm_handler = None
        if self._remove_notification_listener is not None:
            self._remove_notification_listener()
            self._remove_notification_listener = None
        rpc_client = self._rpc_client
        self._rpc_client = None
        browser = self.browser
        self.browser = None
        self._browser_context = None
        self._initialized = False
        try:
            if rpc_client is not None:
                await rpc_client.close()
        finally:
            if browser is not None and not browser.keep_alive:
                await browser.close()


def _render_stagehand_notification(notification: StagehandLog) -> None:
    level = {
        "debug": logging.DEBUG,
        "info": logging.INFO,
        "warn": logging.WARNING,
        "error": logging.ERROR,
    }[notification.level.value]
    _LOGGER.log(level, "%s %s", notification.message, notification.data)
