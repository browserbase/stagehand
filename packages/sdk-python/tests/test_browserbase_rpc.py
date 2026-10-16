from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import cast

import pytest

from stagehand._generated import models
from stagehand.browserbase_connection import BrowserbaseConnection
from stagehand.browserbase_rpc import register_browserbase_transport
from stagehand.rpc_client import RPCClient

from ._http_server import HTTPRequest, http_server


class _Transport:
    def __init__(self) -> None:
        self.incoming: asyncio.Queue[object] = asyncio.Queue()
        self.outgoing: asyncio.Queue[dict[str, object]] = asyncio.Queue()
        self.closed = asyncio.Event()

    async def send(self, message: dict[str, object]) -> None:
        self.outgoing.put_nowait(message)

    async def receive(self) -> object:
        message = await self.incoming.get()
        if isinstance(message, BaseException):
            raise message
        return message

    async def close(self) -> None:
        self.closed.set()

    async def response(self) -> dict[str, object]:
        return await asyncio.wait_for(self.outgoing.get(), 2)

    def request(
        self,
        request_id: int,
        *,
        operation: models.Operation = models.Operation.gateway_responses,
        body: str = "{}",
        budget: float | None = None,
    ) -> None:
        self.incoming.put_nowait({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "browserbase.request",
            "params": models.BrowserbaseRequestParams(
                operation=operation,
                headers={},
                body=body,
                remaining_timeout_ms=budget,
            ).model_dump(mode="json", exclude_none=True),
        })

    def cancel(self, request_id: int, reason: str = "cancelled") -> None:
        self.incoming.put_nowait({
            "jsonrpc": "2.0",
            "method": "browserbase.cancel",
            "params": {"request_id": request_id, "reason": reason},
        })


@dataclass
class _Upstream:
    connection: BrowserbaseConnection
    requests: asyncio.Queue[HTTPRequest]

    async def receive(self) -> HTTPRequest:
        return await asyncio.wait_for(self.requests.get(), 2)


@pytest.fixture
async def upstream() -> AsyncIterator[_Upstream]:
    requests: asyncio.Queue[HTTPRequest] = asyncio.Queue()

    async def serve(
        request: HTTPRequest, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        requests.put_nowait(request)
        if request.body == b"drop":
            return
        writer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n")
        await writer.drain()
        if request.body == b"hold":
            await reader.read()
        else:
            writer.write(b"{}")
            await writer.drain()

    async with http_server(serve) as url:
        yield _Upstream(BrowserbaseConnection("bb-key", f"{url}/v1", "session"), requests)


@asynccontextmanager
async def _connected(
    connection: BrowserbaseConnection | None,
) -> AsyncIterator[tuple[RPCClient, _Transport, Callable[[], Awaitable[None]]]]:
    transport = _Transport()
    client = RPCClient(transport)
    dispose = register_browserbase_transport(client, connection)
    try:
        yield client, transport, dispose
    finally:
        await client.close()
        await dispose()


def _result(
    response: dict[str, object],
) -> models.BrowserbaseHttpResponse | models.BrowserbaseTransportError:
    return models.BrowserbaseRequestResult.model_validate(response["result"]).root


async def test_reverse_http_completes_during_batch_with_same_id(
    upstream: _Upstream,
) -> None:
    async with _connected(upstream.connection) as (client, transport, _):
        batch = asyncio.create_task(
            client.send(
                "stagehand.callback_batch",
                models.CallbackBatchParams(
                    callback_source="async () => undefined",
                    options=models.CallbackBatchOptions(timeout=30_000),
                ),
                models.CallbackBatchResult,
            )
        )
        outer = await transport.response()
        request_id = cast(int, outer["id"])
        transport.request(request_id)
        response = await transport.response()
        result = _result(response)
        assert isinstance(result, models.BrowserbaseHttpResponse)
        assert result.status == 200
        assert result.body == "{}"
        request = await upstream.receive()
        assert request.headers["x-bb-api-key"] == "bb-key"
        assert request.path == "/v1/llm/responses"
        assert not batch.done()
        transport.incoming.put_nowait({"jsonrpc": "2.0", "id": request_id, "result": {}})
        await asyncio.wait_for(batch, 2)


@pytest.mark.parametrize("reason", ["cancelled", "timeout"])
async def test_cancel_affects_only_matching_http_request(upstream: _Upstream, reason: str) -> None:
    async with _connected(upstream.connection) as (_, transport, _):
        transport.request(10, body="hold")
        held = await upstream.receive()
        transport.request(11, operation=models.Operation.cache_get)
        assert (await transport.response())["id"] == 11
        transport.cancel(99)
        transport.cancel(10, reason)
        transport.cancel(10, "timeout" if reason == "cancelled" else "cancelled")
        response = await transport.response()
        assert response["id"] == 10
        result = _result(response)
        assert isinstance(result, models.BrowserbaseTransportError)
        assert result.reason.value == reason
        await asyncio.wait_for(held.disconnected.wait(), 2)
        transport.cancel(10)
        transport.request(12, operation=models.Operation.cache_set)
        assert isinstance(_result(await transport.response()), models.BrowserbaseHttpResponse)
        assert not transport.closed.is_set()


async def test_connections_keep_equal_ids_independent(upstream: _Upstream) -> None:
    other = BrowserbaseConnection("bb-other", upstream.connection.api_url, "other-session")
    async with (
        _connected(upstream.connection) as (_, first, _),
        _connected(other) as (_, second, _),
    ):
        first.request(1, body="hold")
        first_http = await upstream.receive()
        second.request(1, body="hold")
        second_http = await upstream.receive()
        assert first_http.headers["x-bb-api-key"] == "bb-key"
        assert second_http.headers["x-bb-api-key"] == "bb-other"
        assert second_http.headers["x-bb-session-id"] == "other-session"
        first.cancel(1)
        assert isinstance(_result(await first.response()), models.BrowserbaseTransportError)
        await asyncio.wait_for(first_http.disconnected.wait(), 2)
        assert not second_http.disconnected.is_set()
        assert second.outgoing.empty()
        second.cancel(1)
        await second.response()


async def test_deadline_covers_buffering_over_rpc(upstream: _Upstream) -> None:
    async with _connected(upstream.connection) as (_, transport, _):
        transport.request(1, body="hold", budget=200)
        request = await upstream.receive()
        result = _result(await transport.response())
        assert isinstance(result, models.BrowserbaseTransportError)
        assert result.reason is models.Reason.timeout
        await asyncio.wait_for(request.disconnected.wait(), 2)


@pytest.mark.parametrize("mode", ["close", "disconnect", "detach"])
async def test_connection_close_aborts_http_without_reply(upstream: _Upstream, mode: str) -> None:
    async with _connected(upstream.connection) as (client, transport, _):
        transport.request(1, body="hold")
        request = await upstream.receive()
        if mode == "disconnect":
            transport.incoming.put_nowait(ConnectionError("connection ended"))
            await asyncio.wait_for(transport.closed.wait(), 2)
        else:
            await client.close(close_transport=mode != "detach")
        await asyncio.wait_for(request.disconnected.wait(), 2)
        assert transport.outgoing.empty()
        assert transport.closed.is_set() == (mode != "detach")
        assert not client._inbound_tasks


async def test_dispose_cancels_http_without_closing_rpc(upstream: _Upstream) -> None:
    async with _connected(upstream.connection) as (client, transport, dispose):
        transport.request(1, body="hold")
        request = await upstream.receive()
        await dispose()
        result = _result(await transport.response())
        assert isinstance(result, models.BrowserbaseTransportError)
        assert result.reason is models.Reason.cancelled
        await asyncio.wait_for(request.disconnected.wait(), 2)
        await dispose()
        transport.request(2)
        response = await transport.response()
        assert cast(dict[str, object], response["error"])["code"] == -32601
        client.on_request(
            "test.echo", models.EmptyParams, models.EmptyParams, lambda params: params
        )
        transport.incoming.put_nowait({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "test.echo",
            "params": {},
        })
        assert (await transport.response())["result"] == {}
        assert not transport.closed.is_set()


@pytest.mark.parametrize("body", ["{}", "drop"])
async def test_completed_requests_release_ids(upstream: _Upstream, body: str) -> None:
    async with _connected(upstream.connection) as (_, transport, _):
        transport.request(1, body=body)
        first = _result(await transport.response())
        if body == "drop":
            assert isinstance(first, models.BrowserbaseTransportError)
            assert first.reason is models.Reason.network
        else:
            assert isinstance(first, models.BrowserbaseHttpResponse)
        transport.cancel(1)
        transport.request(1)
        assert isinstance(_result(await transport.response()), models.BrowserbaseHttpResponse)


async def test_duplicate_active_id_does_not_replace_original(upstream: _Upstream) -> None:
    async with _connected(upstream.connection) as (_, transport, _):
        transport.request(1, body="hold")
        original = await upstream.receive()
        transport.request(1)
        response = await transport.response()
        assert (
            cast(dict[str, object], response["error"])["message"]
            == "Browserbase request ID is already in use"
        )
        transport.cancel(1)
        assert isinstance(_result(await transport.response()), models.BrowserbaseTransportError)
        await asyncio.wait_for(original.disconnected.wait(), 2)


async def test_invalid_params_and_unavailable_connection() -> None:
    async with _connected(None) as (_, transport, _):
        transport.incoming.put_nowait({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "browserbase.request",
            "params": {"operation": "arbitrary", "headers": {}, "body": "{}"},
        })
        response = await transport.response()
        assert cast(dict[str, object], response["error"])["code"] == -32602
        transport.request(2)
        result = _result(await transport.response())
        assert isinstance(result, models.BrowserbaseTransportError)
        assert result.reason is models.Reason.unavailable


async def test_browserbase_cancel_leaves_custom_llm_callback_unchanged(upstream: _Upstream) -> None:
    async with _connected(upstream.connection) as (client, transport, dispose):
        started = asyncio.Event()
        finish = asyncio.Event()

        async def generate(params: models.LLMGenerateParams) -> models.LLMGenerateResult:
            assert len(params.root.messages) == 1
            started.set()
            await finish.wait()
            return models.LLMGenerateResult.model_validate({
                "role": "assistant",
                "content": {"type": "text", "text": "done"},
                "output_format": "text",
            })

        client.on_request(
            "llm.generate", models.LLMGenerateParams, models.LLMGenerateResult, generate
        )
        transport.incoming.put_nowait({
            "jsonrpc": "2.0",
            "id": 7,
            "method": "llm.generate",
            "params": {
                "messages": [{"role": "user", "content": {"type": "text", "text": "hello"}}]
            },
        })
        await asyncio.wait_for(started.wait(), 2)
        transport.cancel(7)
        transport.request(8)
        assert (await transport.response())["id"] == 8
        assert not finish.is_set()
        await dispose()
        finish.set()
        response = await transport.response()
        assert response["id"] == 7
        assert cast(dict[str, object], response["result"])["content"] == {
            "type": "text",
            "text": "done",
        }
