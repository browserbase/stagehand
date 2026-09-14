import asyncio
import json
from pathlib import Path
from typing import cast

import pytest
from opentelemetry import context as otel_context
from opentelemetry.trace import (
    NonRecordingSpan,
    SpanContext,
    TraceFlags,
    TraceState,
    set_span_in_context,
)
from pydantic import BaseModel, ConfigDict, ValidationError

from stagehand import rpc_client
from stagehand._generated import models
from stagehand.file_upload import FilePayload, normalize_file_input
from stagehand.rpc_client import RPCClient, RPCError

JSON = dict[str, object]
CALLBACK_BATCH_WIRE_FIXTURES = json.loads(
    (
        Path(__file__).resolve().parents[2]
        / "protocol"
        / "tests"
        / "fixtures"
        / "callback-batch-wire.json"
    ).read_text()
)


class RPCResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: bool


class QueueTransport:
    def __init__(self) -> None:
        self.sent: list[JSON] = []
        self.incoming: asyncio.Queue[object] = asyncio.Queue()
        self.outgoing: asyncio.Queue[JSON] = asyncio.Queue()
        self.closed = asyncio.Event()

    async def send(self, message: JSON) -> None:
        self.sent.append(message)
        await self.outgoing.put(message)

    async def receive(self) -> object:
        return await self.incoming.get()

    async def close(self) -> None:
        self.closed.set()


class FailingReceiveTransport(QueueTransport):
    def __init__(self) -> None:
        super().__init__()
        self.fail = asyncio.Event()

    async def receive(self) -> object:
        await self.fail.wait()
        raise RuntimeError("transport reader failed")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("page_id", "fixture_name"),
    [
        (None, "pageOmitted"),
        ("page-1", "pageProvided"),
    ],
)
async def test_callback_batch_uses_the_normal_pending_request_path(
    page_id: str | None,
    fixture_name: str,
) -> None:
    transport = QueueTransport()
    client = RPCClient(transport)
    try:
        source = "async () => undefined"
        call = asyncio.create_task(
            client.send(
                "stagehand.callback_batch",
                models.CallbackBatchParams(
                    callback_source=source,
                    options=models.CallbackBatchOptions(
                        **({"page_id": page_id} if page_id is not None else {}),
                        timeout=30_000,
                    ),
                ),
                models.CallbackBatchResult,
            )
        )
        request = await asyncio.wait_for(transport.outgoing.get(), timeout=1)
        assert request == CALLBACK_BATCH_WIRE_FIXTURES[fixture_name]
        await transport.incoming.put({
            "jsonrpc": "2.0",
            "id": request["id"],
            "result": {},
        })
        result = await call
        assert isinstance(result, models.CallbackBatchResult)
        assert result.value is None
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_callback_batch_preserves_json_numbers_on_the_wire() -> None:
    transport = QueueTransport()
    client = RPCClient(transport)
    value = {
        "count": 7,
        "ratio": 7.5,
        "large": 9_007_199_254_740_993,
        "nested": [1, 1.5],
    }
    try:
        call = asyncio.create_task(
            client.send(
                "stagehand.callback_batch",
                models.CallbackBatchParams(
                    callback_source="async (_batch, input) => input",
                    input=models.FieldSchema2.model_validate(value),
                    options=models.CallbackBatchOptions(timeout=30_000),
                ),
                models.CallbackBatchResult,
            )
        )
        request = await asyncio.wait_for(transport.outgoing.get(), timeout=1)
        params = cast(dict[str, object], request["params"])
        assert params["input"] == value
        encoded_input = cast(dict[str, object], params["input"])
        assert type(encoded_input["count"]) is int
        assert type(encoded_input["ratio"]) is float
        await transport.incoming.put({
            "jsonrpc": "2.0",
            "id": request["id"],
            "result": {"value": value},
        })

        result = await call
        assert result.value is not None
        decoded = result.value.model_dump(mode="json")
        assert decoded == value
        assert type(decoded["count"]) is int
        assert type(decoded["ratio"]) is float
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_send_validates_and_serializes_params_and_results() -> None:
    transport = QueueTransport()
    client = RPCClient(transport)
    call = asyncio.create_task(
        client.send(
            "page.goto",
            models.PageGotoParams(page_id="page-1", url="https://example.com"),
            models.PageNavigationResult,
        )
    )
    request = await asyncio.wait_for(transport.outgoing.get(), timeout=1)

    assert request == {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "page.goto",
        "params": {"page_id": "page-1", "url": "https://example.com"},
    }
    await transport.incoming.put({
        "jsonrpc": "2.0",
        "id": request["id"],
        "result": {
            "page": {"page_id": "page-2", "url": "https://example.com"},
            "response": None,
        },
    })

    try:
        assert await asyncio.wait_for(call, timeout=1) == models.PageNavigationResult(
            page=models.PageRef(page_id="page-2", url="https://example.com"),
            response=None,
        )
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_send_propagates_current_w3c_trace_context() -> None:
    transport = QueueTransport()
    client = RPCClient(transport)
    parent = NonRecordingSpan(
        SpanContext(
            trace_id=int("4bf92f3577b34da6a3ce929d0e0e4736", 16),
            span_id=int("00f067aa0ba902b7", 16),
            is_remote=False,
            trace_flags=TraceFlags(TraceFlags.SAMPLED),
            trace_state=TraceState.from_header(["vendor=value"]),
        )
    )
    token = otel_context.attach(set_span_in_context(parent))
    try:
        call = asyncio.create_task(
            client.send("context.pages", models.EmptyParams(), models.ContextPagesResult)
        )
        request = await asyncio.wait_for(transport.outgoing.get(), timeout=1)
        assert request["traceparent"] == ("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
        assert request["tracestate"] == "vendor=value"
        await transport.incoming.put({
            "jsonrpc": "2.0",
            "id": request["id"],
            "result": [],
        })
        assert await asyncio.wait_for(call, timeout=1) == []
    finally:
        otel_context.detach(token)
        await client.close()


@pytest.mark.asyncio
async def test_send_omits_unset_nested_file_metadata() -> None:
    transport = QueueTransport()
    client = RPCClient(transport)
    call = asyncio.create_task(
        client.send(
            "locator.set_input_files",
            models.LocatorSetInputFilesParams(
                page_id="page-1",
                selector="#upload",
                files=normalize_file_input(FilePayload(name="hello.txt", buffer=b"hello")),
            ),
            models.LocatorSetInputFilesResult,
        )
    )
    request = await asyncio.wait_for(transport.outgoing.get(), timeout=1)

    assert request["params"] == {
        "page_id": "page-1",
        "selector": "#upload",
        "files": [{"name": "hello.txt", "data": "aGVsbG8="}],
    }
    await transport.incoming.put({
        "jsonrpc": "2.0",
        "id": request["id"],
        "result": {"set": True},
    })

    try:
        assert await asyncio.wait_for(call, timeout=1) == models.LocatorSetInputFilesResult(
            set=True
        )
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_send_strictly_validates_root_model_results() -> None:
    transport = QueueTransport()
    client = RPCClient(transport)
    call = asyncio.create_task(
        client.send("context.pages", models.EmptyParams(), models.ContextPagesResult)
    )
    request = await asyncio.wait_for(transport.outgoing.get(), timeout=1)
    await transport.incoming.put({
        "jsonrpc": "2.0",
        "id": request["id"],
        "result": [{"page_id": "page-1"}],
    })
    assert await asyncio.wait_for(call, timeout=1) == [models.PageRef(page_id="page-1")]

    invalid_call = asyncio.create_task(
        client.send("context.pages", models.EmptyParams(), models.ContextPagesResult)
    )
    invalid_request = await asyncio.wait_for(transport.outgoing.get(), timeout=1)
    await transport.incoming.put({
        "jsonrpc": "2.0",
        "id": invalid_request["id"],
        "result": [{"page_id": "page-1", "unexpected": True}],
    })
    try:
        with pytest.raises(ValidationError):
            await invalid_call
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_send_revalidates_mutated_params_and_strictly_validates_results() -> None:
    transport = QueueTransport()
    client = RPCClient(transport)
    params = models.PageSetExtraHTTPHeadersParams(
        page_id="page-1",
        headers={"x-stagehand": "valid"},
    )
    params.headers["x-stagehand"] = 1  # ty: ignore[invalid-assignment]

    try:
        with pytest.raises(ValidationError):
            await client.send("page.set_extra_http_headers", params, models.PageVoidResult)
        assert transport.sent == []

        call = asyncio.create_task(
            client.send(
                "locator.count",
                models.LocatorDescriptor(page_id="page-1", selector="button"),
                models.LocatorCountResult,
            )
        )
        request = await asyncio.wait_for(transport.outgoing.get(), timeout=1)
        await transport.incoming.put({
            "jsonrpc": "2.0",
            "id": request["id"],
            "result": "1",
        })
        with pytest.raises(ValidationError):
            await call
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_on_request_uses_explicit_models_and_returns_validated_results() -> None:
    transport = QueueTransport()
    client = RPCClient(transport)

    async def handle_request(params: models.EmptyParams) -> RPCResult:
        assert params == models.EmptyParams()
        return RPCResult(ok=True)

    remove_first = client.on_request(
        "test.request",
        models.EmptyParams,
        RPCResult,
        handle_request,
    )
    remove_current = client.on_request(
        "test.request",
        models.EmptyParams,
        RPCResult,
        handle_request,
    )
    remove_first()
    await transport.incoming.put({
        "jsonrpc": "2.0",
        "id": 7,
        "method": "test.request",
        "params": {},
    })
    assert await asyncio.wait_for(transport.outgoing.get(), timeout=1) == {
        "jsonrpc": "2.0",
        "id": 7,
        "result": {"ok": True},
    }

    remove_current()
    await transport.incoming.put({
        "jsonrpc": "2.0",
        "id": 8,
        "method": "test.request",
        "params": {},
    })
    try:
        assert await asyncio.wait_for(transport.outgoing.get(), timeout=1) == {
            "jsonrpc": "2.0",
            "id": 8,
            "error": {"code": -32601, "message": "Method not found"},
        }
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_on_request_validates_root_model_params_and_results() -> None:
    transport = QueueTransport()
    client = RPCClient(transport)

    def generate(params: models.LLMGenerateParams) -> models.LLMGenerateResult:
        assert isinstance(params.root, models.LLMStructuredGenerateParams)
        return models.LLMGenerateResult(
            root=models.LLMStructuredGenerateResult.model_validate({
                "role": models.LLMRole.assistant,
                "content": models.LLMTextContent(type="text", text='{"answer":true}'),
                "output_format": "json_schema",
                "structured_content": {"answer": True},
            })
        )

    client.on_request(
        "llm.generate",
        models.LLMGenerateParams,
        models.LLMGenerateResult,
        generate,
    )
    await transport.incoming.put({
        "jsonrpc": "2.0",
        "id": 9,
        "method": "llm.generate",
        "params": {
            "messages": [{"role": "user", "content": {"type": "text", "text": "Answer"}}],
            "response_format": {
                "type": "json_schema",
                "name": "answer",
                "schema": {"type": "object"},
            },
        },
    })
    assert await asyncio.wait_for(transport.outgoing.get(), timeout=1) == {
        "jsonrpc": "2.0",
        "id": 9,
        "result": {
            "role": "assistant",
            "content": {"type": "text", "text": '{"answer":true}'},
            "output_format": "json_schema",
            "structured_content": {"answer": True},
        },
    }

    def invalid_result(_params: models.LLMGenerateParams) -> models.LLMGenerateResult:
        return cast(models.LLMGenerateResult, {"unexpected": True})

    client.on_request(
        "llm.generate",
        models.LLMGenerateParams,
        models.LLMGenerateResult,
        invalid_result,
    )
    await transport.incoming.put({
        "jsonrpc": "2.0",
        "id": 10,
        "method": "llm.generate",
        "params": {
            "messages": [{"role": "user", "content": {"type": "text", "text": "Answer"}}],
            "response_format": {
                "type": "json_schema",
                "name": "answer",
                "schema": {"type": "object"},
            },
        },
    })
    try:
        assert await asyncio.wait_for(transport.outgoing.get(), timeout=1) == {
            "jsonrpc": "2.0",
            "id": 10,
            "error": {"code": -32603, "message": "Internal error"},
        }
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_on_request_rejects_invalid_params_and_reports_handler_errors() -> None:
    transport = QueueTransport()
    client = RPCClient(transport)

    def fail(_params: models.EmptyParams) -> RPCResult:
        raise LookupError("model callback failed")

    client.on_request("test.request", models.EmptyParams, RPCResult, fail)
    await transport.incoming.put({
        "jsonrpc": "2.0",
        "id": 9,
        "method": "test.request",
        "params": {"unexpected": True},
    })
    assert await asyncio.wait_for(transport.outgoing.get(), timeout=1) == {
        "jsonrpc": "2.0",
        "id": 9,
        "error": {"code": -32602, "message": "Invalid params"},
    }

    await transport.incoming.put({
        "jsonrpc": "2.0",
        "id": 10,
        "method": "test.request",
        "params": {},
    })
    try:
        assert await asyncio.wait_for(transport.outgoing.get(), timeout=1) == {
            "jsonrpc": "2.0",
            "id": 10,
            "error": {
                "code": -32603,
                "message": "model callback failed",
                "data": {"name": "LookupError"},
            },
        }
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_on_notification_validates_and_flushes_buffered_messages() -> None:
    transport = QueueTransport()
    client = RPCClient(transport)
    received: list[str] = []
    handled = asyncio.Event()

    await transport.incoming.put({
        "jsonrpc": "2.0",
        "method": "stagehand.log",
        "params": {"level": "info", "message": "Browser started", "data": {}},
    })
    await asyncio.sleep(0)

    async def listener(params: models.StagehandLog) -> None:
        received.append(params.message)
        handled.set()

    remove = client.on_notification("stagehand.log", models.StagehandLog, listener)
    await asyncio.wait_for(handled.wait(), timeout=1)
    assert received == ["Browser started"]

    remove()
    await transport.incoming.put({
        "jsonrpc": "2.0",
        "method": "stagehand.log",
        "params": {"level": "info", "message": "Not delivered", "data": {}},
    })
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    try:
        assert received == ["Browser started"]
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_receive_sends_standard_parse_and_invalid_request_errors() -> None:
    transport = QueueTransport()
    client = RPCClient(transport)
    await transport.incoming.put("{")
    assert await asyncio.wait_for(transport.outgoing.get(), timeout=1) == {
        "jsonrpc": "2.0",
        "id": None,
        "error": {"code": -32700, "message": "Parse error"},
    }

    await transport.incoming.put({"jsonrpc": "2.0", "id": 4, "method": 1, "params": {}})
    try:
        assert await asyncio.wait_for(transport.outgoing.get(), timeout=1) == {
            "jsonrpc": "2.0",
            "id": 4,
            "error": {"code": -32600, "message": "Invalid request"},
        }
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_error_responses_preserve_the_json_rpc_code_and_data() -> None:
    transport = QueueTransport()
    client = RPCClient(transport)
    call = asyncio.create_task(client.send("test.request", models.EmptyParams(), RPCResult))
    request = await asyncio.wait_for(transport.outgoing.get(), timeout=1)
    await transport.incoming.put({
        "jsonrpc": "2.0",
        "id": request["id"],
        "error": {
            "code": -32603,
            "message": "Runtime failed",
            "data": {"name": "RuntimeError"},
        },
    })

    try:
        with pytest.raises(RPCError, match="Runtime failed") as raised:
            await call
        assert raised.value.code == -32603
        assert raised.value.data == {"name": "RuntimeError"}
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_response_timeout_and_transport_close_reject_pending_requests(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(rpc_client, "_RPC_RESPONSE_GRACE_MS", 50)
    timeout_transport = QueueTransport()
    timeout_client = RPCClient(timeout_transport)
    try:
        with pytest.raises(TimeoutError, match=r"RPC response timed out: test\.request"):
            await timeout_client.send("test.request", models.EmptyParams(), RPCResult)
    finally:
        await timeout_client.close()

    failing_transport = FailingReceiveTransport()
    failing_client = RPCClient(failing_transport)
    call = asyncio.create_task(failing_client.send("test.request", models.EmptyParams(), RPCResult))
    await asyncio.wait_for(failing_transport.outgoing.get(), timeout=1)
    failing_transport.fail.set()
    with pytest.raises(RuntimeError, match="transport reader failed"):
        await call
    await asyncio.wait_for(failing_transport.closed.wait(), timeout=1)


def test_response_deadline_uses_operation_parameters_and_skips_stagehand_init() -> None:
    act_params = models.StagehandActParams.model_validate({
        "page_id": "page-1",
        "instruction": "Click",
        "options": {"timeout": 30_000},
    })
    observe_params = models.StagehandObserveParams.model_validate({
        "page_id": "page-1",
        "options": {"timeout": 20_000},
    })
    extract_params = models.StagehandExtractParams.model_validate({
        "page_id": "page-1",
        "instruction": "Extract",
        "schema": {"type": "object"},
        "options": {"timeout": 15_000},
    })

    assert rpc_client._rpc_response_timeout_seconds("stagehand.act", act_params) == 40
    assert rpc_client._rpc_response_timeout_seconds("stagehand.observe", observe_params) == 30
    assert rpc_client._rpc_response_timeout_seconds("stagehand.extract", extract_params) == 25
    assert rpc_client._rpc_response_timeout_seconds("stagehand.init", models.EmptyParams()) is None


def test_response_deadline_uses_v3_operation_defaults() -> None:
    params = models.EmptyParams()
    expected = {
        "page.goto": 25,
        "page.reload": 25,
        "page.go_back": 25,
        "page.go_forward": 25,
        "page.wait_for_load_state": 25,
        "page.wait_for_selector": 40,
        "page.webmcp_tools": 11,
    }

    for method, timeout in expected.items():
        assert rpc_client._rpc_response_timeout_seconds(method, params) == timeout


def test_response_deadline_preserves_v3_unbounded_operations() -> None:
    params = models.EmptyParams()
    methods = {
        "stagehand.init",
        "stagehand.close",
        "stagehand.act",
        "stagehand.extract",
        "stagehand.observe",
        "context.new_page",
        "context.add_init_script",
        "context.set_extra_http_headers",
        "context.get_domain_policy",
        "context.set_domain_policy",
        "context.cookies",
        "context.add_cookies",
        "context.clear_cookies",
        "context.clipboard_read_text",
        "context.clipboard_write_text",
        "context.clipboard_clear",
        "context.clipboard_paste",
        "context.clipboard_copy",
        "context.clipboard_cut",
        "page.close",
        "page.evaluate",
        "page.screenshot",
        "page.snapshot",
        "page.webmcp_invocation_result",
        "locator.click",
        "locator.fill",
        "locator.hover",
        "locator.count",
        "locator.is_checked",
        "locator.input_value",
        "locator.is_visible",
        "locator.inner_text",
        "locator.inner_html",
        "locator.text_content",
        "locator.scroll_to",
        "locator.centroid",
        "locator.highlight",
        "locator.send_click_event",
        "locator.type",
        "locator.select_option",
        "locator.set_input_files",
    }

    for method in methods:
        assert rpc_client._rpc_response_timeout_seconds(method, params) is None


@pytest.mark.asyncio
async def test_invalid_response_closes_client_and_rejects_pending_request() -> None:
    transport = QueueTransport()
    client = RPCClient(transport)
    call = asyncio.create_task(client.send("test.request", models.EmptyParams(), RPCResult))
    request = await asyncio.wait_for(transport.outgoing.get(), timeout=1)
    await transport.incoming.put({
        "jsonrpc": "2.0",
        "id": request["id"],
        "result": {"ok": True},
        "unexpected": True,
    })

    with pytest.raises(RuntimeError, match="Invalid JSON-RPC response"):
        await call
    await asyncio.wait_for(transport.closed.wait(), timeout=1)


@pytest.mark.asyncio
async def test_close_can_detach_without_closing_transport() -> None:
    transport = QueueTransport()
    client = RPCClient(transport)
    call = asyncio.create_task(client.send("test.request", models.EmptyParams(), RPCResult))
    await asyncio.wait_for(transport.outgoing.get(), timeout=1)

    async def handle(_params: models.EmptyParams) -> RPCResult:
        return RPCResult(ok=True)

    async def notify(_params: models.EmptyParams) -> None:
        return None

    client.on_request("test.handler", models.EmptyParams, RPCResult, handle)
    client.on_notification("test.notification", models.EmptyParams, notify)
    await transport.incoming.put({
        "jsonrpc": "2.0",
        "method": "test.buffered",
        "params": {},
    })

    async def wait_for_buffered_notification() -> None:
        while not client._pending_notifications:
            await asyncio.sleep(0)

    await asyncio.wait_for(wait_for_buffered_notification(), timeout=1)
    assert client._pending_notifications

    reason = RuntimeError("detached")
    await client.close(reason, close_transport=False)

    assert transport.closed.is_set() is False
    with pytest.raises(RuntimeError, match="detached"):
        await call
    assert client._pending == {}
    assert client._request_handlers == {}
    assert client._notification_listeners == {}
    assert client._pending_notifications == []
    with pytest.raises(RuntimeError, match="RPC client is closed"):
        await client.send("test.request", models.EmptyParams(), RPCResult)

    with pytest.raises(RuntimeError, match="RPC client is closed"):
        await client.send(
            "stagehand.callback_batch",
            models.CallbackBatchParams(
                callback_source="async ({ page }) => page.title()",
                input=models.FieldSchema2.model_validate(None),
                options=models.CallbackBatchOptions(timeout=30_000),
            ),
            models.CallbackBatchResult,
        )
