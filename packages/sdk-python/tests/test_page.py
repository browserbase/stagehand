from __future__ import annotations

from typing import cast

import pytest
from pydantic import BaseModel

from stagehand._generated.models import (
    AcknowledgementResult,
    PageEvaluateResult,
    PageGotoParams,
    PageRef,
    PageTitleResult,
)
from stagehand.page import Page
from stagehand.rpc_client import RPCClient

from ._support import RecordingRPCClient


class EvaluationResult(BaseModel):
    answer: bool


@pytest.mark.asyncio
async def test_page_navigation_uses_generated_wire_models_and_updates_the_page_reference() -> None:
    recording = RecordingRPCClient({
        "page.goto": PageRef(page_id="page-2", url="https://example.com"),
        "page.title": PageTitleResult(title="Example Domain"),
    })
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    returned = await page.goto(
        "https://example.com",
        wait_until="domcontentloaded",
        timeout=5_000,
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


@pytest.mark.asyncio
async def test_page_side_effects_use_acknowledgement_results() -> None:
    methods = [
        "page.type",
        "page.key_press",
        "page.add_init_script",
        "page.set_extra_http_headers",
        "page.set_viewport_size",
        "page.wait_for_load_state",
        "page.wait_for_timeout",
        "page.close",
    ]
    recording = RecordingRPCClient({method: AcknowledgementResult(root=True) for method in methods})
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    await page.type("hello")
    await page.key_press("Enter")
    await page.add_init_script("globalThis.ready = true")
    await page.set_extra_http_headers({"x-test": "true"})
    await page.set_viewport_size(1280, 720)
    await page.wait_for_load_state("load")
    await page.wait_for_timeout(100)
    await page.close()

    assert [(method, result_model) for method, _, result_model in recording.calls] == [
        (method, AcknowledgementResult) for method in methods
    ]
