import re
from collections.abc import Mapping
from typing import Annotated, Self, cast
from urllib.parse import urlparse

from pydantic import (
    AfterValidator,
    AnyUrl,
    BaseModel,
    ConfigDict,
    TypeAdapter,
    ValidationError,
    ValidatorFunctionWrapHandler,
    WrapValidator,
    field_validator,
    model_validator,
)
from typing_extensions import override

from ._js_regexp import validate_js_regexp

_MAX_INPUT_FILE_BYTES = 50 * 1024 * 1024
_url_adapter = TypeAdapter(AnyUrl)


def _validate_url(value: str) -> str:
    _url_adapter.validate_python(value)
    return value


WireUrl = Annotated[str, AfterValidator(_validate_url)]

# RFC 9110 field names are tokens. Restrict values to ASCII so HTTP discovery
# and WebSocket handshakes encode them identically; allow only internal whitespace.
_HEADER_NAME = re.compile(r"[!#$%&'*+\-.^_`|~0-9A-Za-z]+")
_HEADER_VALUE = re.compile(r"[\t\x20-\x7e]*")


def _validate_headers(value: Mapping[str, str]) -> Mapping[str, str]:
    for name, header_value in value.items():
        if not _HEADER_NAME.fullmatch(name):
            raise ValueError
        if not _HEADER_VALUE.fullmatch(header_value) or header_value != header_value.strip(" \t"):
            raise ValueError
    return value


def _redact_header_validation_errors(
    value: object, handler: ValidatorFunctionWrapHandler
) -> dict[str, str]:
    try:
        return cast(dict[str, str], handler(value))
    except ValidationError:
        # Error inputs, locations, and validator context can all contain credentials.
        # Rebuild the error rather than only hiding inputs in its formatted message.
        raise ValidationError.from_exception_data(
            "CDP headers",
            [
                {
                    "type": "value_error",
                    "loc": (),
                    "input": "[redacted]",
                    "ctx": {
                        "error": ValueError(
                            "headers must map valid HTTP header names to ASCII string values "
                            "without leading or trailing spaces or tabs"
                        )
                    },
                }
            ],
            hide_input=True,
        ) from None


WireHeaders = Annotated[
    dict[str, str],
    AfterValidator(_validate_headers),
    WrapValidator(_redact_header_validation_errors),
]


def _validate_websocket_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme not in ("ws", "wss") or not parsed.hostname:
        raise ValueError("must be a ws:// or wss:// URL with a host")
    _url_adapter.validate_python(value)
    if parsed.port == 0:
        raise ValueError("port must be between 1 and 65535")
    return value


WireWebSocketUrl = Annotated[str, AfterValidator(_validate_websocket_url)]


class WireModel(BaseModel):
    model_config = ConfigDict(validate_assignment=True, allow_inf_nan=False)

    @override
    def model_post_init(self, context: object, /) -> None:
        super().model_post_init(context)
        # Protocol defaults must survive `model_dump(exclude_unset=True)` at the wire boundary.
        for name, field in type(self).model_fields.items():
            value = getattr(self, name)
            if name not in self.model_fields_set and not field.is_required() and value is not None:
                self.model_fields_set.add(name)


class CookieParamValidation(WireModel):
    @model_validator(mode="after")
    def validate_cookie_param(self) -> Self:
        name = getattr(self, "name", "")
        url = getattr(self, "url", None)
        domain = getattr(self, "domain", None)
        path = getattr(self, "path", None)
        expires = getattr(self, "expires", None)
        secure = getattr(self, "secure", None)
        same_site = getattr(self, "same_site", None)

        if not url and not (domain and path):
            raise ValueError(f'Cookie "{name}" must have a url or a domain/path pair')
        if url and domain:
            raise ValueError(f'Cookie "{name}" should have either url or domain, not both')
        if url and path:
            raise ValueError(f'Cookie "{name}" should have either url or path, not both')
        if expires is not None and expires < 0 and expires != -1:
            raise ValueError(
                f'Cookie "{name}" has an invalid expires value; '
                "use -1 for session cookies or a positive unix timestamp"
            )

        parsed_url: AnyUrl | None = None
        if url == "about:blank":
            raise ValueError(f'Blank page cannot have cookie "{name}"')
        if isinstance(url, str) and url.startswith("data:"):
            raise ValueError(f'Data URL page cannot have cookie "{name}"')
        if url:
            try:
                parsed_url = _url_adapter.validate_python(url)
            except ValidationError:
                raise ValueError(f'Cookie "{name}" has an invalid url: "{url}"') from None

        effectively_secure = (
            parsed_url is not None and parsed_url.scheme == "https" if url else secure is True
        )
        if same_site == "None" and not effectively_secure:
            raise ValueError(
                f'Cookie "{name}" has sameSite: "None" without secure: true. '
                'Browsers require secure: true when sameSite is "None".'
            )
        return self


class CookieRegexValidation(WireModel):
    @model_validator(mode="after")
    def validate_cookie_regex(self) -> Self:
        source = getattr(self, "source", "")
        flags = getattr(self, "flags", None)
        validate_js_regexp(source, flags)
        return self


class InputFilePayloadValidation(WireModel):
    @field_validator("data", mode="after", check_fields=False)
    @classmethod
    def validate_decoded_size(cls, value: str) -> str:
        padding = 2 if value.endswith("==") else 1 if value.endswith("=") else 0
        if (len(value) // 4) * 3 - padding > _MAX_INPUT_FILE_BYTES:
            raise ValueError("File data must decode to 50 MiB or less")
        return value


class LocatorChainValidation(WireModel):
    @field_validator("steps", mode="after", check_fields=False)
    @classmethod
    def require_leading_query(cls, steps: list[BaseModel]) -> list[BaseModel]:
        if steps and steps[0].model_dump().get("type") != "query":
            raise ValueError("locator chains must start with a query")
        return steps


class PageScreenshotOptionsValidation(WireModel):
    @model_validator(mode="after")
    def validate_cross_field_options(self) -> Self:
        if getattr(self, "full_page", None) and getattr(self, "clip", None) is not None:
            raise ValueError("fullPage and clip cannot be used together")
        if getattr(self, "quality", None) is not None and getattr(self, "type", None) != "jpeg":
            raise ValueError('quality is only valid when type is "jpeg"')
        return self


class TelemetryTracesValidation(WireModel):
    @field_validator("endpoint", mode="after", check_fields=False)
    @classmethod
    def validate_trace_endpoint(cls, value: str) -> str:
        parsed = _url_adapter.validate_python(value)
        if not (parsed.path or "").endswith("/v1/traces"):
            raise ValueError("OTLP trace endpoint must end with /v1/traces")
        return value


class StagehandInitParamsValidation(WireModel):
    @model_validator(mode="after")
    def validate_browserbase_metadata(self) -> Self:
        if (
            getattr(self, "browserbase", None) is not None
            and getattr(self, "browser", None) is None
        ):
            raise ValueError("Client Browserbase transport requires browser metadata")
        return self
