from __future__ import annotations

import re
from collections.abc import Sequence
from pathlib import Path
from typing import TYPE_CHECKING, Literal, Required, TypeAlias, TypedDict

from ._generated.input_types import (
    ActOptions,
    BrowserbaseBrowserSettings,
    BrowserbaseRegion,
    Caching,
    ExtractOptions,
    ModelConfig,
    ObserveOptions,
    PageScreenshotClip,
    ProxyConfig,
    TelemetryConfig,
)
from .client_models import LLMGenerateCallback, StagehandOnLog

if TYPE_CHECKING:
    from .locator import Locator
    from .page import Page


class LocalProxyConfig(TypedDict, total=False):
    server: Required[str]
    bypass: str
    username: str
    password: str


class BrowserbaseBrowserSource(TypedDict, total=False):
    type: Required[Literal["browserbase"]]
    browser_settings: BrowserbaseBrowserSettings
    extension_id: str
    keep_alive: bool
    proxies: bool | list[ProxyConfig]
    region: BrowserbaseRegion
    timeout: float
    user_metadata: dict[str, object]


class LocalViewport(TypedDict):
    width: int
    height: int


class LocalBrowserSource(TypedDict, total=False):
    type: Required[Literal["local"]]
    args: Sequence[str]
    executable_path: str | Path
    port: int
    user_data_dir: str | Path
    preserve_user_data_dir: bool
    headless: bool
    devtools: bool
    chromium_sandbox: bool
    ignore_default_args: bool | Sequence[str]
    proxy: LocalProxyConfig
    locale: str
    viewport: LocalViewport
    device_scale_factor: float
    has_touch: bool
    ignore_https_errors: bool
    connect_timeout_ms: int
    downloads_path: str | Path
    accept_downloads: bool
    keep_alive: bool


class CdpBrowserSource(TypedDict, total=False):
    type: Required[Literal["cdp"]]
    cdp_url: Required[str]
    headers: dict[str, str]


BrowserSource: TypeAlias = BrowserbaseBrowserSource | LocalBrowserSource | CdpBrowserSource


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
    cache: Caching
    logging: StagehandClientLoggingConfig


class StagehandClientActOptions(ActOptions, total=False):
    page: Page


class StagehandClientObserveOptions(ObserveOptions, total=False):
    page: Page


class StagehandClientExtractOptions(ExtractOptions, total=False):
    page: Page


class ClearCookieOptions(TypedDict, total=False):
    name: str | re.Pattern[str]
    domain: str | re.Pattern[str]
    path: str | re.Pattern[str]


class ScreenshotOptions(TypedDict, total=False):
    animations: Literal["disabled", "allow"]
    caret: Literal["hide", "initial"]
    clip: PageScreenshotClip
    full_page: bool
    path: str | Path
    mask: Sequence[Locator]
    mask_color: str
    omit_background: bool
    quality: int
    scale: Literal["css", "device"]
    style: str
    timeout: float
    type: Literal["png", "jpeg"]
