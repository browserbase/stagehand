from __future__ import annotations

import json
import math
import os
from collections.abc import Mapping
from types import TracebackType
from typing import Annotated, Literal, Self, TypeVar
from urllib.parse import quote

import httpx
from pydantic import BaseModel, ConfigDict, Field, JsonValue, WebsocketUrl, field_validator

_DEFAULT_BROWSERBASE_API_URL = "https://api.browserbase.com"
_DEFAULT_BROWSERBASE_API_TIMEOUT_SECONDS = 60.0
_STAGEHAND_EXTENSION_FILE_NAME = "stagehand-extension.zip"

_ResponseModel = TypeVar("_ResponseModel", bound=BaseModel)

BrowserbaseRegion = Literal[
    "us-west-2",
    "us-east-1",
    "eu-central-1",
    "ap-southeast-1",
]


def _to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class _BrowserbaseRequest(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        extra="forbid",
        serialize_by_alias=True,
        strict=True,
        validate_by_alias=True,
        validate_by_name=True,
    )


class _BrowserbaseResponse(BaseModel):
    # Browserbase may add response fields without changing the fields Stagehand consumes.
    model_config = ConfigDict(
        alias_generator=_to_camel,
        extra="allow",
        serialize_by_alias=True,
        strict=True,
        validate_by_alias=True,
        validate_by_name=True,
    )


class BrowserbaseExtensionUploadRequest(_BrowserbaseRequest):
    archive: bytes = Field(min_length=1, exclude=True)
    file_name: str = Field(default=_STAGEHAND_EXTENSION_FILE_NAME, min_length=1, exclude=True)

    @field_validator("file_name")
    @classmethod
    def validate_file_name(cls, value: str) -> str:
        if value.strip() == "":
            raise ValueError("extension filename cannot be empty")
        return value


class BrowserbaseExtensionDeleteRequest(_BrowserbaseRequest):
    extension_id: str = Field(min_length=1, exclude=True)

    @field_validator("extension_id")
    @classmethod
    def validate_extension_id(cls, value: str) -> str:
        value = value.strip()
        if value == "":
            raise ValueError("extension ID cannot be empty")
        return value


class BrowserbaseViewportRequest(_BrowserbaseRequest):
    width: float | None = None
    height: float | None = None


class BrowserbaseFingerprintScreenRequest(_BrowserbaseRequest):
    max_height: float | None = None
    max_width: float | None = None
    min_height: float | None = None
    min_width: float | None = None


class BrowserbaseFingerprintRequest(_BrowserbaseRequest):
    browsers: list[Literal["chrome", "edge", "firefox", "safari"]] | None = None
    devices: list[Literal["desktop", "mobile"]] | None = None
    http_version: Literal["1", "2"] | None = None
    locales: list[str] | None = None
    operating_systems: list[Literal["android", "ios", "linux", "macos", "windows"]] | None = None
    screen: BrowserbaseFingerprintScreenRequest | None = None


class BrowserbaseContextRequest(_BrowserbaseRequest):
    id: str = Field(min_length=1)
    persist: bool | None = None


class BrowserbaseBrowserSettingsRequest(_BrowserbaseRequest):
    advanced_stealth: bool | None = None
    block_ads: bool | None = None
    captcha_image_selector: str | None = None
    captcha_input_selector: str | None = None
    context: BrowserbaseContextRequest | None = None
    extension_id: str | None = None
    fingerprint: BrowserbaseFingerprintRequest | None = None
    log_session: bool | None = None
    os: Literal["windows", "mac", "linux", "mobile", "tablet"] | None = None
    record_session: bool | None = None
    solve_captchas: bool | None = None
    verified: bool | None = None
    viewport: BrowserbaseViewportRequest | None = None

    @field_validator("extension_id")
    @classmethod
    def validate_extension_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if value == "":
            raise ValueError("extension ID cannot be empty")
        return value


class BrowserbaseProxyGeolocationRequest(_BrowserbaseRequest):
    country: str = Field(min_length=1)
    city: str | None = None
    state: str | None = None


class BrowserbaseManagedProxyRequest(_BrowserbaseRequest):
    type: Literal["browserbase"]
    domain_pattern: str | None = None
    geolocation: BrowserbaseProxyGeolocationRequest | None = None


class BrowserbaseExternalProxyRequest(_BrowserbaseRequest):
    type: Literal["external"]
    server: str = Field(min_length=1)
    domain_pattern: str | None = None
    username: str | None = None
    password: str | None = None


BrowserbaseProxyRequest = Annotated[
    BrowserbaseManagedProxyRequest | BrowserbaseExternalProxyRequest,
    Field(discriminator="type"),
]


class BrowserbaseSessionCreateRequest(_BrowserbaseRequest):
    browser_settings: BrowserbaseBrowserSettingsRequest | None = None
    extension_id: str | None = None
    keep_alive: bool | None = None
    proxies: bool | list[BrowserbaseProxyRequest] | None = None
    region: BrowserbaseRegion | None = None
    timeout: float | None = Field(default=None, ge=60, le=21_600)
    user_metadata: dict[str, JsonValue] | None = None

    @field_validator("extension_id")
    @classmethod
    def validate_extension_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if value == "":
            raise ValueError("extension ID cannot be empty")
        return value


class BrowserbaseSessionReleaseRequest(_BrowserbaseRequest):
    session_id: str = Field(min_length=1, exclude=True)
    status: Literal["REQUEST_RELEASE"] = "REQUEST_RELEASE"

    @field_validator("session_id")
    @classmethod
    def validate_session_id(cls, value: str) -> str:
        value = value.strip()
        if value == "":
            raise ValueError("session ID cannot be empty")
        return value


class BrowserbaseExtensionResponse(_BrowserbaseResponse):
    id: str


class BrowserbaseSessionResponse(_BrowserbaseResponse):
    id: str
    connect_url: WebsocketUrl


class BrowserbaseSessionReleaseResponse(_BrowserbaseResponse):
    id: str | None = None
    status: str | None = None


class BrowserbaseAPIError(RuntimeError):
    def __init__(
        self,
        *,
        method: str,
        path: str,
        status_code: int,
        request_id: str | None,
        body: str,
    ) -> None:
        self.method = method
        self.path = path
        self.status_code = status_code
        self.request_id = request_id
        self.body = body
        super().__init__(
            f"Browserbase {method} {path} returned {status_code}: {_error_message(body)}"
        )


class BrowserbaseClient:
    def __init__(
        self,
        api_key: str,
        *,
        base_url: str | None = None,
        timeout: float = _DEFAULT_BROWSERBASE_API_TIMEOUT_SECONDS,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        if api_key.strip() == "":
            raise ValueError("A Browserbase API key is required")
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("Browserbase API timeout must be positive and finite")

        configured_base_url = (
            base_url or os.environ.get("BROWSERBASE_BASE_URL") or _DEFAULT_BROWSERBASE_API_URL
        )
        parsed_base_url = httpx.URL(configured_base_url)
        if (
            parsed_base_url.scheme not in ("http", "https")
            or not parsed_base_url.host
            or parsed_base_url.query
            or parsed_base_url.fragment
        ):
            raise ValueError(f"Invalid Browserbase API base URL: {configured_base_url!r}")

        self._api_key = api_key
        self._base_url = str(parsed_base_url).rstrip("/")
        self._http_client = http_client or httpx.AsyncClient(timeout=timeout)
        self._owns_http_client = http_client is None

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exception_type: type[BaseException] | None,
        exception: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._owns_http_client:
            await self._http_client.aclose()

    async def upload_extension(
        self,
        request: BrowserbaseExtensionUploadRequest,
    ) -> BrowserbaseExtensionResponse:
        self._require_request(request, BrowserbaseExtensionUploadRequest)
        response = await self._send(
            "POST",
            "/v1/extensions",
            files={
                "file": (
                    request.file_name,
                    request.archive,
                    "application/zip",
                )
            },
        )
        return self._parse_response(response, BrowserbaseExtensionResponse)

    async def delete_extension(self, request: BrowserbaseExtensionDeleteRequest) -> None:
        self._require_request(request, BrowserbaseExtensionDeleteRequest)
        response = await self._send(
            "DELETE",
            f"/v1/extensions/{quote(request.extension_id, safe='')}",
            headers={"Accept": "*/*"},
        )
        if response.content.strip():
            raise ValueError("Browserbase extension deletion returned an unexpected response body")

    async def create_session(
        self,
        request: BrowserbaseSessionCreateRequest,
    ) -> BrowserbaseSessionResponse:
        self._require_request(request, BrowserbaseSessionCreateRequest)
        response = await self._send(
            "POST",
            "/v1/sessions",
            json_body=request.model_dump(mode="json", exclude_none=True),
        )
        return self._parse_response(response, BrowserbaseSessionResponse)

    async def release_session(
        self,
        request: BrowserbaseSessionReleaseRequest,
    ) -> BrowserbaseSessionReleaseResponse:
        self._require_request(request, BrowserbaseSessionReleaseRequest)
        response = await self._send(
            "POST",
            f"/v1/sessions/{quote(request.session_id, safe='')}",
            json_body=request.model_dump(mode="json", exclude_none=True),
        )
        return self._parse_response(response, BrowserbaseSessionReleaseResponse)

    @staticmethod
    def _require_request(request: object, expected_type: type[BaseModel]) -> None:
        if not isinstance(request, expected_type):
            raise TypeError(f"request must be a {expected_type.__name__}")

    async def _send(
        self,
        method: str,
        path: str,
        *,
        headers: Mapping[str, str] | None = None,
        json_body: object | None = None,
        files: Mapping[str, tuple[str, bytes, str]] | None = None,
    ) -> httpx.Response:
        request_headers = {
            "Accept": "application/json",
            "X-BB-API-Key": self._api_key,
            **(headers or {}),
        }
        response = await self._http_client.request(
            method,
            self._base_url + path,
            headers=request_headers,
            json=json_body,
            files=files,
        )
        if not response.is_success:
            raise BrowserbaseAPIError(
                method=method,
                path=path,
                status_code=response.status_code,
                request_id=response.headers.get("x-request-id"),
                body=response.text,
            )
        return response

    @staticmethod
    def _parse_response(
        response: httpx.Response,
        response_model: type[_ResponseModel],
    ) -> _ResponseModel:
        try:
            payload = response.json()
        except json.JSONDecodeError as error:
            raise ValueError("Browserbase returned an invalid JSON response") from error
        return response_model.model_validate(payload)


def _error_message(body: str) -> str:
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return body.strip() or "request failed"
    if isinstance(payload, dict) and isinstance(payload.get("message"), str):
        return payload["message"]
    return body.strip() or "request failed"
