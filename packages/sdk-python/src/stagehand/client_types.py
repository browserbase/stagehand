"""Public dictionary inputs owned by the Python SDK rather than the wire protocol."""

from collections.abc import Awaitable, Callable
from typing import Literal, NotRequired, TypedDict

from ._generated.input_types import (
    BrowserbaseBrowserSettings,
    BrowserbaseProxyConfig,
    BrowserbaseRegion,
    ExternalProxyConfig,
    ModelConfig,
    ProxyConfig,
    TelemetryConfig,
)
from ._generated.models import (
    LLMMessageGenerateParams,
    LLMMessageGenerateResult,
    LLMStructuredGenerateParams,
    LLMStructuredGenerateResult,
    StagehandLog,
)

LLMGenerateInput = LLMStructuredGenerateParams | LLMMessageGenerateParams
LLMGenerateOutput = LLMStructuredGenerateResult | LLMMessageGenerateResult
LLMGenerateCallback = Callable[[LLMGenerateInput], Awaitable[LLMGenerateOutput]]
StagehandOnLog = Callable[[StagehandLog], None | Awaitable[None]]


class LocalProxyConfig(TypedDict):
    server: str
    bypass: NotRequired[str]
    username: NotRequired[str]
    password: NotRequired[str]


class BrowserbaseBrowserSource(TypedDict):
    type: Literal["browserbase"]
    browser_settings: NotRequired[BrowserbaseBrowserSettings]
    extension_id: NotRequired[str]
    keep_alive: NotRequired[bool]
    proxies: NotRequired[bool | list[ProxyConfig]]
    region: NotRequired[BrowserbaseRegion]
    timeout: NotRequired[float]
    user_metadata: NotRequired[dict[str, object]]


class CacheOptions(TypedDict, total=False):
    threshold: int


Cache = bool | CacheOptions


class LocalViewport(TypedDict):
    width: int
    height: int


class LocalBrowserSource(TypedDict):
    type: Literal["local"]
    args: NotRequired[list[str]]
    executable_path: NotRequired[str]
    port: NotRequired[int]
    user_data_dir: NotRequired[str]
    preserve_user_data_dir: NotRequired[bool]
    headless: NotRequired[bool]
    devtools: NotRequired[bool]
    chromium_sandbox: NotRequired[bool]
    ignore_default_args: NotRequired[bool | list[str]]
    proxy: NotRequired[LocalProxyConfig]
    locale: NotRequired[str]
    viewport: NotRequired[LocalViewport]
    device_scale_factor: NotRequired[float]
    has_touch: NotRequired[bool]
    ignore_https_errors: NotRequired[bool]
    connect_timeout_ms: NotRequired[int]
    downloads_path: NotRequired[str]
    accept_downloads: NotRequired[bool]
    keep_alive: NotRequired[bool]


class CdpBrowserSource(TypedDict):
    type: Literal["cdp"]
    cdp_url: str
    headers: NotRequired[dict[str, str]]


BrowserSource = BrowserbaseBrowserSource | LocalBrowserSource | CdpBrowserSource


class ClientLLM(TypedDict):
    generate: LLMGenerateCallback


class StagehandClientLoggingConfig(TypedDict, total=False):
    level: Literal["off", "error", "warn", "info", "debug"]
    format: Literal["pretty", "json"]
    on_log: StagehandOnLog


class StagehandClientInitParams(TypedDict, total=False):
    api_key: str
    browser: BrowserSource
    model: ModelConfig | ClientLLM
    telemetry: TelemetryConfig
    system_prompt: str
    self_heal: bool
    dom_settle_timeout_ms: int
    cache: Cache
    logging: StagehandClientLoggingConfig


__all__ = [
    "BrowserSource",
    "BrowserbaseBrowserSettings",
    "BrowserbaseBrowserSource",
    "BrowserbaseProxyConfig",
    "BrowserbaseRegion",
    "Cache",
    "CacheOptions",
    "CdpBrowserSource",
    "ClientLLM",
    "ExternalProxyConfig",
    "LLMGenerateCallback",
    "LLMGenerateInput",
    "LLMGenerateOutput",
    "LocalBrowserSource",
    "LocalProxyConfig",
    "LocalViewport",
    "StagehandClientInitParams",
    "StagehandClientLoggingConfig",
    "StagehandOnLog",
]
