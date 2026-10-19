import asyncio
import logging
import traceback
from email.message import Message
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from threading import Thread
from urllib.error import HTTPError, URLError
from urllib.request import Request

import pytest
from typing_extensions import override
from websockets.datastructures import Headers
from websockets.exceptions import InvalidStatus
from websockets.http11 import Response

from stagehand import cdp_client


@pytest.mark.parametrize(
    ("destination", "forward"),
    [
        ("wss://gw/devtools/browser/1", True),
        ("wss://elsewhere/devtools/browser/1", False),
        ("wss://gw:8443/devtools/browser/1", False),
        ("ws://gw:443/devtools/browser/1", False),
    ],
)
@pytest.mark.asyncio
async def test_connect_forwards_headers_only_to_authorized_websocket(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    destination: str,
    forward: bool,
) -> None:
    credentials = {"Authorization": "Bearer dummy", "X-Api-Key": "dummy-key"}
    caplog.set_level(logging.DEBUG, logger="stagehand.cdp_client")
    seen: list[object] = []

    async def resolve(url: str, *, headers: object = None) -> str:
        assert url == "https://gw/cdp"
        assert headers == credentials
        return destination

    async def connect(url: str, *, headers: object = None) -> None:
        seen.append((url, headers))
        raise RuntimeError("stop before extension setup")

    monkeypatch.setattr(cdp_client, "_resolve_browser_web_socket_url", resolve)
    monkeypatch.setattr(cdp_client, "_connect_web_socket", connect)
    with pytest.raises(RuntimeError, match="stop before extension setup"):
        await cdp_client.CDPClient.connect(
            cdp_url="https://gw/cdp", headers=credentials, extension_id="stagehand-extension"
        )
    assert seen == [(destination, credentials if forward else None)]
    records = [record for record in caplog.records if record.name == "stagehand.cdp_client"]
    assert len(records) == (0 if forward else 1)
    if not forward:
        assert "headers were withheld" in records[0].getMessage()
        assert records[0].levelno == logging.DEBUG
    for sensitive in ("Bearer dummy", "dummy-key", "Authorization", "X-Api-Key", destination):
        assert sensitive not in caplog.text


@pytest.mark.parametrize(
    "destination",
    ["https://elsewhere/path", "https://gw:8443/path", "http://gw:443/path", "https://gw:bad/path"],
)
def test_http_redirect_rejects_unsafe_header_destinations(destination: str) -> None:
    request = Request("https://gw/start", headers={"X-Api-Key": "dummy"})
    with pytest.raises(cdp_client._UnsafeCDPRedirectError):
        cdp_client._CDPRedirectHandler().redirect_request(
            request, None, 302, "Found", {}, destination
        )


@pytest.mark.parametrize(
    ("destination", "allowed"),
    [
        ("/next", True),
        ("wss://elsewhere/next", False),
        ("wss://gw:8443/next", False),
        ("ws://gw:443/next", False),
    ],
)
@pytest.mark.asyncio
async def test_websocket_redirect_guards_custom_headers(destination: str, allowed: bool) -> None:
    connector = cdp_client._CDPWebSocketConnect(
        "wss://gw/start", additional_headers={"X-Api-Key": "dummy"}
    )
    response = Response(302, "Found", Headers({"Location": destination}))
    result = connector.process_redirect(InvalidStatus(response))
    if allowed:
        assert result == "wss://gw/next"
    else:
        assert isinstance(result, cdp_client._UnsafeCDPRedirectError)


@pytest.mark.asyncio
async def test_unsafe_http_redirect_is_not_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0

    def read(url: str, headers: object = None) -> dict[str, object]:
        nonlocal calls
        calls += 1
        raise cdp_client._UnsafeCDPRedirectError("unsafe redirect")

    monkeypatch.setattr(cdp_client, "_read_json", read)
    with pytest.raises(cdp_client._UnsafeCDPRedirectError, match="unsafe redirect"):
        await asyncio.wait_for(
            cdp_client._resolve_browser_web_socket_url(
                "https://gw/cdp", headers={"X-Api-Key": "dummy"}
            ),
            timeout=1,
        )
    assert calls == 1


@pytest.mark.parametrize("cross_host", [False, True])
@pytest.mark.parametrize("with_headers", [False, True])
def test_http_discovery_redirect_does_not_leak_headers(
    cross_host: bool, with_headers: bool
) -> None:
    seen: list[tuple[str, str | None]] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            seen.append((self.path, self.headers.get("X-Api-Key")))
            if self.path == "/start":
                host = "localhost" if cross_host else "127.0.0.1"
                self.send_response(302)
                self.send_header("Location", f"http://{host}:{server.server_port}/final")
                self.end_headers()
            else:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"webSocketDebuggerUrl":"ws://browser"}')

        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        url = f"http://127.0.0.1:{server.server_port}/start"
        headers = {"X-Api-Key": "dummy"} if with_headers else None
        if cross_host and with_headers:
            with pytest.raises(cdp_client._UnsafeCDPRedirectError):
                cdp_client._read_json(url, headers)
            assert seen == [("/start", "dummy")]
        else:
            assert cdp_client._read_json(url, headers) == {"webSocketDebuggerUrl": "ws://browser"}
            expected = "dummy" if with_headers else None
            assert seen == [("/start", expected), ("/final", expected)]
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


@pytest.mark.parametrize("cross_port", [False, True])
@pytest.mark.asyncio
async def test_websocket_handshake_redirect_does_not_leak_headers(cross_port: bool) -> None:
    seen: list[bytes] = []
    port = 0

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            request = await reader.readuntil(b"\r\n\r\n")
            seen.append(request)
            if request.startswith(b"GET /start "):
                destination_port = port + 1 if port < 65535 else port - 1
                if not cross_port:
                    destination_port = port
                writer.write(
                    (
                        "HTTP/1.1 302 Found\r\n"
                        f"Location: ws://127.0.0.1:{destination_port}/final\r\n"
                        "Content-Length: 0\r\nConnection: close\r\n\r\n"
                    ).encode()
                )
            else:
                writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    async with await asyncio.start_server(handle, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        error_type = cdp_client._UnsafeCDPRedirectError if cross_port else InvalidStatus
        with pytest.raises(error_type):
            await asyncio.wait_for(
                cdp_client._connect_web_socket(
                    f"ws://127.0.0.1:{port}/start", headers={"X-Api-Key": "dummy"}
                ),
                timeout=2,
            )
    assert len(seen) == (1 if cross_port else 2)
    assert all(b"X-Api-Key: dummy\r\n" in request for request in seen)


@pytest.mark.asyncio
async def test_websocket_without_headers_preserves_cross_host_redirects() -> None:
    connector = cdp_client._CDPWebSocketConnect("wss://gw/start")
    response = Response(302, "Found", Headers({"Location": "wss://elsewhere/final"}))
    assert connector.process_redirect(InvalidStatus(response)) == "wss://elsewhere/final"


@pytest.mark.parametrize("status", [401, 403])
@pytest.mark.parametrize("headers", [None, {}, {"X-Api-Key": "dummy-secret"}])
@pytest.mark.asyncio
async def test_discovery_fails_immediately_on_authentication_errors(
    monkeypatch: pytest.MonkeyPatch, status: int, headers: dict[str, str] | None
) -> None:
    calls = 0
    body = BytesIO(b"dummy-secret response body")

    def read(url: str, headers: object = None) -> dict[str, object]:
        nonlocal calls
        calls += 1
        raise HTTPError(url, status, "dummy-secret reason", Message(), body)

    monkeypatch.setattr(cdp_client, "_read_json", read)
    with pytest.raises(
        RuntimeError, match=f"CDP discovery was rejected with HTTP {status}"
    ) as error:
        await asyncio.wait_for(
            cdp_client._resolve_browser_web_socket_url(
                "https://gateway/cdp?token=dummy-secret", headers=headers
            ),
            timeout=1,
        )
    assert calls == 1
    assert body.closed
    assert "dummy-secret" not in str(error.value)
    assert "dummy-secret reason" not in "".join(traceback.format_exception(error.value))
    assert error.value.__cause__ is None
    assert "credentials and access permissions" in str(error.value)


@pytest.mark.parametrize("status", [429, 500, 503, None])
@pytest.mark.asyncio
async def test_discovery_still_retries_transient_errors(
    monkeypatch: pytest.MonkeyPatch, status: int | None
) -> None:
    calls = 0
    body = BytesIO(b"temporary failure")

    def read(url: str, headers: object = None) -> dict[str, object]:
        nonlocal calls
        calls += 1
        if calls == 1:
            if status is None:
                raise URLError("connection refused")
            raise HTTPError(url, status, "temporary failure", Message(), body)
        return {"webSocketDebuggerUrl": "wss://gateway/browser"}

    monkeypatch.setattr(cdp_client, "_read_json", read)
    result = await asyncio.wait_for(
        cdp_client._resolve_browser_web_socket_url(
            "https://gateway", headers={"X-Api-Key": "dummy-secret"}
        ),
        timeout=2,
    )
    assert result == "wss://gateway/browser"
    assert calls == 2
    if status is not None:
        assert body.closed
