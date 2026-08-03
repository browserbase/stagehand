from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Annotated, Any, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ._generated import models as _models
from ._generated.models import (
    BrowserbaseBrowserSettings,
    BrowserbaseRegion,
    LLMMessageGenerateParams,
    LLMMessageGenerateResult,
    LLMStructuredGenerateParams,
    LLMStructuredGenerateResult,
    ModelConfig,
    ProxyConfig,
    StagehandLog,
    StagehandResultMetadata,
    TelemetryConfig,
)
from ._validation import WireModel

ExtractData = TypeVar("ExtractData", bound=BaseModel)


class ExtractResult(WireModel, Generic[ExtractData]):
    model_config = ConfigDict(extra="forbid")

    data: ExtractData
    metadata: StagehandResultMetadata


class _ExtractWireResult(WireModel):
    """Internal extract response model that preserves arbitrary JSON values."""

    model_config = ConfigDict(extra="forbid")

    data: Any
    metadata: StagehandResultMetadata


class LocalProxyConfig(WireModel):
    model_config = ConfigDict(extra="forbid")

    server: str
    bypass: str | None = None
    username: str | None = None
    password: str | None = None


class BrowserbaseBrowserSource(WireModel):
    """Browserbase session options accepted before the SDK creates a session."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["browserbase"]
    browser_settings: BrowserbaseBrowserSettings | None = None
    extension_id: str | None = None
    keep_alive: bool | None = None
    proxies: bool | list[ProxyConfig] | None = None
    region: BrowserbaseRegion | None = None
    timeout: float | None = None
    user_metadata: dict[str, object] | None = None


class CacheOptions(WireModel):
    model_config = ConfigDict(extra="forbid")

    threshold: Annotated[int | None, Field(gt=0)] = None


Cache = bool | CacheOptions


def _cache_config(cache: Cache) -> bool | dict[str, int]:
    if isinstance(cache, CacheOptions):
        return cache.model_dump(exclude_none=True)
    return cache


class LocalViewport(WireModel):
    model_config = ConfigDict(extra="forbid")

    width: int
    height: int


class LocalBrowserSource(WireModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["local"]
    args: list[str] | None = None
    executable_path: str | None = None
    port: Annotated[int | None, Field(ge=1, le=65_535)] = None
    user_data_dir: str | None = None
    preserve_user_data_dir: bool | None = None
    headless: bool | None = None
    devtools: bool | None = None
    chromium_sandbox: bool | None = None
    ignore_default_args: bool | list[str] | None = None
    proxy: LocalProxyConfig | None = None
    locale: str | None = None
    viewport: LocalViewport | None = None
    device_scale_factor: float | None = None
    has_touch: bool | None = None
    ignore_https_errors: bool | None = None
    connect_timeout_ms: Annotated[int | None, Field(gt=0)] = None
    downloads_path: str | None = None
    accept_downloads: bool | None = None
    keep_alive: bool | None = None


class CdpBrowserSource(WireModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["cdp"]
    cdp_url: Annotated[str, Field(min_length=1)]
    headers: dict[str, str] | None = None


BrowserSource = Annotated[
    BrowserbaseBrowserSource | LocalBrowserSource | CdpBrowserSource,
    Field(discriminator="type"),
]

LLMGenerateInput = LLMStructuredGenerateParams | LLMMessageGenerateParams
LLMGenerateOutput = LLMStructuredGenerateResult | LLMMessageGenerateResult
LLMGenerateCallback = Callable[[LLMGenerateInput], Awaitable[LLMGenerateOutput]]
StagehandOnLog = Callable[[StagehandLog], None | Awaitable[None]]


class ClientLLM(WireModel):
    model_config = ConfigDict(extra="forbid")

    generate: LLMGenerateCallback


class StagehandClientLoggingConfig(WireModel):
    model_config = ConfigDict(extra="forbid")

    level: Literal["off", "error", "warn", "info", "debug"] = "info"
    format: Literal["pretty", "json"] = "pretty"
    on_log: StagehandOnLog | None = None


class StagehandClientInitParams(WireModel):
    model_config = ConfigDict(extra="forbid")

    api_key: Annotated[str | None, Field(min_length=1)] = None
    browser: BrowserSource = BrowserbaseBrowserSource(type="browserbase")
    model: ModelConfig | ClientLLM | None = None
    telemetry: TelemetryConfig | None = None
    system_prompt: str | None = None
    self_heal: bool | None = None
    dom_settle_timeout_ms: Annotated[
        int | None, Field(gt=0, le=9_007_199_254_740_991, strict=True)
    ] = None
    cache: _models.Caching | None = None
    logging: StagehandClientLoggingConfig = Field(default_factory=StagehandClientLoggingConfig)

    @model_validator(mode="after")
    def require_browserbase_api_key(self) -> StagehandClientInitParams:
        if self.browser.type == "browserbase" and self.api_key is None:
            raise ValueError("A Browserbase API key is required for the Browserbase browser source")
        return self


StagehandClientInitParams.model_rebuild(_types_namespace={**vars(_models), **globals()})


def _model_config(
    model: str,
    *,
    api_key: str | None = None,
    headers: dict[str, str] | None = None,
) -> ModelConfig:
    connection: dict[str, object] = {
        name: value
        for name, value in (("api_key", api_key), ("headers", headers))
        if value is not None
    }
    return ModelConfig.model_validate({"model_name": model, **connection})
