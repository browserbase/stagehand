import json
import re
from pathlib import Path
from typing import TypedDict, assert_type, cast

import pytest

from stagehand._ai_options import _serialize_locator
from stagehand._generated.input_types import LocatorQueryStep
from stagehand._generated.models import PageRef
from stagehand._locator_selectors import locator_steps
from stagehand.locator import Locator
from stagehand.page import Page
from stagehand.rpc_client import RPCClient

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


async def test_text_queries_on_pages_and_positioned_locators() -> None:
    recording = RecordingRPCClient({"locator.click": {"clicked": True}, "locator.count": 2})
    page = Page(cast(RPCClient, recording), PageRef(page_id="p"))

    def text(value: str, exact: bool = False) -> LocatorQueryStep:
        return {"type": "query", "selector": {"kind": "textMatch", "value": value, "exact": exact}}

    root = assert_type(page.get_by_text("Save >> now", exact=True), Locator)
    assert root.descriptor.model_dump() == {
        "page_id": "p",
        "chain": {"steps": [text("Save >> now", True)]},
    }
    cards = page.locator(".card").nth(1)
    scoped = cards.get_by_text("").nth(2).locator("span").get_by_text("label")
    assert scoped.descriptor.model_dump() == {
        "page_id": "p",
        "chain": {
            "steps": [
                query(".card"),
                {"type": "nth", "index": 1},
                text(""),
                {"type": "nth", "index": 2},
                query("span"),
                text("label"),
            ]
        },
    }
    assert cards.descriptor.model_dump(exclude_unset=True) == {
        "page_id": "p",
        "selector": ".card",
        "nth": 1,
    }
    assert recording.calls == []
    await root.click(timeout=0)
    assert recording.calls[-1][1].model_dump(exclude_unset=True) == {
        **root.descriptor.model_dump(),
        "options": {"timeout": 0},
    }
    assert await scoped.count() == 2
    for invalid in (re.compile("Save"), {"text": "Save"}, None, 42):
        for get_by_text in (page.get_by_text, cards.get_by_text):
            with pytest.raises(TypeError, match="string matcher"):
                get_by_text(cast(str, invalid))
    with pytest.raises(TypeError, match="boolean"):
        root.get_by_text("Save", exact=cast(bool, "true"))


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
