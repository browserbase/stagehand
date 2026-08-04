from __future__ import annotations

from typing import is_typeddict

import pytest
from pydantic import ValidationError

from stagehand import client_models, client_types
from stagehand.client_models import (
    CdpBrowserSource,
    LocalBrowserSource,
    StagehandClientInitParams,
    StagehandClientLoggingConfig,
)


@pytest.mark.parametrize(
    ("input_name", "model_name"),
    [
        ("BrowserbaseBrowserSource", "BrowserbaseBrowserSource"),
        ("CacheOptions", "CacheOptions"),
        ("CdpBrowserSource", "CdpBrowserSource"),
        ("ClientLLM", "ClientLLM"),
        ("LocalBrowserSource", "LocalBrowserSource"),
        ("LocalProxyConfig", "LocalProxyConfig"),
        ("LocalViewport", "LocalViewport"),
        ("StagehandClientInitParams", "StagehandClientInitParams"),
        ("StagehandClientLoggingConfig", "StagehandClientLoggingConfig"),
    ],
)
def test_client_typed_dicts_match_runtime_model_fields(
    input_name: str,
    model_name: str,
) -> None:
    input_type = getattr(client_types, input_name)
    model_type = getattr(client_models, model_name)

    assert is_typeddict(input_type)
    assert set(input_type.__annotations__) == set(model_type.model_fields)
    assert input_type.__required_keys__ == frozenset(
        name for name, field in model_type.model_fields.items() if field.is_required()
    )


def test_client_configuration_selects_local_and_cdp_browser_sources() -> None:
    local = StagehandClientInitParams.model_validate({
        "browser": {"type": "local", "headless": True}
    })
    cdp = StagehandClientInitParams.model_validate({
        "browser": {"type": "cdp", "cdp_url": "http://localhost:9222"}
    })

    assert isinstance(local.browser, LocalBrowserSource)
    assert local.browser.headless is True
    assert isinstance(cdp.browser, CdpBrowserSource)
    assert cdp.browser.cdp_url == "http://localhost:9222"


def test_client_configuration_requires_an_api_key_for_browserbase() -> None:
    with pytest.raises(ValidationError, match="Browserbase API key"):
        StagehandClientInitParams.model_validate({"browser": {"type": "browserbase"}})


def test_client_configuration_rejects_unknown_sdk_options() -> None:
    with pytest.raises(ValidationError, match="extra_forbidden"):
        StagehandClientInitParams.model_validate({
            "browser": {"type": "local", "headless": True, "unknown": True}
        })


def test_client_logging_uses_info_and_pretty_output_by_default() -> None:
    params = StagehandClientInitParams.model_validate({"browser": {"type": "local"}})

    assert params.logging == StagehandClientLoggingConfig(level="info", format="pretty")


def test_client_logging_accepts_json_output_and_a_structured_callback() -> None:
    def on_log(_: object) -> None:
        pass

    params = StagehandClientInitParams.model_validate({
        "browser": {"type": "local"},
        "logging": {
            "level": "debug",
            "format": "json",
            "on_log": on_log,
        },
    })

    assert params.logging.level == "debug"
    assert params.logging.format == "json"
    assert params.logging.on_log is on_log
