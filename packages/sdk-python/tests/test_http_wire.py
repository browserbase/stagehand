import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from stagehand._generated import models

FIXTURES = json.loads(
    (Path(__file__).parents[2] / "protocol/tests/fixtures/http-transport-wire.json").read_text()
)
REGISTRATION_FIXTURES = json.loads(
    (
        Path(__file__).parents[2] / "protocol/tests/fixtures/http-model-registration-wire.json"
    ).read_text()
)
REFERENCE = {
    "source": "http",
    "route": "provider",
    "configuration_id": "model-1",
    "model_name": "openai/gpt-5",
}


@pytest.mark.parametrize(
    ("model", "wire"),
    [
        *[(models.HTTPRequestParams, f["wire"]["params"]) for f in FIXTURES["requests"]],
        *[(models.HTTPRequestResult, f["wire"]) for f in FIXTURES["results"]],
        (models.HTTPCancelParams, FIXTURES["cancel"]["params"]),
        *[(models.HTTPRegisterModelParams, f["params"]) for f in REGISTRATION_FIXTURES],
        *[(models.HTTPModelReference, f["result"]) for f in REGISTRATION_FIXTURES],
        *[(models.HTTPRequestErrorData, f["error"]["data"]) for f in FIXTURES["errors"]],
    ],
)
def test_http_transport_fixtures_round_trip(model: type[BaseModel], wire: dict[str, Any]) -> None:
    assert (
        model.model_validate(wire).model_dump(mode="json", by_alias=True, exclude_unset=True)
        == wire
    )


@pytest.mark.parametrize(
    ("model", "wire"),
    [
        (models.HTTPModelReference, REFERENCE),
        (
            models.HTTPModelReference,
            {"source": "http", "route": "gateway", "configuration_id": "g"},
        ),
        (models.HTTPInitModelReference, {"source": "client"}),
        (
            models.StagehandInitWireParams,
            {
                "protocol_version": "2.1.0",
                "client_info": {"name": "test", "version": "1"},
                "connections": {},
                "log_level": "info",
                "model": REFERENCE,
            },
        ),
        *[
            (
                model,
                {
                    "page_id": "page-1",
                    "instruction": "read title",
                    **(
                        {"schema": {"type": "object"}}
                        if model is models.StagehandExtractWireParams
                        else {}
                    ),
                    **params,
                },
            )
            for model in (
                models.StagehandActWireParams,
                models.StagehandObserveWireParams,
                models.StagehandExtractWireParams,
            )
            for params in (
                {"options": {"model": {"model_name": "openai/gpt-5", "api_key": "test-key"}}},
                {"scope_id": "call-1", "options": {"model": REFERENCE}},
            )
        ],
        (
            models.CallbackBatchWireParams,
            {
                "callback_source": "async () => 1",
                "scope_id": "batch-1",
                "options": {
                    "timeout": 30000,
                    "model_overrides": {
                        "act": REFERENCE,
                        "observe": REFERENCE,
                        "extract": REFERENCE,
                    },
                },
            },
        ),
    ],
)
def test_connection_forms_round_trip(model: type[BaseModel], wire: dict[str, Any]) -> None:
    assert (
        model.model_validate(wire).model_dump(mode="json", by_alias=True, exclude_unset=True)
        == wire
    )


@pytest.mark.parametrize(
    "extra",
    [{"api_key": "test-key"}, {"headers": {}}, {"source": "client"}, {"configuration_id": ""}],
)
def test_model_reference_rejects_mixed_forms(extra: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        models.HTTPModelReference.model_validate({**REFERENCE, **extra})


@pytest.mark.parametrize("body", ["%%%", "A", "Zg", " Zg==", "Zg==\n", "-_=="])
def test_request_body_requires_standard_padded_base64(body: str) -> None:
    params = {**FIXTURES["requests"][0]["wire"]["params"], "body_base64": body}
    with pytest.raises(ValidationError):
        models.HTTPRequestParams.model_validate(params)


@pytest.mark.parametrize(
    ("model", "wire"),
    [
        (
            models.StagehandInitWireParams,
            {
                "protocol_version": "2.1.0",
                "client_info": {"name": "test", "version": "1"},
                "connections": {},
                "api_key": "test-key",
            },
        ),
        *[
            (
                model,
                {
                    "page_id": "page-1",
                    "instruction": "read title",
                    "scope_id": "call-1",
                    "options": {"model": {"model_name": "openai/gpt-5", "api_key": "test-key"}},
                },
            )
            for model in (
                models.StagehandActWireParams,
                models.StagehandObserveWireParams,
                models.StagehandExtractWireParams,
            )
        ],
    ],
)
def test_connection_forms_reject_mixed_inputs(model: type[BaseModel], wire: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        model.model_validate(wire)


@pytest.mark.parametrize(
    "overrides", [{}, {"act": REFERENCE}, {"observe": REFERENCE}, {"extract": REFERENCE}]
)
def test_batch_method_defaults_are_optional(overrides: dict[str, Any]) -> None:
    assert (
        models.BatchModelOverrides.model_validate(overrides).model_dump(
            mode="json", by_alias=True, exclude_unset=True
        )
        == overrides
    )


@pytest.mark.parametrize(
    "overrides", [{"fast": REFERENCE}, {"act": {"model_name": "openai/gpt-5"}}, []]
)
def test_batch_method_defaults_reject_invalid_shapes(overrides: object) -> None:
    with pytest.raises(ValidationError):
        models.BatchModelOverrides.model_validate(overrides)


@pytest.mark.parametrize(
    "params",
    [
        {"scope_id": "", "model": {"model_name": "openai/gpt-5"}},
        {"scope_id": "batch-1", "model": {}},
        {"scope_id": "batch-1", "model": REFERENCE},
        {"scope_id": "batch-1", "model": {"model_name": "openai/gpt-5", "headers": {"X-Test": 1}}},
    ],
)
def test_model_registration_rejects_invalid_shapes(params: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        models.HTTPRegisterModelParams.model_validate(params)
