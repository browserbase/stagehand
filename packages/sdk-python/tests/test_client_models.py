from __future__ import annotations

import pytest
from pydantic import ValidationError

from stagehand.client_models import (
    CdpBrowserSource,
    LocalBrowserSource,
    StagehandClientInitParams,
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
