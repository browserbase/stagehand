from __future__ import annotations

from typing import cast

import pytest
from pydantic import BaseModel

from stagehand import Response, WebMCPInvocation, WebMCPTool, WebMCPToolResponse
from stagehand._generated.models import (
    NavigationResponseDescriptor,
    PageClickParams,
    PageDragAndDropParams,
    PageEvaluateResult,
    PageGotoParams,
    PageHoverParams,
    PageIdParams,
    PageNavigationResult,
    PageRef,
    PageScrollParams,
    PageUrlResult,
    PageVoidResult,
    PageWebMCPCancelInvocationParams,
    PageWebMCPInvocationResultParams,
    PageWebMCPInvokeToolParams,
    PageWebMCPToolsParams,
    PageWebMCPToolsResult,
    WebMCPInvocationDescriptor,
    WebMCPResultOptions,
    WebMCPToolsOptions,
)
from stagehand._generated.models import (
    WebMCPInvocationStatus as WireWebMCPInvocationStatus,
)
from stagehand._generated.models import (
    WebMCPToolResponse as WireWebMCPToolResponse,
)
from stagehand.page import Page
from stagehand.rpc_client import RPCClient

from ._support import RecordingRPCClient


class EvaluationResult(BaseModel):
    answer: bool


@pytest.mark.asyncio
async def test_page_navigation_uses_generated_wire_models_and_updates_the_page_reference() -> None:
    recording = RecordingRPCClient({
        "page.goto": PageNavigationResult(
            page=PageRef(page_id="page-2", url="https://example.com"),
            response=NavigationResponseDescriptor(
                response_id="response-1",
                url="https://example.com",
                status=200,
                status_text="OK",
                headers={"content-type": "text/html"},
                from_service_worker=False,
            ),
        ),
        "page.title": "Example Domain",
    })
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    returned = await page.goto(
        "https://example.com",
        wait_until="domcontentloaded",
        timeout=5_000,
    )
    title = await page.title()

    assert isinstance(returned, Response)
    assert returned.url == "https://example.com"
    assert page.page_id == "page-2"
    assert title == "Example Domain"
    method, params, result_model = recording.calls[0]
    assert method == "page.goto"
    assert params == PageGotoParams.model_validate({
        "page_id": "page-1",
        "url": "https://example.com",
        "options": {"wait_until": "domcontentloaded", "timeout": 5_000},
    })
    assert result_model is PageNavigationResult


@pytest.mark.asyncio
async def test_page_navigation_methods_return_none_without_a_network_response() -> None:
    recording = RecordingRPCClient({
        "page.reload": PageNavigationResult(
            page=PageRef(page_id="page-2"),
            response=None,
        ),
        "page.go_back": PageNavigationResult(
            page=PageRef(page_id="page-3"),
            response=None,
        ),
        "page.go_forward": PageNavigationResult(
            page=PageRef(page_id="page-4"),
            response=None,
        ),
    })
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    assert await page.reload() is None
    assert page.page_id == "page-2"
    assert await page.go_back() is None
    assert page.page_id == "page-3"
    assert await page.go_forward() is None
    assert page.page_id == "page-4"

    assert [method for method, _, _ in recording.calls] == [
        "page.reload",
        "page.go_back",
        "page.go_forward",
    ]


@pytest.mark.asyncio
async def test_page_url_returns_a_scalar_string() -> None:
    recording = RecordingRPCClient({"page.url": "https://example.com/path"})
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    assert await page.url() == "https://example.com/path"
    assert recording.calls == [
        ("page.url", PageIdParams(page_id="page-1"), PageUrlResult),
    ]


@pytest.mark.asyncio
async def test_page_coordinate_interactions_return_none() -> None:
    void_result = PageVoidResult(ok=True)
    recording = RecordingRPCClient({
        "page.click": void_result,
        "page.hover": void_result,
        "page.scroll": void_result,
        "page.drag_and_drop": void_result,
    })
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    assert await page.click(10, 20, button="right", click_count=2) is None
    assert await page.hover(30, 40) is None
    assert await page.scroll(50, 60, -25, 400) is None
    assert (
        await page.drag_and_drop(
            1,
            2,
            3,
            4,
            button="left",
            steps=5,
            delay=10,
        )
        is None
    )

    assert recording.calls == [
        (
            "page.click",
            PageClickParams.model_validate({
                "page_id": "page-1",
                "x": 10,
                "y": 20,
                "options": {"button": "right", "click_count": 2},
            }),
            PageVoidResult,
        ),
        (
            "page.hover",
            PageHoverParams(page_id="page-1", x=30, y=40),
            PageVoidResult,
        ),
        (
            "page.scroll",
            PageScrollParams(
                page_id="page-1",
                x=50,
                y=60,
                delta_x=-25,
                delta_y=400,
            ),
            PageVoidResult,
        ),
        (
            "page.drag_and_drop",
            PageDragAndDropParams.model_validate({
                "page_id": "page-1",
                "from_x": 1,
                "from_y": 2,
                "to_x": 3,
                "to_y": 4,
                "options": {
                    "button": "left",
                    "steps": 5,
                    "delay": 10,
                },
            }),
            PageVoidResult,
        ),
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


@pytest.mark.asyncio
async def test_page_wraps_callable_webmcp_tools_and_invocations_with_owned_identity() -> None:
    wire_result = WireWebMCPToolResponse.model_validate({
        "invocation_id": "invocation-1",
        "status": WireWebMCPInvocationStatus.completed,
        "output": {"resultValue": "done"},
    })
    recording = RecordingRPCClient({
        "page.webmcp_tools": {
            "tools": [
                {
                    "name": "search",
                    "description": "Search this site",
                    "input_schema": {
                        "type": "object",
                        "properties": {"searchQuery": {"type": "string"}},
                    },
                    "annotations": {"read_only": True},
                    "frame_id": "frame-1",
                    "backend_node_id": 42,
                }
            ]
        },
        "page.webmcp_invoke_tool": {
            "invocation_id": "invocation-1",
            "tool_name": "search",
            "frame_id": "frame-1",
            "input": {"searchQuery": "Stagehand"},
        },
        "page.webmcp_invocation_result": TimeoutError(
            "RPC request timed out: page.webmcp_invocation_result"
        ),
        "page.webmcp_cancel_invocation": {"ok": True},
    })
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    tools = await page.tools(timeout=250)
    tool = tools[0]
    assert isinstance(tool, WebMCPTool)
    assert tool.name == "search"
    assert tool.description == "Search this site"
    assert tool.input_schema == {
        "type": "object",
        "properties": {"searchQuery": {"type": "string"}},
    }
    assert tool.annotations is not None
    assert tool.annotations.read_only is True
    assert tool.frame_id == "frame-1"
    assert tool.backend_node_id == 42

    invocation = await tool.invoke(input={"searchQuery": "Stagehand"})
    assert isinstance(invocation, WebMCPInvocation)
    assert invocation.invocation_id == "invocation-1"
    assert invocation.tool_name == "search"
    assert invocation.frame_id == "frame-1"
    assert invocation.input == {"searchQuery": "Stagehand"}
    await tool.invoke()

    with pytest.raises(TimeoutError, match="RPC request timed out"):
        await invocation.result(timeout=1)
    recording.responses["page.webmcp_invocation_result"] = wire_result
    result = await invocation.result(timeout=5_000)
    assert isinstance(result, WebMCPToolResponse)
    assert result.invocation_id == "invocation-1"
    assert result.status == "Completed"
    assert result.output == {"resultValue": "done"}
    assert await invocation.result(timeout=1) is result
    await invocation.cancel()

    assert recording.calls == [
        (
            "page.webmcp_tools",
            PageWebMCPToolsParams(
                page_id="page-1",
                options=WebMCPToolsOptions(timeout=250),
            ),
            PageWebMCPToolsResult,
        ),
        (
            "page.webmcp_invoke_tool",
            PageWebMCPInvokeToolParams.model_validate({
                "page_id": "page-1",
                "frame_id": "frame-1",
                "tool_name": "search",
                "input": {"searchQuery": "Stagehand"},
            }),
            WebMCPInvocationDescriptor,
        ),
        (
            "page.webmcp_invoke_tool",
            PageWebMCPInvokeToolParams(
                page_id="page-1",
                frame_id="frame-1",
                tool_name="search",
                input={},
            ),
            WebMCPInvocationDescriptor,
        ),
        (
            "page.webmcp_invocation_result",
            PageWebMCPInvocationResultParams(
                page_id="page-1",
                invocation_id="invocation-1",
                options=WebMCPResultOptions(timeout=1),
            ),
            WireWebMCPToolResponse,
        ),
        (
            "page.webmcp_invocation_result",
            PageWebMCPInvocationResultParams(
                page_id="page-1",
                invocation_id="invocation-1",
                options=WebMCPResultOptions(timeout=5_000),
            ),
            WireWebMCPToolResponse,
        ),
        (
            "page.webmcp_cancel_invocation",
            PageWebMCPCancelInvocationParams(
                page_id="page-1",
                invocation_id="invocation-1",
            ),
            PageVoidResult,
        ),
    ]
