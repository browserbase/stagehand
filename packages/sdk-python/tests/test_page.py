from __future__ import annotations

from typing import cast

import pytest
from pydantic import BaseModel

from stagehand import WebMCPInvocation, WebMCPTool, WebMCPToolResponse
from stagehand._generated.models import (
    PageEvaluateResult,
    PageGotoParams,
    PageIdParams,
    PageRef,
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
        "page.goto": PageRef(page_id="page-2", url="https://example.com"),
        "page.title": "Example Domain",
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
