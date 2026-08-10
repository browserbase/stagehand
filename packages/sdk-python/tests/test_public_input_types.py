import inspect
from collections.abc import Callable
from types import UnionType
from typing import Union, get_args, get_origin, is_typeddict

import pytest

from stagehand import (
    ActionInput,
    BrowserbaseBrowserSettings,
    BrowserbaseProxyConfig,
    BrowserContext,
    CacheOptions,
    CookieParam,
    DomainPolicyInput,
    ExternalProxyConfig,
    Locator,
    ModelConfig,
    Page,
    PageDragAndDropRoutePoint,
    PageScreenshotClip,
    RgbaColor,
    Stagehand,
    StagehandClientLoggingConfig,
    TelemetryConfig,
    browserbase,
)


def _is_typed_dict_shape(value: object) -> bool:
    if is_typeddict(value):
        return True
    return get_origin(value) in (Union, UnionType) and all(
        _is_typed_dict_shape(member) for member in get_args(value)
    )


@pytest.mark.parametrize(
    "input_type",
    [
        ActionInput,
        BrowserbaseBrowserSettings,
        BrowserbaseProxyConfig,
        CacheOptions,
        CookieParam,
        DomainPolicyInput,
        ExternalProxyConfig,
        ModelConfig,
        PageDragAndDropRoutePoint,
        PageScreenshotClip,
        RgbaColor,
        StagehandClientLoggingConfig,
        TelemetryConfig,
    ],
)
def test_public_structured_inputs_are_typed_dictionary_shapes(input_type: object) -> None:
    assert _is_typed_dict_shape(input_type)


@pytest.mark.parametrize(
    "method",
    [
        Stagehand.create,
        Stagehand.act,
        Stagehand.observe,
        Stagehand.extract,
        BrowserContext.add_cookies,
        BrowserContext.set_domain_policy,
        Locator.highlight,
        Page.goto,
        Page.screenshot,
        browserbase.launch,
    ],
)
def test_typed_dictionary_inputs_do_not_replace_explicit_parameters_with_kwargs(
    method: Callable[..., object],
) -> None:
    assert all(
        parameter.kind is not inspect.Parameter.VAR_KEYWORD
        for parameter in inspect.signature(method).parameters.values()
    )
