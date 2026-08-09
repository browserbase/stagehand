from __future__ import annotations

from types import UnionType
from typing import (
    Annotated,
    Any,
    NotRequired,
    Required,
    Union,
    cast,
    get_args,
    get_origin,
    get_type_hints,
    is_typeddict,
)

import pytest
from pydantic import BaseModel, ValidationError

from stagehand import client_models, client_types
from stagehand.client_models import (
    BrowserbaseConnectOptions,
    StagehandClientCreateConfig,
    StagehandClientLoggingConfig,
    _cache_config,
)
from stagehand.client_types import Cache


def _normalized_type(annotation: object) -> object:
    origin = get_origin(annotation)
    if origin in (Annotated, NotRequired, Required):
        return _normalized_type(get_args(annotation)[0])
    if origin in (Union, UnionType):
        members = frozenset(
            _normalized_type(member) for member in get_args(annotation) if member is not type(None)
        )
        return next(iter(members)) if len(members) == 1 else ("union", members)
    module = getattr(annotation, "__module__", "")
    name = getattr(annotation, "__name__", "")
    if is_typeddict(annotation) and module == "stagehand._generated.input_types":
        return ("protocol", name)
    if is_typeddict(annotation):
        typed_dict = cast(Any, annotation)
        hints = get_type_hints(typed_dict, include_extras=True)
        return (
            "mapping",
            frozenset(
                (
                    name,
                    name in typed_dict.__required_keys__,
                    _normalized_type(field_type),
                )
                for name, field_type in hints.items()
            ),
        )
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        if module == "stagehand._generated.models" and name not in {
            "Caching",
            "Caching1",
        }:
            return ("protocol", name)
        if annotation.__pydantic_root_model__:
            return _normalized_type(annotation.model_fields["root"].annotation)
        return (
            "mapping",
            frozenset(
                (name, field.is_required(), _normalized_type(field.annotation))
                for name, field in annotation.model_fields.items()
            ),
        )
    if origin is not None:
        return (origin, tuple(_normalized_type(member) for member in get_args(annotation)))
    if isinstance(annotation, (list, tuple)):
        return tuple(_normalized_type(member) for member in annotation)
    return annotation


@pytest.mark.parametrize(
    ("input_name", "model_name"),
    [
        ("BrowserbaseConnectOptions", "BrowserbaseConnectOptions"),
        ("CacheOptions", "CacheOptions"),
        ("ClientLLM", "ClientLLM"),
        ("LocalBrowserConnectOptions", "LocalBrowserConnectOptions"),
        ("LocalBrowserLaunchOptions", "LocalBrowserLaunchOptions"),
        ("LocalProxyConfig", "LocalProxyConfig"),
        ("LocalViewport", "LocalViewport"),
        ("StagehandClientCreateConfig", "StagehandClientCreateConfig"),
        ("StagehandClientLoggingConfig", "StagehandClientLoggingConfig"),
    ],
)
def test_client_typed_dicts_match_runtime_model_fields(
    input_name: str,
    model_name: str,
) -> None:
    input_type = getattr(client_types, input_name, None)
    model_type = getattr(client_models, model_name, None)

    assert is_typeddict(input_type), f"missing client TypedDict {input_name}"
    assert isinstance(model_type, type) and issubclass(model_type, BaseModel), (
        f"missing client runtime model {model_name}"
    )
    input_typed_dict = cast(Any, input_type)
    assert set(input_typed_dict.__annotations__) == set(model_type.model_fields)
    assert input_typed_dict.__required_keys__ == frozenset(
        name for name, field in model_type.model_fields.items() if field.is_required()
    )
    input_hints = get_type_hints(input_typed_dict, include_extras=True)
    for field_name, model_field in model_type.model_fields.items():
        assert _normalized_type(input_hints[field_name]) == _normalized_type(
            model_field.annotation
        ), f"{input_name}.{field_name} does not match {model_name}.{field_name}"


def test_cache_config_omits_an_explicit_none_threshold() -> None:
    cache = cast(Cache, {"threshold": None})

    assert _cache_config(cache) == {}


def test_create_configuration_rejects_unknown_options() -> None:
    with pytest.raises(ValidationError, match="extra_forbidden"):
        StagehandClientCreateConfig.model_validate({"unknown": True})


@pytest.mark.parametrize("timeout", [True, 9_007_199_254_740_992])
def test_create_configuration_rejects_invalid_dom_settle_timeouts(timeout: object) -> None:
    with pytest.raises(ValidationError):
        StagehandClientCreateConfig.model_validate({"dom_settle_timeout_ms": timeout})


def test_create_configuration_uses_default_logging() -> None:
    config = StagehandClientCreateConfig.model_validate({})

    assert config.logging == StagehandClientLoggingConfig(level="info", format="pretty")


def test_browserbase_connect_configuration_uses_default_base_url() -> None:
    config = BrowserbaseConnectOptions.model_validate({
        "api_key": "bb-key",
        "session_id": "session-id",
    })

    assert config.base_url == "https://api.browserbase.com"


def test_create_logging_accepts_json_output_and_a_structured_callback() -> None:
    def on_log(_: object) -> None:
        pass

    config = StagehandClientCreateConfig.model_validate({
        "logging": {
            "level": "debug",
            "format": "json",
            "on_log": on_log,
        }
    })

    assert config.logging.level == "debug"
    assert config.logging.format == "json"
    assert config.logging.on_log is on_log
