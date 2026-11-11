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
    TextLocatorSelector,
    XPathLocatorSelector,
)
from stagehand._generated.models import PageRef
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

    assert recording.calls == []
    assert locator.descriptor.model_dump(exclude_unset=True) == {
        "page_id": "page-1",
        "selector": selector,
    }
    assert refined.selector == selector["value"]
    assert await refined.count() == 2
    assert recording.calls[0][1].model_dump(exclude_unset=True) == {
        "page_id": "page-1",
        "selector": selector,
        "nth": 1,
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
    assert refined.descriptor.selector.model_dump() == {"type": "text", "value": "Pay"}


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
                    "selector": {"type": "text", "value": "Private"},
                    "nth": 0,
                }
            ],
        },
    }


if TYPE_CHECKING:

    def check_public_inputs(page: Page) -> None:
        css: CssLocatorSelector = {"type": "css", "value": "button"}
        xpath: XPathLocatorSelector = {"type": "xpath", "value": "//button"}
        text: TextLocatorSelector = {"type": "text", "value": "Pay"}
        legacy: LegacyLocatorSelector = {"type": "legacy", "value": "iframe >> text=Pay"}
        assert_type(page.locator(css), Locator)
        page.locator(xpath)
        page.locator(text)
        page.locator(legacy)
        page.locator("button")
        page.locator({"type": "text"})  # ty: ignore[invalid-argument-type]
        page.locator({"type": "text", "value": 123})  # ty: ignore[invalid-argument-type]
        page.locator({"type": "unknown", "value": "button"})  # ty: ignore[invalid-argument-type]
