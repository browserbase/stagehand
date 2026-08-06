from __future__ import annotations

import asyncio
import inspect
from collections.abc import Awaitable, Callable
from typing import TypeVar, cast, overload

import pytest
from pydantic import BaseModel, RootModel

from stagehand import Response, WebMCPInvocation, WebMCPTool, WebMCPToolResponse
from stagehand._generated.models import (
    NavigationResponseDescriptor,
    PageCDPEventNotification,
    PageClickParams,
    PageDragAndDropParams,
    PageEvaluateResult,
    PageGoBackParams,
    PageGoForwardParams,
    PageGotoParams,
    PageHoverParams,
    PageIdParams,
    PageNavigationResult,
    PageOffParams,
    PageOnParams,
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


ResultT = TypeVar("ResultT", bound=BaseModel)
RootResultT = TypeVar("RootResultT")


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


@pytest.mark.parametrize(
    ("rpc_method", "navigate"),
    [
        ("page.reload", lambda page: page.reload()),
        ("page.go_back", lambda page: page.go_back()),
        ("page.go_forward", lambda page: page.go_forward()),
    ],
)
@pytest.mark.asyncio
async def test_page_navigation_methods_wrap_non_null_responses(
    rpc_method: str,
    navigate: Callable[[Page], Awaitable[Response | None]],
) -> None:
    recording = RecordingRPCClient({
        rpc_method: PageNavigationResult(
            page=PageRef(page_id="page-2", url="https://example.com/final"),
            response=NavigationResponseDescriptor(
                response_id="response-1",
                url="https://example.com/final",
                status=201,
                status_text="Created",
                headers={"content-type": "text/html"},
                from_service_worker=True,
            ),
        )
    })
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    response = await navigate(page)

    assert isinstance(response, Response)
    assert response.url == "https://example.com/final"
    assert response.status == 201
    assert response.from_service_worker is True
    assert page.page_id == "page-2"
    assert len(recording.calls) == 1
    method, _, result_model = recording.calls[0]
    assert method == rpc_method
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
async def test_history_navigation_matches_goto_options() -> None:
    recording = RecordingRPCClient({
        "page.go_back": PageNavigationResult(page=PageRef(page_id="page-2"), response=None),
        "page.go_forward": PageNavigationResult(page=PageRef(page_id="page-3"), response=None),
    })
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    await page.go_back(wait_until="domcontentloaded", timeout=5_000)
    await page.go_forward(wait_until="domcontentloaded", timeout=5_000)

    assert recording.calls[0][1] == PageGoBackParams.model_validate({
        "page_id": "page-1",
        "options": {"wait_until": "domcontentloaded", "timeout": 5_000},
    })
    assert recording.calls[1][1] == PageGoForwardParams.model_validate({
        "page_id": "page-2",
        "options": {"wait_until": "domcontentloaded", "timeout": 5_000},
    })


@pytest.mark.asyncio
async def test_page_url_returns_a_scalar_string() -> None:
    recording = RecordingRPCClient({"page.url": "https://example.com/path"})
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    assert await page.url() == "https://example.com/path"
    assert recording.calls == [
        ("page.url", PageIdParams(page_id="page-1"), PageUrlResult),
    ]


@pytest.mark.asyncio
async def test_page_on_delivers_canonical_console_events_and_unsubscribes() -> None:
    recording = RecordingRPCClient({"page.on": {"ok": True}, "page.off": {"ok": True}})
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))
    events = []

    subscription = await page.on("console", events.append)
    _, on_params, _ = recording.calls[0]
    assert isinstance(on_params, PageOnParams)
    _, raw_listener = recording.notifications["page.cdp_event"]
    listener = cast(Callable[[PageCDPEventNotification], object], raw_listener)
    notification = PageCDPEventNotification.model_validate({
        "subscription_id": on_params.subscription_id,
        "event": {
            "page_id": "page-1",
            "method": "Runtime.consoleAPICalled",
            "params": {"type": "log", "executionContextId": 1},
            "session_id": "session-1",
            "target_id": "target-1",
        },
    })
    result = listener(notification)
    if inspect.isawaitable(result):
        await result

    assert [event.model_dump(mode="json") for event in events] == [
        {
            "page_id": "page-1",
            "method": "Runtime.consoleAPICalled",
            "params": {"type": "log", "executionContextId": 1},
            "session_id": "session-1",
            "target_id": "target-1",
        }
    ]

    await subscription.unsubscribe()
    assert recording.calls[1] == (
        "page.off",
        PageOffParams(subscription_id=on_params.subscription_id),
        PageVoidResult,
    )
    assert "page.cdp_event" not in recording.notifications


@pytest.mark.asyncio
async def test_page_on_cleans_up_local_state_when_remote_registration_fails() -> None:
    recording = RecordingRPCClient({
        "page.on": RuntimeError("registration failed"),
        "page.close": {"closed": True},
    })
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    with pytest.raises(RuntimeError, match="registration failed"):
        await page.on("console", lambda _: None)

    assert "page.cdp_event" not in recording.notifications
    await page.close()
    assert [method for method, _, _ in recording.calls] == ["page.on", "page.close"]


@pytest.mark.asyncio
async def test_page_on_delivers_events_in_order_across_page_owned_cdp_sessions() -> None:
    recording = RecordingRPCClient({"page.on": {"ok": True}, "page.off": {"ok": True}})
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))
    sessions: list[str] = []
    subscription = await page.on(
        "console",
        lambda event: sessions.append(event.session_id),
    )
    _, on_params, _ = recording.calls[0]
    assert isinstance(on_params, PageOnParams)
    _, raw_listener = recording.notifications["page.cdp_event"]
    listener = cast(Callable[[PageCDPEventNotification], object], raw_listener)

    for session_id, target_id in (
        ("main-session", "main-target"),
        ("oopif-session", "oopif-target"),
    ):
        result = listener(
            PageCDPEventNotification.model_validate({
                "subscription_id": on_params.subscription_id,
                "event": {
                    "page_id": "page-1",
                    "method": "Runtime.consoleAPICalled",
                    "params": {"type": "log", "executionContextId": 1},
                    "session_id": session_id,
                    "target_id": target_id,
                },
            })
        )
        if inspect.isawaitable(result):
            await result

    assert sessions == ["main-session", "oopif-session"]
    await subscription.unsubscribe()


@pytest.mark.asyncio
async def test_page_close_unsubscribes_event_listeners_before_closing() -> None:
    recording = RecordingRPCClient({
        "page.on": {"ok": True},
        "page.off": {"ok": True},
        "page.close": {"closed": True},
    })
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))
    await page.on("console", lambda _: None)

    await page.close()

    assert [method for method, _, _ in recording.calls] == [
        "page.on",
        "page.off",
        "page.close",
    ]
    assert "page.cdp_event" not in recording.notifications


@pytest.mark.asyncio
async def test_unsubscribe_continues_after_calling_task_is_cancelled() -> None:
    class BlockingPageOffRPCClient(RecordingRPCClient):
        def __init__(self) -> None:
            super().__init__({"page.on": {"ok": True}})
            self.page_off_started = asyncio.Event()
            self.release_page_off = asyncio.Event()

        @overload
        async def send(
            self,
            method: str,
            params: BaseModel,
            result_model: type[RootModel[RootResultT]],
        ) -> RootResultT: ...

        @overload
        async def send(
            self,
            method: str,
            params: BaseModel,
            result_model: type[ResultT],
        ) -> ResultT: ...

        async def send(
            self,
            method: str,
            params: BaseModel,
            result_model: type[BaseModel],
        ) -> object:
            if method != "page.off":
                return await super().send(method, params, result_model)
            self.calls.append((method, params, result_model))
            self.page_off_started.set()
            await self.release_page_off.wait()
            return PageVoidResult(ok=True)

    recording = BlockingPageOffRPCClient()
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))
    subscription = await page.on("console", lambda _: None)
    unsubscribe = asyncio.create_task(subscription.unsubscribe())
    await recording.page_off_started.wait()

    unsubscribe.cancel()
    with pytest.raises(asyncio.CancelledError):
        await unsubscribe

    recording.release_page_off.set()
    await subscription.unsubscribe()
    assert [method for method, _, _ in recording.calls] == ["page.on", "page.off"]


@pytest.mark.asyncio
async def test_unsubscribe_retries_after_page_off_failure() -> None:
    recording = RecordingRPCClient({
        "page.on": {"ok": True},
        "page.off": RuntimeError("temporary page.off failure"),
    })
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))
    subscription = await page.on("console", lambda _: None)

    with pytest.raises(RuntimeError, match="temporary page.off failure"):
        await subscription.unsubscribe()
    assert "page.cdp_event" in recording.notifications

    recording.responses["page.off"] = {"ok": True}
    await subscription.unsubscribe()

    assert [method for method, _, _ in recording.calls] == [
        "page.on",
        "page.off",
        "page.off",
    ]
    assert "page.cdp_event" not in recording.notifications


@pytest.mark.asyncio
async def test_unsubscribe_reports_background_failure_after_caller_cancellation() -> None:
    class FailingPageOffRPCClient(RecordingRPCClient):
        def __init__(self) -> None:
            super().__init__({"page.on": {"ok": True}})
            self.page_off_started = asyncio.Event()
            self.release_page_off = asyncio.Event()
            self.fail_page_off = True

        @overload
        async def send(
            self,
            method: str,
            params: BaseModel,
            result_model: type[RootModel[RootResultT]],
        ) -> RootResultT: ...

        @overload
        async def send(
            self,
            method: str,
            params: BaseModel,
            result_model: type[ResultT],
        ) -> ResultT: ...

        async def send(
            self,
            method: str,
            params: BaseModel,
            result_model: type[BaseModel],
        ) -> object:
            if method != "page.off":
                return await super().send(method, params, result_model)
            self.calls.append((method, params, result_model))
            self.page_off_started.set()
            await self.release_page_off.wait()
            if self.fail_page_off:
                self.fail_page_off = False
                raise RuntimeError("background page.off failure")
            return PageVoidResult(ok=True)

    recording = FailingPageOffRPCClient()
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))
    subscription = await page.on("console", lambda _: None)
    loop = asyncio.get_running_loop()
    original_handler = loop.get_exception_handler()
    reported: list[dict[str, object]] = []
    failure_reported = asyncio.Event()

    def exception_handler(_loop: asyncio.AbstractEventLoop, context: dict[str, object]) -> None:
        reported.append(context)
        failure_reported.set()

    loop.set_exception_handler(exception_handler)
    try:
        unsubscribe = asyncio.create_task(subscription.unsubscribe())
        await recording.page_off_started.wait()
        unsubscribe.cancel()
        with pytest.raises(asyncio.CancelledError):
            await unsubscribe

        recording.release_page_off.set()
        await asyncio.wait_for(failure_reported.wait(), timeout=1)
        assert reported[0]["message"] == (
            "Stagehand page event unsubscribe failed after caller cancellation"
        )
        assert isinstance(reported[0]["exception"], RuntimeError)

        await subscription.unsubscribe()
        assert [method for method, _, _ in recording.calls] == [
            "page.on",
            "page.off",
            "page.off",
        ]
    finally:
        loop.set_exception_handler(original_handler)


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


def test_optional_page_arguments_are_keyword_only() -> None:
    """Required arguments are positional; anything with a default must be keyword-only."""
    offenders: list[str] = []

    for name in dir(Page):
        if name.startswith("_"):
            continue
        attribute = inspect.getattr_static(Page, name)
        if not (inspect.isfunction(attribute) or inspect.iscoroutinefunction(attribute)):
            continue
        for parameter in inspect.signature(attribute).parameters.values():
            if (
                parameter.kind is inspect.Parameter.POSITIONAL_OR_KEYWORD
                and parameter.default is not inspect.Parameter.empty
            ):
                offenders.append(f"Page.{name}({parameter.name}=...)")

    assert offenders == []
