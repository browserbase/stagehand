import json
from pathlib import Path
from typing import cast

import pytest
from pydantic import ValidationError

from stagehand._generated.models import LocatorChain, RoleSelectorQuery
from stagehand.locator import Locator
from stagehand.rpc_client import RPCClient

from ._support import RecordingRPCClient

FIXTURES = json.loads(
    (Path(__file__).parents[2] / "protocol/tests/fixtures/role-selector-wire.json").read_text()
)


@pytest.mark.parametrize("selector", FIXTURES["valid"])
def test_role_wire_contract(selector: dict[str, object]) -> None:
    assert (
        RoleSelectorQuery.model_validate(selector).model_dump(mode="json", exclude_unset=True)
        == selector
    )
    chain = {"steps": [{"type": "query", "selector": selector}]}
    assert LocatorChain.model_validate(chain).model_dump(mode="json", exclude_unset=True) == chain


@pytest.mark.parametrize("selector", FIXTURES["invalid"])
def test_invalid_role_wire_contract(selector: dict[str, object]) -> None:
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
