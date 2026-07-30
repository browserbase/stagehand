from __future__ import annotations

import pytest
from pydantic import ValidationError

from stagehand.client_models import (
    BrowserbaseBrowserSource,
    CdpBrowserSource,
    LocalBrowserSource,
    StagehandClientInitParams,
    StagehandClientLoggingConfig,
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


@pytest.mark.parametrize(
    "browser",
    [
        {"type": "browserbase", "extension_id": "ext_caller"},
        {
            "type": "browserbase",
            "browser_settings": {"extension_id": "ext_caller"},
        },
    ],
)
def test_client_configuration_rejects_browserbase_extension_ids(
    browser: dict[str, object],
) -> None:
    with pytest.raises(ValidationError, match="extra_forbidden"):
        StagehandClientInitParams.model_validate({
            "api_key": "bb_test",
            "browser": browser,
        })


def test_browserbase_os_accepts_api_literals_without_relaxing_boolean_fields() -> None:
    params = StagehandClientInitParams.model_validate({
        "api_key": "bb_test",
        "browser": {
            "type": "browserbase",
            "browser_settings": {
                "os": "mac",
                "advanced_stealth": True,
            },
        },
    })

    assert isinstance(params.browser, BrowserbaseBrowserSource)
    assert params.browser.browser_settings is not None
    assert params.browser.browser_settings.os is not None
    assert params.browser.browser_settings.os.value == "mac"

    with pytest.raises(ValidationError, match="bool_type"):
        StagehandClientInitParams.model_validate({
            "api_key": "bb_test",
            "browser": {
                "type": "browserbase",
                "browser_settings": {
                    "os": "mac",
                    "advanced_stealth": 1,
                },
            },
        })


def test_client_configuration_rejects_unknown_sdk_options() -> None:
    with pytest.raises(ValidationError, match="extra_forbidden"):
        StagehandClientInitParams.model_validate({
            "browser": {"type": "local", "headless": True, "unknown": True}
        })


@pytest.mark.parametrize("timeout", [True, 9_007_199_254_740_992])
def test_client_configuration_rejects_invalid_dom_settle_timeouts(timeout: object) -> None:
    with pytest.raises(ValidationError):
        StagehandClientInitParams.model_validate({
            "browser": {"type": "local"},
            "dom_settle_timeout_ms": timeout,
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
