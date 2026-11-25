import json
import re
from pathlib import Path
from typing import TypedDict, assert_type, cast

import pytest
from pydantic import ValidationError

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
        if step["type"] == "query" or step["type"] == "frame"
    ] == fixture["steps"]


def query(value: str) -> LocatorQueryStep:
    return {"type": "query", "selector": {"kind": "css", "value": value}}


async def test_filters_are_lazy_preserve_branches_and_dispatch_in_order() -> None:
    recording = RecordingRPCClient({"locator.click": {"clicked": True}, "locator.count": 2})
    page = Page(cast(RPCClient, recording), PageRef(page_id="p"))
    cards = page.locator(".card")
    filtered = assert_type(
        cards.filter(has_text=" Billing >> 保存 ", has_not_text="Archived"), Locator
    )
    step = {"type": "filter", "has_text": " Billing >> 保存 ", "has_not_text": "Archived"}
    expected = {"page_id": "p", "chain": {"steps": [query(".card"), step]}}
    assert filtered.descriptor.model_dump(exclude_unset=True) == expected
    assert cards.descriptor.model_dump(exclude_unset=True) == {"page_id": "p", "selector": ".card"}
    assert cards.nth(1).filter(has_text="Billing").descriptor.model_dump(exclude_unset=True) == {
        "page_id": "p",
        "chain": {
            "steps": [
                query(".card"),
                {"type": "nth", "index": 1},
                {"type": "filter", "has_text": "Billing"},
            ]
        },
    }
    branch = filtered.nth(1).filter(has_not_text="Draft").locator("button").get_by_text("Save")
    assert branch.descriptor.model_dump(exclude_unset=True) == {
        "page_id": "p",
        "chain": {
            "steps": [
                query(".card"),
                step,
                {"type": "nth", "index": 1},
                {"type": "filter", "has_not_text": "Draft"},
                query("button"),
                {
                    "type": "query",
                    "selector": {"kind": "textMatch", "value": "Save", "exact": False},
                },
            ]
        },
    }
    assert filtered.descriptor.model_dump(exclude_unset=True) == expected
    assert recording.calls == []
    await filtered.click(timeout=0)
    assert recording.calls[-1][1].model_dump(exclude_unset=True) == {
        **expected,
        "options": {"timeout": 0},
    }
    assert await branch.count() == 2
    assert recording.calls[-1][1].model_dump(exclude_unset=True) == branch.descriptor.model_dump(
        exclude_unset=True
    )


@pytest.mark.parametrize(
    "options", [{}, {"has_text": ""}, {"has_not_text": ""}, {"has_text": "", "has_not_text": ""}]
)
def test_filter_preserves_empty_strings(options: dict[str, str]) -> None:
    recording = RecordingRPCClient()
    cards = Page(cast(RPCClient, recording), PageRef(page_id="p")).locator(".card")
    assert cards.filter(**options).descriptor.model_dump(exclude_unset=True) == {
        "page_id": "p",
        "chain": {"steps": [query(".card"), {"type": "filter", **options}]},
    }
    assert cards.filter(has_text=None, has_not_text=None).descriptor == cards.filter().descriptor
    assert recording.calls == []


def test_filter_rejects_unsupported_options_before_dispatch() -> None:
    recording = RecordingRPCClient()
    cards = Page(cast(RPCClient, recording), PageRef(page_id="p")).locator(".card")
    for key in ("has_text", "has_not_text"):
        for value in (re.compile("Billing"), 42, False, {"text": "Billing"}):
            with pytest.raises(ValidationError):
                cards.filter(**{key: cast(str, value)})
    for key in ("has", "has_not", "exact", "type"):
        with pytest.raises(TypeError):
            cards.filter(**{key: "Billing"})
    assert recording.calls == []


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
