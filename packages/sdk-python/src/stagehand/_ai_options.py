from __future__ import annotations

from ._generated.input_types import Locator as ProtocolLocator
from ._generated.input_types import ModelConfig, Variables
from ._generated.models import ActOptions, ExtractOptions, ObserveOptions
from .client_models import _cache_config
from .client_types import Cache
from .locator import Locator


def _serialize_locator(locator: Locator, page_id: str, method: str) -> ProtocolLocator:
    if locator.page_id != page_id:
        raise TypeError(f"{method}() locator must belong to the target page")
    if locator.nth_index is not None:
        return ProtocolLocator(selector=locator.selector, nth=locator.nth_index)
    return ProtocolLocator(selector=locator.selector)


def _serialize_locators(
    locators: list[Locator] | None,
    page_id: str,
    method: str,
) -> list[ProtocolLocator] | None:
    if locators is None:
        return None
    return [_serialize_locator(locator, page_id, method) for locator in locators]


def _act_options(
    page_id: str,
    *,
    model: ModelConfig | None,
    variables: Variables | None,
    timeout: float | None,
    locator: Locator | None,
    ignore_locators: list[Locator] | None,
    cache: Cache | None,
) -> ActOptions:
    return ActOptions.model_validate({
        name: value
        for name, value in (
            ("model", model),
            ("variables", variables),
            ("timeout", timeout),
            (
                "locator",
                _serialize_locator(locator, page_id, "act") if locator is not None else None,
            ),
            ("ignore_locators", _serialize_locators(ignore_locators, page_id, "act")),
            ("cache", _cache_config(cache) if cache is not None else None),
        )
        if value is not None
    })


def _observe_options(
    page_id: str,
    *,
    model: ModelConfig | None,
    variables: Variables | None,
    timeout: float | None,
    locator: Locator | None,
    ignore_locators: list[Locator] | None,
    cache: Cache | None,
) -> ObserveOptions:
    return ObserveOptions.model_validate({
        name: value
        for name, value in (
            ("model", model),
            ("variables", variables),
            ("timeout", timeout),
            (
                "locator",
                _serialize_locator(locator, page_id, "observe") if locator is not None else None,
            ),
            ("ignore_locators", _serialize_locators(ignore_locators, page_id, "observe")),
            ("cache", _cache_config(cache) if cache is not None else None),
        )
        if value is not None
    })


def _extract_options(
    page_id: str,
    *,
    model: ModelConfig | None,
    timeout: float | None,
    screenshot: bool | None,
    locator: Locator | None,
    ignore_locators: list[Locator] | None,
    cache: Cache | None,
) -> ExtractOptions:
    return ExtractOptions.model_validate({
        name: value
        for name, value in (
            ("model", model),
            ("timeout", timeout),
            ("screenshot", screenshot),
            (
                "locator",
                _serialize_locator(locator, page_id, "extract") if locator is not None else None,
            ),
            ("ignore_locators", _serialize_locators(ignore_locators, page_id, "extract")),
            ("cache", _cache_config(cache) if cache is not None else None),
        )
        if value is not None
    })
