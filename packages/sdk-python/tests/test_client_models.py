from __future__ import annotations

import pytest
from pydantic import ValidationError

from stagehand.client_models import (
    StagehandClientCreateConfig,
    StagehandClientLoggingConfig,
)


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
