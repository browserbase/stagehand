import pytest
from pydantic import ValidationError

from stagehand._generated.models import ExperimentalDecisionsConfig
from stagehand.client_models import StagehandClientCreateConfig


def test_cloudflare_requires_account_metadata_in_generated_and_client_models() -> None:
    config = {"provider": "cloudflare", "api_key": "key"}
    with pytest.raises(ValidationError, match="Cloudflare decisions require account_id"):
        ExperimentalDecisionsConfig.model_validate(config)
    with pytest.raises(ValidationError, match="Cloudflare decisions require account_id"):
        StagehandClientCreateConfig.model_validate({"experimental_decisions": config})


@pytest.mark.parametrize(
    "config",
    [
        {"api_key": "key"},
        {"provider": "typesafe", "api_key": "key"},
        {"provider": "cloudflare", "api_key": "key", "account_id": "account-1"},
        {
            "provider": "cloudflare",
            "api_key": "key",
            "api_url": "https://gateway.example/accounts/account-1/ai/run",
        },
    ],
)
def test_decision_connection_settings_round_trip(config: dict[str, str]) -> None:
    validated = ExperimentalDecisionsConfig.model_validate(config)
    assert validated.model_dump(mode="json", exclude_unset=True) == config


@pytest.mark.parametrize(
    "api_url",
    [
        "http://example.com",
        "https:///",
        "https://[bad",
        "https://host:bad",
        "https://example.com?",
        "https://example.com#",
        "https://example.com/path?query=value",
        "https://example.com\\path",
        "https://example.com/with space",
    ],
)
def test_invalid_decision_endpoints_are_rejected(api_url: str) -> None:
    with pytest.raises(ValidationError):
        ExperimentalDecisionsConfig(api_key="key", api_url=api_url)
