import json
import re
from pathlib import Path
from typing import assert_type, cast

import jsonschema
import pytest
from pydantic import ValidationError

from stagehand import AriaRole, Locator
from stagehand._generated.models import LocatorChain, PageRef, RoleSelectorQuery
from stagehand.page import Page
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


async def test_role_methods_are_lazy_preserve_positions_and_dispatch_options() -> None:
    recording = RecordingRPCClient({"locator.click": {"clicked": True}, "locator.count": 2})
    page = Page(cast(RPCClient, recording), PageRef(page_id="p"))
    role: AriaRole = "button"
    root = assert_type(
        page.get_by_role(role, name="Save >> now", exact=True, disabled=False), Locator
    )
    step = {
        "type": "query",
        "selector": {
            "kind": "role",
            "value": "button",
            "name": "Save >> now",
            "exact": True,
            "disabled": False,
        },
    }
    nested = root.get_by_role("checkbox", checked="mixed")
    assert nested.descriptor.model_dump(mode="json", exclude_unset=True) == {
        "page_id": "p",
        "chain": {
            "steps": [
                step,
                {
                    "type": "query",
                    "selector": {
                        "kind": "role",
                        "value": "checkbox",
                        "checked": "mixed",
                        "exact": False,
                    },
                },
            ]
        },
    }
    assert root.descriptor.model_dump(mode="json", exclude_unset=True) == {
        "page_id": "p",
        "chain": {"steps": [step]},
    }
    cards = page.locator(".card").nth(1)
    buttons = cards.get_by_role("button", name="Save >> now", exact=True, disabled=False)
    scoped = buttons.nth(2).locator("span").get_by_text("label")
    steps = [
        {"type": "query", "selector": {"kind": "css", "value": ".card"}},
        {"type": "nth", "index": 1},
        step,
        {"type": "nth", "index": 2},
        {"type": "query", "selector": {"kind": "css", "value": "span"}},
        {"type": "query", "selector": {"kind": "textMatch", "value": "label", "exact": False}},
    ]
    assert scoped.descriptor.model_dump(mode="json", exclude_unset=True) == {
        "page_id": "p",
        "chain": {"steps": steps},
    }
    assert cards.descriptor.model_dump(exclude_unset=True) == {
        "page_id": "p",
        "selector": ".card",
        "nth": 1,
    }
    assert len(buttons.descriptor.model_dump()["chain"]["steps"]) == 3
    assert recording.calls == []
    await root.click(timeout=0)
    assert recording.calls[-1][1].model_dump(mode="json", exclude_unset=True) == {
        "page_id": "p",
        "chain": {"steps": [step]},
        "options": {"timeout": 0},
    }
    assert await scoped.count() == 2
    for invalid in ("Button", "fake", 42, None):
        with pytest.raises(ValidationError):
            page.get_by_role(cast(AriaRole, invalid))
        with pytest.raises(ValidationError):
            cards.get_by_role(cast(AriaRole, invalid))
    with pytest.raises(ValidationError):
        page.get_by_role("button", name=cast(str, re.compile("Save")))
    with pytest.raises(ValidationError):
        cards.get_by_role("button", checked=True)
    with pytest.raises(ValidationError):
        page.get_by_role("button", exact=cast(bool, None))
    with pytest.raises(TypeError):
        page.get_by_role("button", include_hidden=False)  # ty: ignore[unknown-argument]
    assert len(recording.calls) == 2


@pytest.mark.parametrize("selector", FIXTURES["valid"])
async def test_public_role_methods_serialize_supported_options(selector: dict[str, object]) -> None:
    recording = RecordingRPCClient({"locator.count": 1})
    page = Page(cast(RPCClient, recording), PageRef(page_id="p"))
    options = {key: value for key, value in selector.items() if key not in {"kind", "value"}}
    for scope in (page, page.locator(".scope")):
        locator = scope.get_by_role(selector["value"], **options)  # ty: ignore[invalid-argument-type]
        await locator.count()
        params = recording.calls[-1][1].model_dump(mode="json", exclude_unset=True)
        assert params["chain"]["steps"][-1] == {
            "type": "query",
            "selector": {"exact": False, **selector},
        }


def test_optional_role_filters_can_be_omitted_with_none() -> None:
    recording = RecordingRPCClient({})
    page = Page(cast(RPCClient, recording), PageRef(page_id="p"))
    locator = page.get_by_role("button", name=None, pressed=None, disabled=None)
    assert locator.descriptor.model_dump(mode="json", exclude_unset=True) == {
        "page_id": "p",
        "chain": {
            "steps": [
                {"type": "query", "selector": {"kind": "role", "value": "button", "exact": False}}
            ]
        },
    }
    assert recording.calls == []
