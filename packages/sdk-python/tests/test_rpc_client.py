import asyncio
from typing import ClassVar, cast

import pytest
from pydantic import ValidationError

from stagehand import cdp_client
from stagehand._generated import models
from stagehand.rpc_client import RPCClient, RPCError, connect_rpc_client

JSON = dict[str, object]


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
async def test_send_validates_and_serializes_params_and_results() -> None:
    transport = QueueTransport()
    client = RPCClient(transport)
    call = asyncio.create_task(
        client.send(
            "page.goto",
            models.PageGotoParams(page_id="page-1", url="https://example.com"),
            models.PageRef,
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
        "result": {"page_id": "page-2", "url": "https://example.com"},
    })

    try:
        assert await asyncio.wait_for(call, timeout=1) == models.PageRef(
            page_id="page-2",
            url="https://example.com",
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
    assert (await asyncio.wait_for(call, timeout=1)).root == [models.PageRef(page_id="page-1")]

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
            "result": {"count": "1"},
        })
        with pytest.raises(ValidationError):
            await call
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_on_request_uses_explicit_models_and_returns_validated_results() -> None:
    transport = QueueTransport()
    client = RPCClient(transport)

    async def handle_ping(params: models.EmptyParams) -> models.StagehandPingResult:
        assert params == models.EmptyParams()
        return models.StagehandPingResult(ok=True, runtime="service_worker")

    remove_first = client.on_request(
        "ping",
        models.EmptyParams,
        models.StagehandPingResult,
        handle_ping,
    )
    remove_current = client.on_request(
        "ping",
        models.EmptyParams,
        models.StagehandPingResult,
        handle_ping,
    )
    remove_first()
    await transport.incoming.put({
        "jsonrpc": "2.0",
        "id": 7,
        "method": "ping",
        "params": {},
    })
    assert await asyncio.wait_for(transport.outgoing.get(), timeout=1) == {
        "jsonrpc": "2.0",
        "id": 7,
        "result": {"ok": True, "runtime": "service_worker"},
    }

    remove_current()
    await transport.incoming.put({
        "jsonrpc": "2.0",
        "id": 8,
        "method": "ping",
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

    def fail(_params: models.EmptyParams) -> models.StagehandPingResult:
        raise LookupError("model callback failed")

    client.on_request("ping", models.EmptyParams, models.StagehandPingResult, fail)
    await transport.incoming.put({
        "jsonrpc": "2.0",
        "id": 9,
        "method": "ping",
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
        "method": "ping",
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
    call = asyncio.create_task(
        client.send("ping", models.EmptyParams(), models.StagehandPingResult)
    )
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
async def test_timeout_and_transport_close_reject_pending_requests() -> None:
    timeout_transport = QueueTransport()
    timeout_client = RPCClient(timeout_transport, request_timeout_ms=10)
    try:
        with pytest.raises(TimeoutError, match="RPC request timed out: ping"):
            await timeout_client.send("ping", models.EmptyParams(), models.StagehandPingResult)
    finally:
        await timeout_client.close()

    failing_transport = FailingReceiveTransport()
    failing_client = RPCClient(failing_transport)
    call = asyncio.create_task(
        failing_client.send("ping", models.EmptyParams(), models.StagehandPingResult)
    )
    await asyncio.wait_for(failing_transport.outgoing.get(), timeout=1)
    failing_transport.fail.set()
    with pytest.raises(RuntimeError, match="transport reader failed"):
        await call
    await asyncio.wait_for(failing_transport.closed.wait(), timeout=1)


@pytest.mark.asyncio
async def test_invalid_response_closes_client_and_rejects_pending_request() -> None:
    transport = QueueTransport()
    client = RPCClient(transport)
    call = asyncio.create_task(
        client.send("ping", models.EmptyParams(), models.StagehandPingResult)
    )
    request = await asyncio.wait_for(transport.outgoing.get(), timeout=1)
    await transport.incoming.put({
        "jsonrpc": "2.0",
        "id": request["id"],
        "result": {"ok": True, "runtime": "service_worker"},
        "unexpected": True,
    })

    with pytest.raises(RuntimeError, match="Invalid JSON-RPC response"):
        await call
    await asyncio.wait_for(transport.closed.wait(), timeout=1)


class FakeCDPClient(QueueTransport):
    connect_arguments: ClassVar[dict[str, object]] = {}
    instances: ClassVar[list["FakeCDPClient"]] = []
    web_socket_debugger_url = "ws://resolved.example/devtools/browser/1"

    @classmethod
    async def connect(cls, **kwargs: object) -> "FakeCDPClient":
        cls.connect_arguments = kwargs
        client = cls()
        cls.instances.append(client)
        return client

    async def send(self, message: JSON) -> None:
        await super().send(message)
        if message.get("method") == "runtime.configure":
            await self.incoming.put({
                "jsonrpc": "2.0",
                "id": message["id"],
                "result": {"configured": True},
            })


@pytest.mark.asyncio
async def test_connect_rpc_client_passes_cdp_options_and_configures_the_runtime(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(cdp_client, "CDPClient", FakeCDPClient)
    client = await connect_rpc_client(
        cdp_url="http://localhost:9222",
        extension_id="stagehand-extension",
        service_worker_url_includes="service-worker.js",
        discovery_timeout_ms=1_001,
        command_timeout_ms=1_002,
        cdp_connect_timeout_ms=1_003,
    )

    try:
        assert FakeCDPClient.connect_arguments == {
            "cdp_url": "http://localhost:9222",
            "extension_dir": None,
            "extension_id": "stagehand-extension",
            "service_worker_url_includes": "service-worker.js",
            "discovery_timeout_ms": 1_001,
            "command_timeout_ms": 1_002,
            "cdp_connect_timeout_ms": 1_003,
        }
        transport = FakeCDPClient.instances[-1]
        assert transport.sent[0] == {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "runtime.configure",
            "params": {
                "cdp_url": "ws://resolved.example/devtools/browser/1",
                "telemetry": {
                    "traces": {
                        "endpoint": "https://example.com/v1/traces",
                        "headers": {},
                    }
                },
            },
        }
    finally:
        await client.close()
