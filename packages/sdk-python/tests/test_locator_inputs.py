from copy import deepcopy
from typing import TYPE_CHECKING, assert_type, cast

import pytest
from pydantic import ValidationError

from stagehand import (
    CssLocatorSelector,
    LegacyLocatorSelector,
    Locator,
    LocatorInput,
    LocatorSelector,
    Page,
    PromptLocatorSelector,
    TextLocatorSelector,
    XPathLocatorSelector,
)
from stagehand._generated.models import LocatorChain, PageRef
from stagehand.rpc_client import RPCClient

from ._support import RecordingRPCClient


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "selector",
    [
        {"type": "css", "value": '[data-label="a >> b"]'},
        {"type": "xpath", "value": ".//button"},
        {"type": "text", "value": 'text="Pay" >> now'},
        {"type": "legacy", "value": "iframe >> text=Pay"},
    ],
)
async def test_structured_inputs_survive_refinement_and_actions(selector: LocatorSelector) -> None:
    recording = RecordingRPCClient({"locator.count": 2})
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))
    locator = page.locator(selector)
    refined = locator.first().nth(1)

    steps: list[dict[str, object]] = (
        [
            {"type": "query", "selector": {"type": "css", "value": "iframe"}, "nth": 0},
            {"type": "frame", "selector": {"type": "text", "value": "Pay"}},
        ]
        if selector["type"] == "legacy"
        else [{"type": "query", "selector": selector}]
    )
    assert recording.calls == []
    assert locator.descriptor.model_dump(exclude_unset=True) == {
        "page_id": "page-1",
        "selector": {"steps": steps},
    }
    assert refined.selector == selector["value"]
    assert await refined.count() == 2
    refined_steps = deepcopy(steps)
    refined_steps[-1]["nth"] = 1
    assert recording.calls[0][1].model_dump(exclude_unset=True) == {
        "page_id": "page-1",
        "selector": {"steps": refined_steps},
    }


@pytest.mark.parametrize(
    "selector",
    [
        {},
        {"type": "css"},
        {"type": "css", "value": ""},
        {"type": "css", "value": 123},
        {"type": "css", "value": "button", "text": "Pay"},
        {"type": "unknown", "value": "button"},
    ],
)
def test_invalid_inputs_fail_at_the_public_boundary(selector: object) -> None:
    recording = RecordingRPCClient()
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))
    with pytest.raises(ValidationError):
        page.locator(cast(LocatorInput, selector))
    assert recording.calls == []


def test_locator_copies_structured_inputs() -> None:
    page = Page(cast(RPCClient, RecordingRPCClient()), PageRef(page_id="page-1"))
    selector: TextLocatorSelector = {"type": "text", "value": "Pay"}
    locator = page.locator(selector)
    selector["value"] = "Changed"
    refined = locator.nth(2)
    assert refined.selector == "Pay"
    assert refined.descriptor.selector.model_dump(exclude_unset=True) == {
        "steps": [{"type": "query", "selector": {"type": "text", "value": "Pay"}, "nth": 2}]
    }


@pytest.mark.asyncio
async def test_structured_screenshot_masks_preserve_discriminator_and_index() -> None:
    recording = RecordingRPCClient({"page.screenshot": {"data": "iVBORw0KGgo="}})
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))
    await page.screenshot(mask=[page.locator({"type": "text", "value": "Private"}).first()])
    assert recording.calls[0][1].model_dump(exclude_unset=True) == {
        "page_id": "page-1",
        "options": {
            "mask": [
                {
                    "page_id": "page-1",
                    "selector": {
                        "steps": [
                            {
                                "type": "query",
                                "selector": {"type": "text", "value": "Private"},
                                "nth": 0,
                            }
                        ]
                    },
                }
            ],
        },
    }


@pytest.mark.asyncio
async def test_chaining_preserves_intermediate_indices_and_parent_locators() -> None:
    recording = RecordingRPCClient({"locator.count": 1})
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))
    cards = page.locator(".card").nth(1)
    payments = cards.locator({"type": "text", "value": "Pay"})
    second = payments.first().nth(2)
    assert cards.descriptor.selector.model_dump(exclude_unset=True) == {
        "steps": [
            {"type": "query", "selector": {"type": "css", "value": ".card"}, "nth": 1},
        ]
    }
    assert payments.nth_index is None
    await second.count()
    assert recording.calls[0][1].model_dump(exclude_unset=True) == {
        "page_id": "page-1",
        "selector": {
            "steps": [
                {"type": "query", "selector": {"type": "css", "value": ".card"}, "nth": 1},
                {"type": "query", "selector": {"type": "text", "value": "Pay"}, "nth": 2},
            ]
        },
    }
    # Mutating a child descriptor cannot alter a previously constructed parent.
    assert isinstance(second.descriptor.selector, LocatorChain)
    second.descriptor.selector.steps[0].root.nth = 4
    assert cards.nth_index == 1


def test_prompt_inputs_preserve_scope_and_description_without_requests() -> None:
    recording = RecordingRPCClient()
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))
    scope = page.locator({"type": "css", "value": "#application"}).nth(1)
    prompt: PromptLocatorSelector = {
        "type": "prompt",
        "value": '  the input labeled "Resume >> CV"  ',
    }
    locator = scope.locator(prompt)
    prompt["value"] = "Changed"
    assert locator.descriptor.model_dump(exclude_unset=True) == {
        "page_id": "page-1",
        "selector": {
            "steps": [
                {"type": "query", "selector": {"type": "css", "value": "#application"}, "nth": 1},
                {
                    "type": "query",
                    "selector": {"type": "prompt", "value": '  the input labeled "Resume >> CV"  '},
                },
            ],
        },
    }
    assert len(scope.descriptor.selector.steps) == 1
    assert recording.calls == []


def test_chaining_appends_normalized_legacy_frame_hops() -> None:
    page = Page(cast(RPCClient, RecordingRPCClient()), PageRef(page_id="page-1"))
    locator = page.locator(".panel").locator("iframe >> text=Pay").first()
    assert locator.descriptor.selector.model_dump(exclude_unset=True) == {
        "steps": [
            {"type": "query", "selector": {"type": "css", "value": ".panel"}},
            {"type": "query", "selector": {"type": "css", "value": "iframe"}, "nth": 0},
            {"type": "frame", "selector": {"type": "text", "value": "Pay"}, "nth": 0},
        ]
    }


if TYPE_CHECKING:

    def check_public_inputs(page: Page) -> None:
        css: CssLocatorSelector = {"type": "css", "value": "button"}
        xpath: XPathLocatorSelector = {"type": "xpath", "value": "//button"}
        text: TextLocatorSelector = {"type": "text", "value": "Pay"}
        prompt: PromptLocatorSelector = {"type": "prompt", "value": "the resume file input"}
        assert_type(page.locator(prompt), Locator)
        assert_type(page.locator(css).locator(prompt), Locator)
        legacy: LegacyLocatorSelector = {"type": "legacy", "value": "iframe >> text=Pay"}
        assert_type(page.locator(css), Locator)
        assert_type(page.locator(css).locator(text).first(), Locator)
        page.locator(xpath)
        page.locator(text)
        page.locator(legacy)
        page.locator("button")
        page.locator({"type": "text"})  # ty: ignore[invalid-argument-type]
        page.locator({"type": "text", "value": 123})  # ty: ignore[invalid-argument-type]
        page.locator({"type": "unknown", "value": "button"})  # ty: ignore[invalid-argument-type]
