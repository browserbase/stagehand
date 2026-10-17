from __future__ import annotations

import asyncio
import gzip
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, cast

import httpx
import pytest
from pydantic import ValidationError
from typing_extensions import override

from stagehand._generated.models import (
    BrowserbaseHttpResponse,
    BrowserbaseRequestParams,
    BrowserbaseTransportError,
    Operation,
    Reason,
)
from stagehand.browserbase_connection import BrowserbaseConnection
from stagehand.browserbase_transport import execute_browserbase_request

from ._http_server import HTTPRequest, http_server

_FIXTURES = json.loads(
    (Path(__file__).parents[3] / "tests/fixtures/browserbase-transport.json").read_text()
)


def _params(
    operation: Operation = Operation.gateway_responses,
    *,
    headers: dict[str, str] | None = None,
    body: str = '{ "input": "héllo" }',
    budget: float | None = None,
) -> BrowserbaseRequestParams:
    return BrowserbaseRequestParams(
        operation=operation, headers=headers or {}, body=body, remaining_timeout_ms=budget
    )


@dataclass
class _Upstream:
    url: str = ""
    status: int = 200
    headers: dict[str, str] = field(default_factory=dict)
    body: bytes = b'{"ok":true}'
    pause: Literal["headers", "body"] | None = None
    drop: bool = False
    requests: list[HTTPRequest] = field(default_factory=list)
    received: asyncio.Event = field(default_factory=asyncio.Event)
    release: asyncio.Event = field(default_factory=asyncio.Event)

    @property
    def connection(self) -> BrowserbaseConnection:
        return BrowserbaseConnection(
            _FIXTURES["connection"]["apiKey"],
            f"{self.url}/services/v1",
            _FIXTURES["connection"]["sessionId"],
        )

    async def handle(
        self, request: HTTPRequest, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        self.requests.append(request)
        if self.drop:
            return
        if self.pause == "headers":
            self.received.set()
            await self.release.wait()
        response_headers = {
            "content-length": str(len(self.body)),
            "connection": "close",
            **self.headers,
        }
        head = f"HTTP/1.1 {self.status} Fixture response\r\n"
        head += "".join(f"{name}: {value}\r\n" for name, value in response_headers.items())
        writer.write(head.encode("latin-1") + b"\r\n")
        await writer.drain()
        self.received.set()
        if self.pause == "body":
            await self.release.wait()
        writer.write(self.body)
        await writer.drain()


@pytest.fixture
async def upstream() -> AsyncIterator[_Upstream]:
    upstream = _Upstream()
    async with http_server(upstream.handle) as upstream.url:
        yield upstream


@pytest.fixture
def http_clients(monkeypatch: pytest.MonkeyPatch) -> list[httpx.AsyncClient]:
    clients: list[httpx.AsyncClient] = []

    class RecordingClient(httpx.AsyncClient):
        @override
        async def send(self, request: httpx.Request, **kwargs: object) -> httpx.Response:
            clients.append(self)
            assert self.timeout == httpx.Timeout(None)
            return await super().send(request)

    monkeypatch.setattr(httpx, "AsyncClient", RecordingClient)
    return clients


@pytest.mark.parametrize("operation", list(Operation))
async def test_fixed_routes_and_utf8_body(upstream: _Upstream, operation: Operation) -> None:
    upstream.body = "  opaque héllo 🌎\n".encode()
    params = _params(operation, body="  opaque request héllo 🌎\n")
    result = (await execute_browserbase_request(upstream.connection, params)).root
    assert isinstance(result, BrowserbaseHttpResponse)
    assert result.status == 200
    assert result.status_text == "Fixture response"
    assert result.body == upstream.body.decode()
    assert "content-length" not in result.headers
    (request,) = upstream.requests
    assert request.method == "POST"
    assert (
        request.path
        == "/services/v1/"
        + {
            Operation.gateway_responses: "llm/responses",
            Operation.cache_get: "cache/get",
            Operation.cache_set: "cache/set",
        }[operation]
    )
    assert request.body == params.body.encode()
    assert request.headers["content-type"] == "application/json"
    assert request.headers["x-bb-api-key"] == upstream.connection.api_key
    if operation is not Operation.gateway_responses:
        assert "authorization" not in request.headers
        assert "x-bb-session-id" not in request.headers


@pytest.mark.parametrize("fixture", _FIXTURES["gateway"]["headers"], ids=lambda f: f["name"])
async def test_shared_gateway_headers(upstream: _Upstream, fixture: dict[str, object]) -> None:
    params = BrowserbaseRequestParams.model_validate({
        "operation": "gateway.responses",
        "headers": fixture["configured"],
        "body": "{}",
    })
    await execute_browserbase_request(upstream.connection, params)
    expected = fixture["expected"]
    assert isinstance(expected, dict)
    assert {key: upstream.requests[0].headers[key] for key in expected} == expected
    assert params.headers == fixture["configured"]


@pytest.mark.parametrize("fixture", _FIXTURES["requestHeaders"], ids=lambda f: f["name"])
@pytest.mark.parametrize("operation", list(Operation))
async def test_shared_request_header_rules(
    upstream: _Upstream, fixture: dict[str, object], operation: Operation
) -> None:
    params = BrowserbaseRequestParams.model_validate({
        "operation": operation,
        "headers": fixture["configured"],
        "body": "héllo",
    })
    result = (await execute_browserbase_request(upstream.connection, params)).root
    assert isinstance(result, BrowserbaseHttpResponse)
    (request,) = upstream.requests
    expected = cast(dict[str, str], fixture["expected"])
    assert request.headers.items() >= expected.items()
    assert request.headers["host"] == upstream.url.removeprefix("http://")
    assert request.headers["content-length"] == str(len(params.body.encode()))
    assert request.body == params.body.encode()
    assert not set(cast(list[str], fixture["absent"])) & request.headers.keys()
    assert not any(
        name in request.headers.get("connection", "").lower()
        for name in ("x-remove", "x-other", "authorization")
    )
    assert request.headers["x-bb-api-key"] == upstream.connection.api_key
    assert request.headers.get("x-bb-session-id") == (
        upstream.connection.session_id if operation is Operation.gateway_responses else None
    )
    if "authorization" not in expected:
        assert request.headers.get("authorization") == (
            f"Bearer {upstream.connection.api_key}"
            if operation is Operation.gateway_responses
            else None
        )
    assert params.headers == fixture["configured"]


@pytest.mark.parametrize("operation", list(Operation))
async def test_custom_headers_and_reserved_precedence(
    upstream: _Upstream, operation: Operation
) -> None:
    await execute_browserbase_request(
        upstream.connection,
        _params(
            operation,
            headers={
                "X-BB-API-KEY": "first",
                "x-bb-api-key": "second",
                "Authorization": "custom",
                "Content-Type": "application/custom+json",
                "x-note": "café",
            },
        ),
    )
    headers = upstream.requests[0].headers
    assert headers["x-bb-api-key"] == upstream.connection.api_key
    assert headers["authorization"] == "custom"
    assert headers["content-type"] == "application/custom+json"
    assert headers["x-note"] == "café"


@pytest.mark.parametrize("fixture", _FIXTURES["httpFailures"], ids=lambda f: f["name"])
async def test_http_failures_are_returned_without_retries(
    upstream: _Upstream, fixture: dict[str, object]
) -> None:
    expected = BrowserbaseHttpResponse.model_validate({
        "type": "response",
        "status": fixture["status"],
        "status_text": "Fixture response",
        "headers": fixture["headers"],
        "body": fixture["body"],
    })
    upstream.status = expected.status
    upstream.headers = expected.headers
    upstream.body = expected.body.encode()
    result = (await execute_browserbase_request(upstream.connection, _params())).root
    assert isinstance(result, BrowserbaseHttpResponse)
    assert result.status == expected.status
    assert result.body == expected.body
    assert result.headers.items() >= expected.headers.items()
    assert len(upstream.requests) == 1


async def test_large_gzip_body_decodes_as_fetch_text(upstream: _Upstream) -> None:
    body = "héllo 🌎" * 100_000
    upstream.body = gzip.compress(b"\xef\xbb\xbf" + body.encode() + b"\xff")
    upstream.headers = {"content-encoding": "gzip", "content-type": "text/plain; charset=latin-1"}
    result = (await execute_browserbase_request(upstream.connection, _params(body=body))).root
    assert isinstance(result, BrowserbaseHttpResponse)
    assert result.body == body + "\ufffd"
    assert "content-encoding" not in result.headers
    assert "content-length" not in result.headers
    assert upstream.requests[0].body == body.encode()


@pytest.mark.parametrize("status", [200, 204])
async def test_empty_body(upstream: _Upstream, status: int) -> None:
    upstream.status = status
    upstream.body = b""
    result = (await execute_browserbase_request(upstream.connection, _params())).root
    assert isinstance(result, BrowserbaseHttpResponse)
    assert result.body == ""


@pytest.mark.parametrize("cross_origin", [False, True])
async def test_redirects_are_returned(upstream: _Upstream, cross_origin: bool) -> None:
    upstream.status = 307
    upstream.headers = {"location": "http://127.0.0.1:1/target" if cross_origin else "/target"}
    result = (await execute_browserbase_request(upstream.connection, _params())).root
    assert isinstance(result, BrowserbaseHttpResponse)
    assert result.status == 307
    assert result.headers["location"] == upstream.headers["location"]
    assert len(upstream.requests) == 1


@pytest.mark.parametrize("failure", ["disconnect", "incomplete", "gzip"])
async def test_network_and_body_failures(
    upstream: _Upstream, failure: str, http_clients: list[httpx.AsyncClient]
) -> None:
    if failure == "disconnect":
        upstream.drop = True
    elif failure == "incomplete":
        upstream.headers = {"content-length": "9999"}
    else:
        upstream.headers = {"content-encoding": "gzip"}
    result = (await execute_browserbase_request(upstream.connection, _params())).root
    assert isinstance(result, BrowserbaseTransportError)
    assert result.reason is Reason.network
    assert result.message == "Browserbase HTTP request failed"
    assert len(upstream.requests) == 1
    assert http_clients[0].is_closed


@pytest.mark.parametrize("pause", ["headers", "body"])
async def test_deadline_covers_headers_and_buffering(
    upstream: _Upstream, pause: Literal["headers", "body"], http_clients: list[httpx.AsyncClient]
) -> None:
    upstream.pause = pause
    result = (await execute_browserbase_request(upstream.connection, _params(budget=200))).root
    assert isinstance(result, BrowserbaseTransportError)
    assert result.reason is Reason.timeout
    assert upstream.received.is_set()
    assert http_clients[0].is_closed


async def test_zero_budget_does_not_dispatch(upstream: _Upstream) -> None:
    result = (await execute_browserbase_request(upstream.connection, _params(budget=0))).root
    assert isinstance(result, BrowserbaseTransportError)
    assert result.reason is Reason.timeout
    assert not upstream.requests


async def test_missing_connection_is_unavailable() -> None:
    result = (await execute_browserbase_request(None, _params())).root
    assert isinstance(result, BrowserbaseTransportError)
    assert result.reason is Reason.unavailable


@pytest.mark.parametrize("budget", [None, 3_000_000_000.0])
async def test_no_default_http_timeout_and_client_cleanup(
    upstream: _Upstream, http_clients: list[httpx.AsyncClient], budget: float | None
) -> None:
    result = (await execute_browserbase_request(upstream.connection, _params(budget=budget))).root
    assert isinstance(result, BrowserbaseHttpResponse)
    assert len(http_clients) == 1
    assert http_clients[0].is_closed


@pytest.mark.parametrize("pause", ["headers", "body"])
async def test_task_cancellation_closes_http_client(
    upstream: _Upstream, http_clients: list[httpx.AsyncClient], pause: Literal["headers", "body"]
) -> None:
    upstream.pause = pause
    task = asyncio.create_task(execute_browserbase_request(upstream.connection, _params()))
    try:
        await asyncio.wait_for(upstream.received.wait(), 2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert http_clients[0].is_closed
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.parametrize("headers", _FIXTURES["invalidRequestHeaders"])
async def test_invalid_headers_are_validation_errors(
    upstream: _Upstream, headers: dict[str, str], http_clients: list[httpx.AsyncClient]
) -> None:
    with pytest.raises(TypeError, match="^Invalid Browserbase HTTP request$"):
        await execute_browserbase_request(upstream.connection, _params(headers=headers))
    assert not upstream.requests
    assert not http_clients


async def test_mutated_params_are_revalidated(upstream: _Upstream) -> None:
    params = _params()
    cast(dict[str, object], params.headers)["x-value"] = 42
    with pytest.raises(ValidationError):
        await execute_browserbase_request(upstream.connection, params)
    assert not upstream.requests


async def test_completed_deadline_does_not_cancel_caller(upstream: _Upstream) -> None:
    result = (await execute_browserbase_request(upstream.connection, _params(budget=100))).root
    assert isinstance(result, BrowserbaseHttpResponse)
    await asyncio.sleep(0.15)


@pytest.mark.parametrize("url", ["not-a-url", "ftp://fixture.example", "http://127.0.0.1:invalid"])
async def test_invalid_url_is_a_validation_error(url: str) -> None:
    connection = BrowserbaseConnection("bb-fixture-key", url, "session-fixture")
    with pytest.raises(TypeError, match="^Invalid Browserbase HTTP request$"):
        await execute_browserbase_request(connection, _params())
