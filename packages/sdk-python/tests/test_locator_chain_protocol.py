import json
from pathlib import Path

import pytest
from pydantic import BaseModel, ValidationError

from stagehand._generated import models
from stagehand.rpc_client import _rpc_response_timeout_seconds

FIXTURES = json.loads(
    (Path(__file__).parents[2] / "protocol/tests/fixtures/locator-chain-wire.json").read_text()
)


@pytest.mark.parametrize("fixture", FIXTURES["valid"], ids=lambda fixture: fixture["name"])
def test_chain_requests_round_trip(fixture: dict[str, object]) -> None:
    chain = fixture["chain"]
    request = {"page_id": "page-1", "chain": chain, "options": {"timeout": 0}}
    parsed = models.LocatorParams.model_validate(request)
    assert parsed.model_dump(mode="json", exclude_unset=True) == request
    assert _rpc_response_timeout_seconds("locator.count", parsed) is None
    for options in (models.ActOptions, models.ObserveOptions, models.ExtractOptions):
        value = {"locator": {"chain": chain}, "ignore_locators": [{"chain": chain}]}
        assert options.model_validate(value).model_dump(exclude_unset=True) == value
    mask = {"mask": [{"page_id": "page-1", "chain": chain}]}
    assert models.PageScreenshotOptions.model_validate(mask).model_dump(exclude_unset=True) == mask


@pytest.mark.parametrize("fixture", FIXTURES["invalid"], ids=lambda fixture: fixture["name"])
def test_invalid_chains_are_rejected(fixture: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        models.LocatorParams.model_validate({"page_id": "page-1", "chain": fixture["chain"]})


@pytest.mark.parametrize("extra", [{"selector": "button"}, {"nth": 0}, {"unexpected": True}])
def test_chain_requests_cannot_mix_legacy_fields(extra: dict[str, object]) -> None:
    value = {"chain": FIXTURES["valid"][0]["chain"], **extra}
    for model in (models.LocatorInput, models.LocatorRequestDescriptor, models.LocatorParams):
        with pytest.raises(ValidationError):
            model.model_validate(
                value if model is models.LocatorInput else {"page_id": "page-1", **value}
            )


def test_legacy_construction_and_outputs_stay_compatible() -> None:
    descriptor = models.LocatorDescriptor(page_id="page-1", selector="button", nth=1)
    expected = {"page_id": "page-1", "selector": "button", "nth": 1}
    assert descriptor.model_dump(exclude_unset=True) == expected
    legacy_constructor: type[BaseModel] = getattr(models, "LocatorParams")
    assert legacy_constructor(**expected).model_dump(exclude_unset=True) == expected
    with pytest.raises(ValidationError):
        models.Action.model_validate({
            "chain": FIXTURES["valid"][0]["chain"],
            "description": "Save",
        })
