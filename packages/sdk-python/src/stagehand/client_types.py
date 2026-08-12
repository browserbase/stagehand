"""Public dictionary inputs owned by the Python SDK rather than the wire protocol."""

from collections.abc import Awaitable, Callable
from typing import Literal, NotRequired, TypedDict

from ._generated.input_types import (
    ModelConfig,
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


class CacheOptions(TypedDict, total=False):
    threshold: int


Cache = bool | CacheOptions


class LocalViewport(TypedDict):
    width: int
    height: int


class LocalBrowserLaunchOptions(TypedDict, total=False):
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
    downloads_path: NotRequired[str]
    accept_downloads: NotRequired[bool]
    keep_alive: NotRequired[bool]


class LocalBrowserConnectOptions(TypedDict):
    cdp_url: str
    extension_id: NotRequired[str]


class BrowserbaseConnectOptions(TypedDict):
    api_key: str
    base_url: NotRequired[str]
    session_id: str
    extension_id: NotRequired[str]


class ClientLLM(TypedDict):
    generate: LLMGenerateCallback


class StagehandClientLoggingConfig(TypedDict, total=False):
    level: Literal["off", "error", "warn", "info", "debug"]
    format: Literal["pretty", "json"]
    on_log: StagehandOnLog


class StagehandClientCreateConfig(TypedDict, total=False):
    api_key: str
    api_url: str
    model: ModelConfig | ClientLLM
    telemetry: TelemetryConfig
    system_prompt: str
    self_heal: bool
    dom_settle_timeout_ms: int
    cache: Cache
    logging: StagehandClientLoggingConfig


__all__ = [
    "BrowserbaseConnectOptions",
    "Cache",
    "CacheOptions",
    "ClientLLM",
    "LLMGenerateCallback",
    "LLMGenerateInput",
    "LLMGenerateOutput",
    "LocalBrowserConnectOptions",
    "LocalBrowserLaunchOptions",
    "LocalProxyConfig",
    "LocalViewport",
    "StagehandClientCreateConfig",
    "StagehandClientLoggingConfig",
    "StagehandOnLog",
]
