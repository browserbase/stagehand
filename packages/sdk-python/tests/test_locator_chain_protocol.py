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


@pytest.mark.parametrize(
    "first",
    [
        {"type": "frame", "selector": {"kind": "css", "value": "button"}},
        {"type": "nth", "index": 0},
        {"type": "filter", "has_text": "Billing"},
    ],
)
@pytest.mark.parametrize("parsed", [False, True])
def test_tuple_chains_must_start_with_a_query(first: dict[str, object], parsed: bool) -> None:
    step = models.LocatorStep.model_validate(first) if parsed else first
    with pytest.raises(ValidationError, match="locator chains must start with a query"):
        models.LocatorChain.model_validate({"steps": (step,)})


@pytest.mark.parametrize("parsed", [False, True])
def test_query_first_tuples_are_accepted(parsed: bool) -> None:
    first = {"type": "query", "selector": {"kind": "css", "value": "button"}}
    step = models.LocatorStep.model_validate(first) if parsed else first
    chain = models.LocatorChain.model_validate({"steps": (step,)})
    assert chain.model_dump() == {"steps": [first]}


@pytest.mark.parametrize("field", ["has_text", "has_not_text"])
def test_filter_assignment_rejects_null(field: str) -> None:
    step = models.LocatorFilterStep(type="filter")
    with pytest.raises(ValidationError, match="text filters cannot be null"):
        setattr(step, field, None)
    assert step.model_dump(exclude_unset=True) == {"type": "filter"}


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
    with pytest.raises(ValidationError) as error:
        models.Action.model_validate({
            "selector": "button",
            "chain": FIXTURES["valid"][0]["chain"],
            "description": "Save",
        })
    assert [(item["type"], item["loc"]) for item in error.value.errors()] == [
        ("extra_forbidden", ("chain",))
    ]
