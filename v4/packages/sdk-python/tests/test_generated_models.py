import json
from pathlib import Path

import pytest
from pydantic import BaseModel, ValidationError

from stagehand._generated import models

PROTOCOL_PATH = Path(__file__).parents[2] / "protocol" / "stagehand.v4.json"
PROTOCOL = json.loads(PROTOCOL_PATH.read_text())
METHODS = PROTOCOL["properties"]["methods"]["properties"]
NOTIFICATIONS = PROTOCOL["properties"]["notifications"]["properties"]


@pytest.mark.parametrize(
    ("method_name", "field_name"),
    [(method_name, field_name) for method_name in METHODS for field_name in ("params", "result")],
)
def test_every_registered_protocol_method_has_generated_python_models(
    method_name: str,
    field_name: str,
) -> None:
    reference = METHODS[method_name]["properties"][field_name]["$ref"]
    model_name = reference.removeprefix("#/$defs/")
    model = getattr(models, model_name, None)

    assert isinstance(model, type), (
        f"{method_name}.{field_name} references missing Python model {model_name}"
    )
    assert issubclass(model, BaseModel)


@pytest.mark.parametrize("notification_name", NOTIFICATIONS)
def test_every_registered_notification_has_a_generated_python_params_model(
    notification_name: str,
) -> None:
    reference = NOTIFICATIONS[notification_name]["properties"]["params"]["$ref"]
    model_name = reference.removeprefix("#/$defs/")
    model = getattr(models, model_name, None)

    assert isinstance(model, type), (
        f"{notification_name}.params references missing Python model {model_name}"
    )
    assert issubclass(model, BaseModel)


def test_every_generated_model_resolves_its_references() -> None:
    for value in vars(models).values():
        if isinstance(value, type) and issubclass(value, BaseModel):
            value.model_rebuild()


def test_generated_models_validate_and_serialize_wire_values() -> None:
    params = models.PageGotoParams.model_validate({
        "page_id": "page-1",
        "url": "https://example.com",
    })

    assert params.url == "https://example.com"
    assert params.model_dump(mode="json", exclude_unset=True) == {
        "page_id": "page-1",
        "url": "https://example.com",
    }


def test_generated_models_retain_cross_field_validation() -> None:
    with pytest.raises(ValidationError, match="fullPage and clip"):
        models.PageScreenshotOptions.model_validate({
            "full_page": True,
            "clip": {"x": 0, "y": 0, "width": 100, "height": 100},
        })

    with pytest.raises(ValidationError, match="quality"):
        models.PageScreenshotOptions.model_validate({"type": "png", "quality": 80})

    with pytest.raises(ValidationError, match="Unrecognized key"):
        models.Locator.model_validate({"page": {}})

    with pytest.raises(ValidationError, match="/v1/traces"):
        models.TelemetryConfig.model_validate({
            "traces": {"endpoint": "https://example.com/collector"}
        })

    with pytest.raises(ValidationError):
        models.TelemetryConfig.model_validate({"traces": {"endpoint": "not a URL"}})


def test_generated_models_serialize_protocol_defaults() -> None:
    telemetry = models.TelemetryConfig.model_validate({
        "traces": {"endpoint": "https://example.com/v1/traces"}
    })

    assert telemetry.model_dump(mode="json", exclude_unset=True) == {
        "traces": {
            "endpoint": "https://example.com/v1/traces",
            "headers": {},
        }
    }
