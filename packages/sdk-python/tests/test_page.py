from __future__ import annotations

from typing import cast

import pytest
from pydantic import BaseModel

from stagehand import PageNavigationOptions
from stagehand._generated.models import (
    PageEvaluateResult,
    PageGotoParams,
    PageIdParams,
    PageRef,
    PageUrlResult,
)
from stagehand.page import Page
from stagehand.rpc_client import RPCClient

from ._support import RecordingRPCClient


def test_public_options_explicit_form_builds_a_typed_dictionary() -> None:
    options = PageNavigationOptions(wait_until="domcontentloaded", timeout=5_000)

    assert options == {"wait_until": "domcontentloaded", "timeout": 5_000}


class EvaluationResult(BaseModel):
    answer: bool


@pytest.mark.asyncio
async def test_page_navigation_uses_generated_wire_models_and_updates_the_page_reference() -> None:
    recording = RecordingRPCClient({
        "page.goto": PageRef(page_id="page-2", url="https://example.com"),
        "page.title": "Example Domain",
    })
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    returned = await page.goto(
        "https://example.com",
        {"wait_until": "domcontentloaded", "timeout": 5_000},
    )
    title = await page.title()

    assert returned is page
    assert page.page_id == "page-2"
    assert title == "Example Domain"
    method, params, result_model = recording.calls[0]
    assert method == "page.goto"
    assert params == PageGotoParams.model_validate({
        "page_id": "page-1",
        "url": "https://example.com",
        "options": {"wait_until": "domcontentloaded", "timeout": 5_000},
    })
    assert result_model is PageRef


@pytest.mark.asyncio
async def test_page_navigation_validates_typed_options_with_the_wire_model() -> None:
    page = Page(
        cast(RPCClient, RecordingRPCClient()),
        PageRef(page_id="page-1"),
    )

    with pytest.raises(ValueError, match="greater than 0"):
        await page.goto(
            "https://example.com",
            cast(PageNavigationOptions, {"timeout": -1}),
        )


@pytest.mark.asyncio
async def test_page_url_returns_a_scalar_string() -> None:
    recording = RecordingRPCClient({"page.url": "https://example.com/path"})
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    assert await page.url() == "https://example.com/path"
    assert recording.calls == [
        ("page.url", PageIdParams(page_id="page-1"), PageUrlResult),
    ]


def test_page_locator_keeps_the_page_identifier_internal() -> None:
    recording = RecordingRPCClient()
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    locator = page.locator("a.more-info")

    assert locator.page_id == "page-1"
    assert locator.selector == "a.more-info"


def test_page_does_not_expose_stagehand_ai_methods() -> None:
    page = Page(cast(RPCClient, RecordingRPCClient()), PageRef(page_id="page-1"))

    assert not hasattr(page, "act")
    assert not hasattr(page, "observe")
    assert not hasattr(page, "extract")


@pytest.mark.asyncio
async def test_page_evaluate_returns_json_or_a_requested_typed_result() -> None:
    recording = RecordingRPCClient({
        "page.evaluate": PageEvaluateResult.model_validate({"value": {"answer": True}})
    })
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    raw = await page.evaluate("({ answer: true })")
    typed = await page.evaluate("({ answer: true })", result_type=EvaluationResult)

    assert raw == {"answer": True}
    assert typed == EvaluationResult(answer=True)
