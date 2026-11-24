import json
from pathlib import Path
from typing import TypedDict, assert_type, cast

import pytest

from stagehand._generated.input_types import LocatorQueryStep
from stagehand._generated.models import PageRef
from stagehand._locator_selectors import locator_steps
from stagehand.locator import Locator
from stagehand.page import Page
from stagehand.rpc_client import RPCClient
from stagehand.stagehand import _serialize_locator

from ._support import RecordingRPCClient

FIXTURES = json.loads(
    (
        Path(__file__).parents[2] / "protocol/tests/fixtures/locator-selector-normalization.json"
    ).read_text()
)


class SelectorFixture(TypedDict):
    selector: str
    steps: list[list[str]]


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda fixture: fixture["selector"])
def test_legacy_selector_normalization(fixture: SelectorFixture) -> None:
    assert [
        [step["type"], step["selector"]["kind"], step["selector"]["value"]]
        for step in locator_steps(fixture["selector"])
        if step["type"] != "nth"
    ] == fixture["steps"]


def query(value: str) -> LocatorQueryStep:
    return {"type": "query", "selector": {"kind": "css", "value": value}}


def test_chaining_is_lazy_and_preserves_branches_and_positions() -> None:
    recording = RecordingRPCClient()
    page = Page(cast(RPCClient, recording), PageRef(page_id="p"))
    cards = page.locator(".card").nth(1)
    buttons = cards.locator("button")
    selected = assert_type(buttons.nth(2).first(), Locator)
    assert cards.descriptor.model_dump(exclude_unset=True) == {
        "page_id": "p",
        "selector": ".card",
        "nth": 1,
    }
    steps = [query(".card"), {"type": "nth", "index": 1}, query("button")]
    assert buttons.descriptor.model_dump() == {"page_id": "p", "chain": {"steps": steps}}
    assert selected.descriptor.model_dump() == {
        "page_id": "p",
        "chain": {"steps": [*steps, {"type": "nth", "index": 2}, {"type": "nth", "index": 0}]},
    }
    assert cards.locator("input").descriptor.model_dump() == {
        "page_id": "p",
        "chain": {"steps": [*steps[:2], query("input")]},
    }
    assert recording.calls == []
    for index in [-1, 1.5, float("nan"), float("inf")]:
        with pytest.raises(ValueError):
            buttons.nth(cast(int, index))
    with pytest.raises(ValueError):
        buttons.locator(" ")


@pytest.mark.asyncio
async def test_chain_requests_preserve_options_masks_and_ai_scopes() -> None:
    recording = RecordingRPCClient({
        "locator.click": {"clicked": True},
        "locator.count": 2,
        "page.screenshot": {"data": ""},
    })
    page = Page(cast(RPCClient, recording), PageRef(page_id="p"))
    locator = page.locator("iframe >> .card").nth(1).locator("iframe >> button")
    chain = {
        "steps": [
            query("iframe"),
            {"type": "frame", "selector": {"kind": "css", "value": ".card"}},
            {"type": "nth", "index": 1},
            query("iframe"),
            {"type": "frame", "selector": {"kind": "css", "value": "button"}},
        ]
    }
    await locator.click(button="right", timeout=0)
    assert recording.calls[-1][1].model_dump(exclude_unset=True) == {
        "page_id": "p",
        "chain": chain,
        "options": {"button": "right", "timeout": 0},
    }
    assert await locator.count(timeout=1000) == 2
    assert recording.calls[-1][1].model_dump(exclude_unset=True) == {
        "page_id": "p",
        "chain": chain,
        "options": {"timeout": 1000},
    }
    await page.screenshot(mask=[locator])
    assert recording.calls[-1][1].model_dump(exclude_unset=True) == {
        "page_id": "p",
        "options": {"mask": [{"page_id": "p", "chain": chain}]},
    }
    for method in ("act", "observe", "extract"):
        assert _serialize_locator(locator, "p", method).model_dump() == {"chain": chain}
        with pytest.raises(TypeError, match="target page"):
            _serialize_locator(locator, "other", method)
