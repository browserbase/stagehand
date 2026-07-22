from __future__ import annotations

from typing import cast

import pytest
from pydantic import BaseModel

from stagehand import ModelConfig, ProtocolLocator
from stagehand._generated.models import (
    Action,
    ActResult,
    ActResultData,
    ExtractResult,
    ObserveResult,
    PageEvaluateResult,
    PageGotoParams,
    PageRef,
    PageTitleResult,
    StagehandActParams,
    StagehandExtractParams,
    StagehandObserveParams,
)
from stagehand.client_models import CacheOptions
from stagehand.page import Page
from stagehand.rpc_client import RPCClient

from ._support import RecordingRPCClient


class PageInfo(BaseModel):
    heading: str


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
        timeout_ms=5_000,
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
        "options": {"wait_until": "domcontentloaded", "timeout_ms": 5_000},
    })
    assert result_model is PageRef


@pytest.mark.asyncio
async def test_page_ai_methods_validate_their_wire_results_and_public_output() -> None:
    action = Action(selector="a", description="More information")
    act_result = ActResultData(
        success=True,
        message="Clicked the link",
        action_description="Clicked the more information link",
        actions=[action],
    )
    recording = RecordingRPCClient({
        "stagehand.act": ActResult(result=act_result),
        "stagehand.observe": ObserveResult(result=[action]),
        "stagehand.extract": ExtractResult(result={"heading": "Example Domain"}),
    })
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))
    model = ModelConfig.model_validate({"model_name": "openai/gpt-4.1-mini"})
    locator = ProtocolLocator(css="main")

    action_result = await page.act(
        "Click the link",
        model=model,
        timeout=30_000,
        locator=locator,
        cache=CacheOptions(threshold=1),
    )
    actions = await page.observe(instruction="Find the link", model=model, locator=locator)
    page_info = await page.extract(
        instruction="Extract the heading",
        schema=PageInfo,
        model=model,
        locator=locator,
    )

    assert action_result == act_result
    assert actions == [action]
    assert page_info == PageInfo(heading="Example Domain")
    act_method, act_params, act_result_model = recording.calls[0]
    assert act_method == "stagehand.act"
    assert isinstance(act_params, StagehandActParams)
    assert act_params.page_id == "page-1"
    assert act_params.input == "Click the link"
    assert act_params.options is not None
    assert act_params.options.model == model
    assert act_params.options.timeout == 30_000
    assert act_params.options.locator == locator
    assert act_params.options.cache is not None
    assert act_params.options.cache.model_dump() == {"threshold": 1}
    assert act_result_model is ActResult
    observe_method, observe_params, observe_result = recording.calls[1]
    assert observe_method == "stagehand.observe"
    assert isinstance(observe_params, StagehandObserveParams)
    assert observe_params.page_id == "page-1"
    assert observe_params.instruction == "Find the link"
    assert observe_params.options is not None
    assert observe_params.options.model == model
    assert observe_params.options.locator == locator
    assert observe_result is ObserveResult
    extract_method, extract_params, extract_result = recording.calls[2]
    assert extract_method == "stagehand.extract"
    assert isinstance(extract_params, StagehandExtractParams)
    assert extract_params.options is not None
    assert extract_params.options.model == model
    assert extract_params.options.locator == locator
    assert extract_params.schema_ is not None
    schema = extract_params.schema_.model_dump()
    assert isinstance(schema, dict)
    properties = schema["properties"]
    assert isinstance(properties, dict)
    heading = properties["heading"]
    assert isinstance(heading, dict)
    assert heading["type"] == "string"
    assert extract_result is ExtractResult


def test_page_locator_keeps_the_page_identifier_internal() -> None:
    recording = RecordingRPCClient()
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    locator = page.locator("a.more-info")

    assert locator.page_id == "page-1"
    assert locator.selector == "a.more-info"


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
