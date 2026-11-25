import json
from pathlib import Path
from typing import cast

import jsonschema
import pytest
from pydantic import ValidationError

from stagehand._generated.models import LocatorChain, RoleSelectorQuery
from stagehand.locator import Locator
from stagehand.rpc_client import RPCClient

from ._support import RecordingRPCClient

FIXTURES = json.loads(
    (Path(__file__).parents[2] / "protocol/tests/fixtures/role-selector-wire.json").read_text()
)

PROTOCOL = json.loads((Path(__file__).parents[2] / "protocol/stagehand.v4.json").read_text())
ROLE_SCHEMA = {"$ref": "#/$defs/RoleSelectorQuery", "$defs": PROTOCOL["$defs"]}


@pytest.mark.parametrize("selector", FIXTURES["valid"])
def test_role_wire_contract(selector: dict[str, object]) -> None:
    jsonschema.validate(selector, ROLE_SCHEMA)
    assert (
        RoleSelectorQuery.model_validate(selector).model_dump(mode="json", exclude_unset=True)
        == selector
    )
    chain = {"steps": [{"type": "query", "selector": selector}]}
    assert LocatorChain.model_validate(chain).model_dump(mode="json", exclude_unset=True) == chain


@pytest.mark.parametrize("selector", FIXTURES["invalid"])
def test_invalid_role_wire_contract(selector: dict[str, object]) -> None:
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(selector, ROLE_SCHEMA)
    with pytest.raises(ValidationError):
        RoleSelectorQuery.model_validate(selector)
    with pytest.raises(ValidationError):
        LocatorChain.model_validate({"steps": [{"type": "query", "selector": selector}]})


async def test_rebuilding_role_chains_preserves_omitted_options() -> None:
    recording = RecordingRPCClient({"locator.count": 1})
    root = Locator(cast(RPCClient, recording), page_id="p", selector=".card")
    roles = root._append_steps(
        [{"type": "query", "selector": {"kind": "role", "value": "button", "disabled": False}}],
        root.selector,
    )
    selected = roles.nth(0).locator("span")
    assert await selected.count() == 1
    assert recording.calls[-1][1].model_dump(mode="json", exclude_unset=True) == {
        "page_id": "p",
        "chain": {
            "steps": [
                {"type": "query", "selector": {"kind": "css", "value": ".card"}},
                {
                    "type": "query",
                    "selector": {"kind": "role", "value": "button", "disabled": False},
                },
                {"type": "nth", "index": 0},
                {"type": "query", "selector": {"kind": "css", "value": "span"}},
            ]
        },
    }


def test_role_assignment_preserves_omitted_options() -> None:
    query = RoleSelectorQuery.model_validate({"kind": "role", "value": "button"})
    query.name = "Save"
    query.pressed = False
    assert query.model_dump(mode="json", exclude_unset=True) == {
        "kind": "role",
        "value": "button",
        "name": "Save",
        "pressed": False,
    }


@pytest.mark.parametrize(
    "option", ["name", "exact", "checked", "pressed", "selected", "expanded", "disabled", "level"]
)
def test_role_assignment_rejects_explicit_null(option: str) -> None:
    query = RoleSelectorQuery.model_validate({"kind": "role", "value": "button"})
    with pytest.raises(ValidationError, match="cannot be null"):
        setattr(query, option, None)


@pytest.mark.parametrize(
    "options, field, value",
    [
        ({"value": "button"}, "checked", True),
        ({"value": "radio"}, "checked", "mixed"),
        ({"value": "button", "pressed": True}, "value", "checkbox"),
    ],
)
def test_role_assignment_rejects_unsupported_states(
    options: dict[str, object],
    field: str,
    value: object,
) -> None:
    query = RoleSelectorQuery.model_validate({"kind": "role", **options})
    with pytest.raises(ValidationError, match="not supported"):
        setattr(query, field, value)
