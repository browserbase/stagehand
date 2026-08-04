import json
from pathlib import Path
from types import UnionType
from typing import Union, assert_type, get_args, get_origin, get_type_hints, is_typeddict

import pytest
from pydantic import ValidationError

from stagehand._generated import input_types, models

PROTOCOL_PATH = Path(__file__).parents[2] / "protocol" / "stagehand.v4.json"
PROTOCOL = json.loads(PROTOCOL_PATH.read_text())
METHODS = PROTOCOL["properties"]["methods"]["properties"]
NOTIFICATIONS = PROTOCOL["properties"]["notifications"]["properties"]


def _is_typed_dict_input(value: object) -> bool:
    if is_typeddict(value):
        return True
    return get_origin(value) in (Union, UnionType) and all(
        _is_typed_dict_input(member) for member in get_args(value)
    )


@pytest.mark.parametrize("method_name", METHODS)
def test_every_registered_protocol_method_has_generated_python_params_input(
    method_name: str,
) -> None:
    reference = METHODS[method_name]["properties"]["params"]["$ref"]
    input_name = reference.removeprefix("#/$defs/")
    input_type = getattr(input_types, input_name, None)

    assert _is_typed_dict_input(input_type), (
        f"{method_name}.params references missing Python input type {input_name}"
    )


@pytest.mark.parametrize("notification_name", NOTIFICATIONS)
def test_every_registered_notification_has_generated_python_params_input(
    notification_name: str,
) -> None:
    reference = NOTIFICATIONS[notification_name]["properties"]["params"]["$ref"]
    input_name = reference.removeprefix("#/$defs/")
    input_type = getattr(input_types, input_name, None)

    assert _is_typed_dict_input(input_type), (
        f"{notification_name}.params references missing Python input type {input_name}"
    )


def test_every_generated_typed_dict_resolves_its_references() -> None:
    namespace = vars(input_types)
    for value in namespace.values():
        if is_typeddict(value):
            get_type_hints(
                value,
                globalns=namespace,
                localns=namespace,
                include_extras=True,
            )


def test_generated_typed_dicts_are_plain_dictionary_inputs() -> None:
    options = input_types.PageNavigationOptions(wait_until="domcontentloaded")

    assert_type(options, input_types.PageNavigationOptions)
    assert type(options) is dict
    assert options == {"wait_until": "domcontentloaded"}
    assert input_types.PageNavigationOptions.__required_keys__ == frozenset()
    assert input_types.PageNavigationOptions.__optional_keys__ == frozenset({
        "wait_until",
        "timeout",
    })


def test_generated_pydantic_params_validate_nested_typed_dicts() -> None:
    params_input = input_types.PageGotoParams(
        page_id="page-1",
        url="https://example.com",
        options=input_types.PageNavigationOptions(wait_until="domcontentloaded"),
    )

    params = models.PageGotoParams.model_validate(params_input)

    assert isinstance(params.options, models.PageNavigationOptions)
    assert params.options.wait_until == models.LoadState.domcontentloaded

    invalid_params = {
        **params_input,
        "options": {"timeout": -1},
    }
    with pytest.raises(ValidationError) as error:
        models.PageGotoParams.model_validate(invalid_params)

    assert error.value.errors()[0]["loc"] == ("options", "timeout")
    assert error.value.errors()[0]["type"] == "greater_than"
