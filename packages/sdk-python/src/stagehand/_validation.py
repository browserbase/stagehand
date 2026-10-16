import re
from collections.abc import Mapping
from typing import Annotated
from urllib.parse import urlparse

from pydantic import AfterValidator, AnyUrl, BaseModel, ConfigDict, TypeAdapter, model_validator
from typing_extensions import override

_url_adapter = TypeAdapter(AnyUrl)


def _validate_url(value: str) -> str:
    _url_adapter.validate_python(value)
    return value


WireUrl = Annotated[str, AfterValidator(_validate_url)]

# RFC 9110 field names are tokens; values are visible characters, spaces and tabs.
_HEADER_NAME = re.compile(r"[!#$%&'*+\-.^_`|~0-9A-Za-z]+")
_HEADER_VALUE = re.compile(r"[\t\x20-\x7e\x80-\xff]*")


def _validate_headers(value: Mapping[str, str]) -> Mapping[str, str]:
    for name, header_value in value.items():
        if not _HEADER_NAME.fullmatch(name):
            raise ValueError(f"invalid header name {name!r}")
        if not _HEADER_VALUE.fullmatch(header_value):
            # The value may be a credential, so it is not echoed.
            raise ValueError(f"invalid value for header {name!r}")
    return value


WireHeaders = Annotated[dict[str, str], AfterValidator(_validate_headers)]


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


class PageScreenshotOptionsValidation(WireModel):
    @model_validator(mode="before")
    @classmethod
    def validate_cross_field_options(cls, value: object) -> object:
        if not isinstance(value, Mapping):
            return value
        if value.get("full_page") and value.get("clip") is not None:
            raise ValueError("fullPage and clip cannot be used together")
        if "quality" in value and value.get("type") != "jpeg":
            raise ValueError('quality is only valid when type is "jpeg"')
        return value


class TelemetryConfigValidation(WireModel):
    @model_validator(mode="before")
    @classmethod
    def validate_trace_endpoint(cls, value: object) -> object:
        if not isinstance(value, Mapping):
            return value
        traces = value.get("traces")
        if not isinstance(traces, Mapping):
            return value
        endpoint = traces.get("endpoint")
        if isinstance(endpoint, str) and not urlparse(endpoint).path.endswith("/v1/traces"):
            raise ValueError("OTLP trace endpoint must end with /v1/traces")
        return value
