from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Annotated, Any, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ._generated import models as _models
from ._generated.models import (
    LLMMessageGenerateParams,
    LLMMessageGenerateResult,
    LLMStructuredGenerateParams,
    LLMStructuredGenerateResult,
    ModelConfig,
    StagehandLog,
    StagehandResultMetadata,
    TelemetryConfig,
)
from ._validation import WireModel, WireUrl
from .browserbase_session import DEFAULT_BROWSERBASE_URL
from .client_types import Cache as CacheInput

ExtractData = TypeVar("ExtractData", bound=BaseModel)


class DefaultExtract(BaseModel):
    model_config = ConfigDict(extra="forbid")

    extraction: str


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


class CacheOptions(WireModel):
    model_config = ConfigDict(extra="forbid")

    threshold: Annotated[int | None, Field(gt=0)] = None


Cache = bool | CacheOptions


def _cache_config(cache: CacheInput) -> bool | dict[str, int]:
    if isinstance(cache, bool):
        return cache
    return CacheOptions.model_validate(cache).model_dump(exclude_none=True)


class LocalViewport(WireModel):
    model_config = ConfigDict(extra="forbid")

    width: int
    height: int


class LocalBrowserLaunchOptions(WireModel):
    model_config = ConfigDict(extra="forbid", strict=True)

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
    downloads_path: str | None = None
    accept_downloads: bool | None = None
    keep_alive: bool | None = None


class LocalBrowserConnectOptions(WireModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    cdp_url: Annotated[str, Field(min_length=1)]
    extension_id: Annotated[str | None, Field(min_length=1)] = None


class BrowserbaseConnectOptions(WireModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    api_key: Annotated[str, Field(min_length=1)]
    base_url: Annotated[str, Field(min_length=1)] = DEFAULT_BROWSERBASE_URL
    session_id: Annotated[str, Field(min_length=1)]
    extension_id: Annotated[str | None, Field(min_length=1)] = None


class _BrowserbaseSearchOptions(WireModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    api_key: Annotated[str, Field(min_length=1)]
    base_url: Annotated[str, Field(min_length=1)] = DEFAULT_BROWSERBASE_URL
    query: Annotated[str, Field(min_length=1, max_length=200)]
    num_results: Annotated[int | None, Field(ge=1, le=25)] = None


class _BrowserbaseFetchOptions(WireModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    api_key: Annotated[str, Field(min_length=1)]
    base_url: Annotated[str, Field(min_length=1)] = DEFAULT_BROWSERBASE_URL
    url: WireUrl
    allow_insecure_ssl: bool | None = None
    allow_redirects: bool | None = None
    format: Literal["raw", "json", "markdown"] | None = None
    proxies: bool | None = None
    json_schema: dict[str, Any] | None = Field(default=None, alias="schema")

    @model_validator(mode="after")
    def validate_schema_format(self) -> _BrowserbaseFetchOptions:
        if self.json_schema is not None and self.format != "json":
            raise ValueError('schema is only valid when format is "json"')
        if self.format == "json" and self.json_schema is None:
            raise ValueError('schema is required when format is "json"')
        return self


class BrowserbaseSearchResultItem(WireModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    url: str
    author: str | None = None
    favicon: str | None = None
    image: str | None = None
    published_date: str | None = None


class BrowserbaseSearchResult(WireModel):
    model_config = ConfigDict(extra="forbid")

    query: str
    request_id: str
    results: list[BrowserbaseSearchResultItem]


class BrowserbaseFetchResult(WireModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    content: str | dict[str, Any]
    content_type: str
    encoding: str
    headers: dict[str, str]
    status_code: int


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


class StagehandClientCreateConfig(WireModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    api_key: Annotated[str | None, Field(min_length=1)] = None
    api_url: Annotated[str | None, Field(min_length=1)] = None
    model: ModelConfig | ClientLLM | None = None
    telemetry: TelemetryConfig | None = None
    system_prompt: str | None = None
    self_heal: bool | None = None
    dom_settle_timeout_ms: Annotated[
        int | None, Field(gt=0, le=9_007_199_254_740_991, strict=True)
    ] = None
    cache: _models.Caching | None = None
    logging: StagehandClientLoggingConfig = Field(default_factory=StagehandClientLoggingConfig)


StagehandClientCreateConfig.model_rebuild(_types_namespace={**vars(_models), **globals()})


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
