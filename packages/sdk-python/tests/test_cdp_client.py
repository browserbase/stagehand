import asyncio
import json
import os
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Self, cast
from urllib.request import Request

import pytest

from stagehand import cdp_client
from stagehand._generated.protocol_version import STAGEHAND_PROTOCOL_VERSION
from stagehand.cdp_client import (
    STAGEHAND_SEND_TO_HOST_BINDING,
    CDPClient,
    CDPConnectionClosedError,
    ServiceWorkerInfo,
    StagehandRuntimeIncompatibleError,
)


def _ready_marker() -> dict[str, object]:
    """The readiness envelope a current service worker publishes."""
    return {
        "marker": {
            "protocolVersion": STAGEHAND_PROTOCOL_VERSION,
            "serverInfo": {"name": "stagehand", "version": "1.0.0"},
            "state": "ready",
        },
        "hasReceiver": True,
    }


def _installed_extension(
    extension_id: str = "stagehand-extension",
    *,
    name: str = "Stagehand Runtime",
    enabled: object = True,
) -> dict[str, object]:
    return {
        "id": extension_id,
        "name": name,
        "version": "4.0.2",
        "path": f"/remote/extensions/{extension_id}",
        "enabled": enabled,
    }


def test_callback_batch_source_allows_native_code_text() -> None:
    expression = cdp_client._callback_batch_expression(
        message={
            "jsonrpc": "2.0",
            "id": 8,
            "method": "stagehand.callback_batch",
            "params": {},
        },
        source='async () => "[native code]"',
    )

    assert 'async () => "[native code]"' in expression
    assert "const __name = (fn, name)" in expression


class FakeWebSocket:
    def __init__(
        self,
        response_for: Callable[[dict[str, object]], dict[str, object] | None],
    ) -> None:
        self.sent: list[dict[str, object]] = []
        self.incoming: asyncio.Queue[str] = asyncio.Queue()
        self.closed = False
        self._response_for = response_for

    async def send(self, message: str) -> None:
        decoded = cast(dict[str, object], json.loads(message))
        self.sent.append(decoded)
        response = self._response_for(decoded)
        if response is not None:
            await self.incoming.put(json.dumps({"id": decoded["id"], **response}))

    async def recv(self) -> str:
        return await self.incoming.get()

    async def close(self) -> None:
        self.closed = True


@pytest.mark.asyncio
async def test_connect_loads_and_attaches_the_stagehand_extension(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def response_for(message: dict[str, object]) -> dict[str, object]:
        method = message["method"]
        if method == "Extensions.loadUnpacked":
            return {"result": {"id": "stagehand-extension"}}
        if method == "Target.getTargets":
            return {
                "result": {
                    "targetInfos": [
                        {
                            "targetId": "worker-target",
                            "type": "service_worker",
                            "title": "Stagehand",
                            "url": "chrome-extension://stagehand-extension/service-worker.js",
                        }
                    ]
                }
            }
        if method == "Target.attachToTarget":
            return {"result": {"sessionId": "worker-session"}}
        if method == "Runtime.evaluate":
            return {"result": {"result": {"value": _ready_marker()}}}
        return {"result": {}}

    socket = FakeWebSocket(response_for)

    async def resolve(_: str, **__: object) -> str:
        return "ws://127.0.0.1/devtools/browser/test"

    async def connect(_: str, **__: object) -> FakeWebSocket:
        return socket

    monkeypatch.setattr(cdp_client, "_resolve_browser_web_socket_url", resolve)
    monkeypatch.setattr(cdp_client, "_connect_web_socket", connect)

    client = await CDPClient.connect(
        cdp_url="http://127.0.0.1:9222",
        extension_dir="/tmp/stagehand-extension",
    )
    try:
        assert client.web_socket_debugger_url == "ws://127.0.0.1/devtools/browser/test"
        assert client.service_worker == ServiceWorkerInfo(
            target_id="worker-target",
            title="Stagehand",
            url="chrome-extension://stagehand-extension/service-worker.js",
            extension_id="stagehand-extension",
        )
        assert [message["method"] for message in socket.sent] == [
            "Extensions.loadUnpacked",
            "Target.getTargets",
            "Target.attachToTarget",
            "Runtime.evaluate",
            "Runtime.enable",
            "Runtime.addBinding",
            "Runtime.evaluate",
        ]
    finally:
        await client.close()
    assert socket.closed is True


@pytest.mark.asyncio
async def test_connect_uses_an_existing_extension_without_loading_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def response_for(message: dict[str, object]) -> dict[str, object]:
        if message["method"] == "Target.getTargets":
            return {
                "result": {
                    "targetInfos": [
                        {
                            "targetId": "worker-target",
                            "type": "service_worker",
                            "title": "Stagehand",
                            "url": "chrome-extension://existing-extension/service-worker.js",
                        }
                    ]
                }
            }
        if message["method"] == "Target.attachToTarget":
            return {"result": {"sessionId": "worker-session"}}
        if message["method"] == "Runtime.evaluate":
            return {"result": {"result": {"value": _ready_marker()}}}
        return {"result": {}}

    socket = FakeWebSocket(response_for)

    async def resolve(_: str, **__: object) -> str:
        return "ws://127.0.0.1/devtools/browser/test"

    async def connect(_: str, **__: object) -> FakeWebSocket:
        return socket

    monkeypatch.setattr(cdp_client, "_resolve_browser_web_socket_url", resolve)
    monkeypatch.setattr(cdp_client, "_connect_web_socket", connect)

    client = await CDPClient.connect(
        cdp_url="http://127.0.0.1:9222",
        extension_id="existing-extension",
    )
    try:
        assert "Extensions.loadUnpacked" not in [message["method"] for message in socket.sent]
        assert client.service_worker.extension_id == "existing-extension"
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_transport_bridges_json_rpc_through_the_runtime_binding() -> None:
    socket = FakeWebSocket(lambda _: {"result": {}})
    client = CDPClient(socket, "ws://127.0.0.1/devtools/browser/test")
    client._session_id = "worker-session"

    try:
        await client.send({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "test.request",
            "params": {},
        })
        await socket.incoming.put(
            json.dumps({
                "method": "Runtime.bindingCalled",
                "sessionId": "worker-session",
                "params": {
                    "name": STAGEHAND_SEND_TO_HOST_BINDING,
                    "payload": json.dumps({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "result": {"ok": True},
                    }),
                    "executionContextId": 1,
                },
            })
        )

        assert await asyncio.wait_for(client.receive(), timeout=1) == json.dumps({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {"ok": True},
        })
        evaluated = socket.sent[0]
        assert evaluated["method"] == "Runtime.evaluate"
        assert evaluated["sessionId"] == "worker-session"
        assert (
            "__stagehandReceiveFromHost" in cast(dict[str, str], evaluated["params"])["expression"]
        )
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_callback_batch_request_is_delivered_with_a_runtime_attachment() -> None:
    socket = FakeWebSocket(lambda _: {"result": {"result": {"value": True}}})
    client = CDPClient(socket, "ws://127.0.0.1/devtools/browser/test")
    client._session_id = "worker-session"
    source = "async ({ page }, input) => ({ title: await page.title(), input })"
    message: dict[str, object] = {
        "jsonrpc": "2.0",
        "id": 8,
        "method": "stagehand.callback_batch",
        "params": {
            "callback_source": source,
            "input": {"quote": '"); globalThis.__injectionSucceeded = true; ("'},
            "options": {"page_id": "page-1", "timeout": 2_000},
        },
    }

    try:
        await client.send(message)
        params = cast(dict[str, object], socket.sent[0]["params"])
        assert params["awaitPromise"] is False
        assert params["returnByValue"] is True
        expression = cast(str, params["expression"])
        assert "__stagehandReceiveFromHost" in expression
        assert "stagehand.callback_batch" in expression
        assert r"\"page_id\":\"page-1\"" in expression
        assert "callback: (async" in expression
        serialized_message = json.dumps(
            json.dumps(message, allow_nan=False, separators=(",", ":")),
            separators=(",", ":"),
        )
        assert serialized_message in expression
        assert '"); globalThis.__injectionSucceeded = true; ("' not in expression
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_callback_batch_delivery_reconstructs_runtime_exception_details() -> None:
    socket = FakeWebSocket(
        lambda _: {
            "result": {
                "exceptionDetails": {
                    "exception": {"description": "callback syntax failed"},
                }
            }
        },
    )
    client = CDPClient(socket, "ws://127.0.0.1/devtools/browser/test")
    client._session_id = "worker-session"
    try:
        with pytest.raises(RuntimeError, match="callback syntax failed"):
            await client.send(
                {
                    "jsonrpc": "2.0",
                    "id": 8,
                    "method": "stagehand.callback_batch",
                    "params": {"callback_source": "async () => undefined"},
                },
            )
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_commands_inherit_caller_cancellation_and_are_removed() -> None:
    socket = FakeWebSocket(lambda _: None)
    client = CDPClient(socket, "ws://127.0.0.1/devtools/browser/test")

    try:
        command = asyncio.create_task(client.send_command("Target.getTargets"))
        while not socket.sent:
            await asyncio.sleep(0)

        assert len(client._pending) == 1
        assert command.done() is False

        command.cancel()
        with pytest.raises(asyncio.CancelledError):
            await command
        assert client._pending == {}
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_service_worker_discovery_can_succeed_after_more_than_ten_seconds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target_polls = 0

    def response_for(message: dict[str, object]) -> dict[str, object]:
        nonlocal target_polls
        method = message["method"]
        if method == "Target.getTargets":
            target_polls += 1
            if target_polls == 1:
                return {"result": {"targetInfos": []}}
            return {
                "result": {
                    "targetInfos": [
                        {
                            "targetId": "worker-target",
                            "type": "service_worker",
                            "title": "Stagehand",
                            "url": "chrome-extension://stagehand-extension/service-worker.js",
                        }
                    ]
                }
            }
        return {"result": {}}

    elapsed_seconds = iter((0.0, 10.1))
    monkeypatch.setattr(
        cdp_client,
        "time",
        SimpleNamespace(monotonic=lambda: next(elapsed_seconds)),
    )
    socket = FakeWebSocket(response_for)
    client = CDPClient(socket, "ws://127.0.0.1/devtools/browser/test")

    try:
        worker = await client._wait_for_service_worker(
            "stagehand-extension",
            "service-worker.js",
        )
    finally:
        await client.close()

    assert worker.target_id == "worker-target"
    assert target_polls == 2


@pytest.mark.asyncio
async def test_service_worker_discovery_closes_the_wake_target_after_cancellation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    socket = FakeWebSocket(lambda _: None)
    client = CDPClient(socket, "ws://127.0.0.1/devtools/browser/test")
    wake_created = asyncio.Event()
    wake_closed = asyncio.Event()
    calls: list[tuple[str, object]] = []

    async def send_command(method: str, params: object = None, **_: object) -> dict[str, object]:
        calls.append((method, params))
        if method == "Target.getTargets":
            return {"targetInfos": []}
        if method == "Target.createTarget":
            wake_created.set()
            return {"targetId": "wake-target"}
        if method == "Target.closeTarget":
            wake_closed.set()
        return {}

    monkeypatch.setattr(client, "send_command", send_command)
    elapsed_seconds = iter((0.0, 2.0))
    monkeypatch.setattr(
        cdp_client,
        "time",
        SimpleNamespace(monotonic=lambda: next(elapsed_seconds, 2.0)),
    )

    try:
        waiting = asyncio.create_task(
            client._wait_for_service_worker("stagehand-extension", "service-worker.js")
        )
        await asyncio.wait_for(wake_created.wait(), timeout=1)
        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
        await asyncio.wait_for(wake_closed.wait(), timeout=1)
    finally:
        await client.close()

    assert ("Target.closeTarget", {"targetId": "wake-target"}) in calls


def test_json_version_probe_uses_a_short_socket_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed_timeout: object = None

    class Response:
        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_: object) -> None:
            return None

    def open_url(_: object, *, timeout: object = None) -> Response:
        nonlocal observed_timeout
        observed_timeout = timeout
        return Response()

    monkeypatch.setattr(cdp_client, "urlopen", open_url)
    monkeypatch.setattr(cdp_client.json, "load", lambda _: {"webSocketDebuggerUrl": "ws://cdp"})

    assert cdp_client._read_json("http://127.0.0.1:9222/json/version") == {
        "webSocketDebuggerUrl": "ws://cdp"
    }
    assert observed_timeout == 2


def test_json_version_probe_sends_the_callers_headers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent: dict[str, str] = {}

    class Response:
        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_: object) -> None:
            return None

    def open_url(request: Request, *, timeout: object = None) -> Response:
        sent.update(request.header_items())
        return Response()

    monkeypatch.setattr(cdp_client, "build_opener", lambda *_: SimpleNamespace(open=open_url))
    monkeypatch.setattr(cdp_client.json, "load", lambda _: {"webSocketDebuggerUrl": "wss://gw"})

    cdp_client._read_json("https://gw/cdp/json/version", {"X-Api-Key": "secret"})
    assert sent == {"X-api-key": "secret"}


@pytest.mark.asyncio
async def test_resolve_sends_headers_to_the_version_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[tuple[str, object]] = []

    def read(url: str, headers: object = None) -> dict[str, object]:
        seen.append((url, headers))
        return {"webSocketDebuggerUrl": "wss://gw/devtools/browser/1"}

    monkeypatch.setattr(cdp_client, "_read_json", read)

    url = await cdp_client._resolve_browser_web_socket_url(
        "https://gw/cdp", headers={"X-Api-Key": "secret"}
    )
    assert url == "wss://gw/devtools/browser/1"
    assert seen == [("https://gw/cdp/json/version", {"X-Api-Key": "secret"})]


@pytest.mark.parametrize(
    ("cdp_url", "web_socket_url", "same"),
    [
        ("https://gw/cdp", "wss://gw/devtools/browser/1", True),
        ("https://gw:443/cdp", "wss://gw/devtools/browser/1", True),
        ("http://127.0.0.1:9222", "ws://127.0.0.1:9222/devtools/browser/1", True),
        ("wss://gw/devtools/browser/1", "wss://gw/devtools/browser/1", True),
        ("https://gw/cdp", "wss://elsewhere/devtools/browser/1", False),
        ("https://gw/cdp", "wss://gw:8443/devtools/browser/1", False),
    ],
)
def test_headers_follow_only_to_the_same_host(
    cdp_url: str, web_socket_url: str, same: bool
) -> None:
    assert cdp_client._can_forward_headers(cdp_url, web_socket_url) is same


@pytest.mark.asyncio
async def test_connect_explains_when_chrome_cannot_load_an_extension(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    socket = FakeWebSocket(lambda _: {"error": {"code": -32601, "message": "Method not found"}})

    async def resolve(_: str, **__: object) -> str:
        return "ws://127.0.0.1/devtools/browser/test"

    async def connect(_: str, **__: object) -> FakeWebSocket:
        return socket

    monkeypatch.setattr(cdp_client, "_resolve_browser_web_socket_url", resolve)
    monkeypatch.setattr(cdp_client, "_connect_web_socket", connect)

    with pytest.raises(RuntimeError, match="does not support Extensions.loadUnpacked"):
        await CDPClient.connect(
            cdp_url="http://127.0.0.1:9222",
            extension_dir="/tmp/stagehand-extension",
        )
    assert socket.closed is True


@pytest.mark.asyncio
async def test_connect_requires_exactly_one_extension_source() -> None:
    with pytest.raises(ValueError, match="Exactly one"):
        await CDPClient.connect(cdp_url="ws://127.0.0.1/devtools/browser/test")

    with pytest.raises(ValueError, match="Exactly one"):
        await CDPClient.connect(
            cdp_url="ws://127.0.0.1/devtools/browser/test",
            extension_dir="/tmp/stagehand-extension",
            extension_id="stagehand-extension",
        )

    with pytest.raises(ValueError, match="Exactly one"):
        await CDPClient.connect(
            cdp_url="ws://127.0.0.1/devtools/browser/test",
            extension_dir="/tmp/stagehand-extension",
            preloaded_extension=True,
        )
    with pytest.raises(ValueError, match="Exactly one"):
        await CDPClient.connect(
            cdp_url="ws://127.0.0.1/devtools/browser/test",
            extension_id="stagehand-extension",
            preloaded_extension=True,
        )


@pytest.mark.parametrize("mode", ["browserbase", "local", "missing", "unsupported", "incompatible"])
async def test_connect_discovers_or_loads_extension(
    monkeypatch: pytest.MonkeyPatch,
    mode: str,
) -> None:
    accessed = []

    def directory() -> str:
        accessed.append(True)
        return "/bundle"

    def response_for(message: dict[str, object]) -> dict[str, object]:
        method = message["method"]
        if method == "Extensions.getExtensions":
            if mode == "unsupported":
                return {"error": {"code": -32601, "message": "Method not found"}}
            if mode == "missing":
                return {"result": {"extensions": []}}
            return {
                "result": {
                    "extensions": [
                        _installed_extension("other", name="Other Extension"),
                        _installed_extension("preloaded"),
                    ]
                }
            }
        if method == "Extensions.loadUnpacked":
            assert message["params"] == {"path": "/bundle"}
            return {"result": {"id": "preloaded"}}
        if method == "Target.getTargets":
            return {
                "result": {
                    "targetInfos": [
                        {
                            "targetId": "worker-target",
                            "type": "service_worker",
                            "title": "Stagehand",
                            "url": "chrome-extension://preloaded/service-worker.js",
                        }
                    ]
                }
            }
        if method == "Target.attachToTarget":
            return {"result": {"sessionId": "worker-session"}}
        if method == "Runtime.evaluate":
            readiness = _ready_marker()
            if mode == "incompatible":
                readiness["marker"] = _marker(_INCOMPATIBLE_PROTOCOL_VERSION)
            return {"result": {"result": {"value": readiness}}}
        return {"result": {}}

    socket = FakeWebSocket(response_for)

    async def resolve(_: str, **__: object) -> str:
        return "ws://127.0.0.1/devtools/browser/test"

    async def connect(_: str, **__: object) -> FakeWebSocket:
        return socket

    monkeypatch.setattr(cdp_client, "_resolve_browser_web_socket_url", resolve)
    monkeypatch.setattr(cdp_client, "_connect_web_socket", connect)
    if mode == "incompatible":
        with pytest.raises(StagehandRuntimeIncompatibleError):
            await CDPClient.connect(cdp_url="ws://browser", local_extension_dir=directory)
        assert socket.closed
        assert accessed == []
        assert "Extensions.loadUnpacked" not in [message["method"] for message in socket.sent]
        return
    client = await CDPClient.connect(
        cdp_url="ws://browser",
        preloaded_extension=mode == "browserbase",
        local_extension_dir=directory if mode != "browserbase" else None,
    )
    try:
        assert accessed == ([True] if mode in ("missing", "unsupported") else [])
        assert client.service_worker.extension_id == "preloaded"
        assert [message["method"] for message in socket.sent] == [
            "Extensions.getExtensions",
            *(["Extensions.loadUnpacked"] if mode in ("missing", "unsupported") else []),
            "Target.getTargets",
            "Target.attachToTarget",
            "Runtime.evaluate",
            "Runtime.enable",
            "Runtime.addBinding",
            "Runtime.evaluate",
        ]
    finally:
        await client.close()


async def _discover_extension_from_result(result: dict[str, object]) -> str:
    socket = FakeWebSocket(lambda _: {"result": result})
    client = CDPClient(socket, "ws://127.0.0.1/devtools/browser/test")
    try:
        return await client._resolve_extension(load_if_not_found=False)
    finally:
        await client.close()


async def test_installed_extension_discovery_reports_missing_stagehand() -> None:
    with pytest.raises(
        RuntimeError,
        match="Stagehand extension is not installed in the connected browser",
    ):
        await _discover_extension_from_result({
            "extensions": [_installed_extension("other", name="Other Extension")]
        })


async def test_installed_extension_discovery_reports_disabled_stagehand() -> None:
    with pytest.raises(RuntimeError, match="installed in the connected browser but is disabled"):
        await _discover_extension_from_result({"extensions": [_installed_extension(enabled=False)]})


async def test_installed_extension_discovery_reports_enabled_matches_in_id_order() -> None:
    with pytest.raises(
        RuntimeError,
        match="Multiple enabled Stagehand extensions are installed: stagehand-a, stagehand-z",
    ):
        await _discover_extension_from_result({
            "extensions": [
                _installed_extension("stagehand-z"),
                _installed_extension("stagehand-a"),
            ]
        })


async def test_installed_extension_discovery_rejects_malformed_inventory() -> None:
    with pytest.raises(RuntimeError, match="invalid extension entry"):
        await _discover_extension_from_result({"extensions": [_installed_extension(enabled="yes")]})


async def test_installed_extension_discovery_propagates_cdp_command_errors() -> None:
    socket = FakeWebSocket(lambda _: {"error": {"code": -32601, "message": "Method not available"}})
    client = CDPClient(socket, "ws://127.0.0.1/devtools/browser/test")
    try:
        with pytest.raises(RuntimeError, match="Extensions.getExtensions: Method not available"):
            await client._resolve_extension(load_if_not_found=False)
    finally:
        await client.close()

    assert [message["method"] for message in socket.sent] == ["Extensions.getExtensions"]


_INCOMPATIBLE_PROTOCOL_VERSION = f"{int(STAGEHAND_PROTOCOL_VERSION.split('.')[0]) + 1}.0.0"


def _marker(protocol_version: str, *, name: str = "stagehand") -> dict[str, object]:
    return {
        "protocolVersion": protocol_version,
        "serverInfo": {"name": name, "version": "1.0.0"},
    }


class TestNegotiateRuntime:
    """Mirrors the TypeScript negotiation tests so the two SDKs cannot drift apart.

    The absence of these is why a marker-shape change shipped with the Python client still
    exact-matching the removed `name`/`version` keys: pytest only covered the happy path, and
    its fixture encoded the old shape, so it agreed with the stale code.
    """

    def test_accepts_a_current_marker(self) -> None:
        negotiation = cdp_client._negotiate_runtime(_marker(STAGEHAND_PROTOCOL_VERSION))
        assert negotiation.kind == "compatible"
        assert negotiation.compatible is True
        assert f"protocolVersion={STAGEHAND_PROTOCOL_VERSION}" in negotiation.detail

    def test_tolerates_unknown_extra_keys(self) -> None:
        # A newer runtime may publish fields this client has never heard of, e.g. `status`.
        negotiation = cdp_client._negotiate_runtime({
            **_marker(STAGEHAND_PROTOCOL_VERSION),
            "status": {"state": "ready"},
        })
        assert negotiation.kind == "compatible"

    @pytest.mark.parametrize(
        ("marker", "expected"),
        [
            (None, "no Stagehand runtime marker"),
            ({}, "serverInfo=None"),
            ({"serverInfo": "not-a-mapping"}, "serverInfo="),
            ({"serverInfo": {"version": "1"}}, "serverInfo.name=None"),
            ({"serverInfo": {"name": "stagehand"}}, "serverInfo.version=None"),
            ({"serverInfo": {"name": "", "version": "1"}}, "serverInfo.name=''"),
            ({"serverInfo": {"name": "stagehand", "version": ""}}, "serverInfo.version=''"),
            ({"serverInfo": {"name": 1, "version": "1"}}, "serverInfo.name=1"),
            (
                {"protocolVersion": 1, "serverInfo": {"name": "stagehand", "version": "1"}},
                "protocolVersion=1",
            ),
            (
                {"protocolVersion": "", "serverInfo": {"name": "stagehand", "version": "1"}},
                "protocolVersion=''",
            ),
        ],
    )
    def test_reports_unreadable_markers_as_unknown(self, marker: object, expected: str) -> None:
        negotiation = cdp_client._negotiate_runtime(marker)
        assert negotiation.kind == "unknown"
        assert negotiation.compatible is False
        assert negotiation.reason is None
        assert expected in negotiation.detail

    @pytest.mark.parametrize(
        ("marker", "reason", "expected"),
        [
            (
                _marker(_INCOMPATIBLE_PROTOCOL_VERSION),
                "protocol-major-mismatch",
                f"Protocol major mismatch: client {STAGEHAND_PROTOCOL_VERSION}, "
                f"server {_INCOMPATIBLE_PROTOCOL_VERSION}",
            ),
            (
                _marker("not-semver"),
                "protocol-invalid-version",
                f"Invalid protocol version: client {STAGEHAND_PROTOCOL_VERSION}, server not-semver",
            ),
            (
                _marker(STAGEHAND_PROTOCOL_VERSION, name="other"),
                "runtime-name-mismatch",
                'Runtime name mismatch: expected "stagehand", server reported "other"',
            ),
        ],
    )
    def test_reports_unusable_runtimes_as_incompatible(
        self, marker: dict[str, object], reason: str, expected: str
    ) -> None:
        negotiation = cdp_client._negotiate_runtime(marker)
        assert negotiation.kind == "incompatible"
        assert negotiation.compatible is False
        assert negotiation.reason == reason
        assert expected in negotiation.detail
        assert negotiation.protocol_version == marker["protocolVersion"]
        assert negotiation.server_version == "1.0.0"

    def test_never_raises_on_hostile_input(self) -> None:
        for marker in ("string", 42, [], {"serverInfo": "not-a-mapping"}, {"serverInfo": None}):
            assert cdp_client._negotiate_runtime(marker).kind == "unknown"

    def test_protocol_semver_directionality(self) -> None:
        def reason(client: str, server: str) -> str | None:
            result = cdp_client._protocol_compatibility(client, server)
            return None if result is None else result[0]

        assert reason("2.2.0", "2.1.99") == "protocol-server-too-old"
        assert reason("2.2.0", "2.2.0") is None
        assert reason("3.0.0", "3.0.0") is None
        assert reason("2.2.0", "3.0.0") == "protocol-major-mismatch"
        assert reason("3.0.0", "2.2.0") == "protocol-major-mismatch"
        assert reason("2.1.1", "2.2.0") is None
        assert reason("1.2.4", "1.2.0") is None
        assert reason("1.2.4", "1.9.0") is None
        assert reason("1.2.4", "1.1.99") == "protocol-server-too-old"
        assert reason("1.2.4", "2.0.0") == "protocol-major-mismatch"
        assert reason("1.3.0-beta.1", "1.3.0-beta.1") is None
        assert reason("1.3.0-beta.1", "1.3.0-beta.2") == "protocol-prerelease-mismatch"
        assert reason("not-semver", "1.3.0") == "protocol-invalid-version"
        assert reason("1.3.0", "not-semver") == "protocol-invalid-version"

    @pytest.mark.parametrize(
        ("client", "server", "detail"),
        [
            ("1.2.4", "1.1.99", "Server protocol 1.1.99 is older than client requirement 1.2.4"),
            ("1.2.4", "2.0.0", "Protocol major mismatch: client 1.2.4, server 2.0.0"),
            (
                "1.3.0-beta.1",
                "1.3.0-beta.2",
                "Protocol prereleases must match exactly: client 1.3.0-beta.1, server 1.3.0-beta.2",
            ),
            ("1.3.0", "not-semver", "Invalid protocol version: client 1.3.0, server not-semver"),
        ],
    )
    def test_protocol_detail_wording_matches_typescript(
        self, client: str, server: str, detail: str
    ) -> None:
        # The TS SDK's compatibilityDetail is the reference wording; keep the SDKs identical.
        result = cdp_client._protocol_compatibility(client, server)
        assert result is not None
        assert result[1] == detail


def _readiness_client(
    responses: list[dict[str, object]],
) -> tuple[CDPClient, FakeWebSocket]:
    """A client whose Runtime.evaluate answers are consumed in order (last one repeats)."""

    def response_for(_: dict[str, object]) -> dict[str, object]:
        envelope = responses.pop(0) if len(responses) > 1 else responses[0]
        return {"result": envelope}

    socket = FakeWebSocket(response_for)
    return CDPClient(socket, "ws://127.0.0.1/devtools/browser/test"), socket


def _readiness(marker: object, *, has_receiver: bool = True) -> dict[str, object]:
    return {"result": {"value": {"marker": marker, "hasReceiver": has_receiver}}}


async def test_runtime_wait_fails_fast_on_an_incompatible_marker() -> None:
    client, socket = _readiness_client([_readiness(_marker(_INCOMPATIBLE_PROTOCOL_VERSION))])
    try:
        with pytest.raises(StagehandRuntimeIncompatibleError) as raised:
            await asyncio.wait_for(client._wait_for_runtime_receiver("worker-session"), timeout=1)
    finally:
        await client.close()

    error = raised.value
    assert error.reason == "protocol-major-mismatch"
    assert error.client_protocol_version == STAGEHAND_PROTOCOL_VERSION
    assert error.reported_protocol_version == _INCOMPATIBLE_PROTOCOL_VERSION
    assert (error.server_name, error.server_version) == ("stagehand", "1.0.0")
    assert f"client protocol {STAGEHAND_PROTOCOL_VERSION}" in str(error)
    assert f"reported protocol {_INCOMPATIBLE_PROTOCOL_VERSION}" in str(error)
    assert "Upgrade the Stagehand SDK and the Stagehand extension" in str(error)
    # Raised on the first poll: exactly one readiness evaluation, no sleep/re-poll.
    assert [message["method"] for message in socket.sent] == ["Runtime.evaluate"]


async def test_runtime_wait_fails_fast_on_a_foreign_runtime() -> None:
    client, socket = _readiness_client([
        _readiness(_marker(STAGEHAND_PROTOCOL_VERSION, name="other"))
    ])
    try:
        with pytest.raises(StagehandRuntimeIncompatibleError) as raised:
            await asyncio.wait_for(client._wait_for_runtime_receiver("worker-session"), timeout=1)
    finally:
        await client.close()

    assert raised.value.reason == "runtime-name-mismatch"
    assert raised.value.server_name == "other"
    assert [message["method"] for message in socket.sent] == ["Runtime.evaluate"]


async def test_runtime_wait_keeps_polling_an_unknown_marker_until_compatible() -> None:
    client, socket = _readiness_client([
        _readiness(None, has_receiver=False),
        _readiness(None, has_receiver=False),
        _readiness(None, has_receiver=True),
        {"result": {"value": _ready_marker()}},
    ])
    try:
        await asyncio.wait_for(client._wait_for_runtime_receiver("worker-session"), timeout=5)
    finally:
        await client.close()

    assert [message["method"] for message in socket.sent] == ["Runtime.evaluate"] * 4


async def test_runtime_wait_keeps_polling_an_incompatible_marker_when_fallback_is_allowed() -> None:
    client, socket = _readiness_client([_readiness(_marker(_INCOMPATIBLE_PROTOCOL_VERSION))])
    try:
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(
                client._wait_for_runtime_receiver("worker-session", allow_fallback_install=True),
                timeout=0.35,
            )
    finally:
        await client.close()

    assert len(socket.sent) >= 2
    assert {message["method"] for message in socket.sent} == {"Runtime.evaluate"}


@pytest.mark.parametrize(
    "response",
    [
        {"result": {"extensions": [_installed_extension(enabled=False)]}},
        {"result": {"extensions": [_installed_extension("a"), _installed_extension("b")]}},
        {"result": {"extensions": [{"id": "malformed"}]}},
        {"error": {"code": -32000, "message": "Permission denied"}},
    ],
)
async def test_local_discovery_errors_do_not_load(response: dict[str, object]) -> None:
    socket = FakeWebSocket(lambda _: response)
    client = CDPClient(socket, "ws://browser")

    def directory() -> str:
        pytest.fail("must not access bundled extension")

    try:
        with pytest.raises(RuntimeError):
            await client._resolve_extension(load_if_not_found=True, extension_dir=directory)
        assert [message["method"] for message in socket.sent] == ["Extensions.getExtensions"]
    finally:
        await client.close()


@pytest.mark.parametrize("phase", ["discovery", "loading"])
async def test_local_cancellation_closes_connection(
    monkeypatch: pytest.MonkeyPatch,
    phase: str,
) -> None:
    requested = asyncio.Event()

    def response_for(message: dict[str, object]) -> dict[str, object] | None:
        if phase == "loading" and message["method"] == "Extensions.getExtensions":
            return {"result": {"extensions": []}}
        requested.set()
        return None

    socket = FakeWebSocket(response_for)

    async def connect(_: str, **__: object) -> FakeWebSocket:
        return socket

    monkeypatch.setattr(cdp_client, "_connect_web_socket", connect)

    def directory() -> str:
        if phase == "discovery":
            pytest.fail("must not access bundled extension after cancellation")
        return "/bundle"

    task = asyncio.create_task(
        CDPClient.connect(cdp_url="ws://browser", local_extension_dir=directory)
    )
    await asyncio.wait_for(requested.wait(), timeout=1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert socket.closed
    assert [message["method"] for message in socket.sent] == [
        "Extensions.getExtensions",
        *(["Extensions.loadUnpacked"] if phase == "loading" else []),
    ]


async def test_local_loading_failure_closes_connection_without_retrying(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def response_for(message: dict[str, object]) -> dict[str, object]:
        if message["method"] == "Extensions.getExtensions":
            return {"result": {"extensions": []}}
        return {"error": {"code": -32000, "message": "load failed"}}

    socket = FakeWebSocket(response_for)

    async def connect(_: str, **__: object) -> FakeWebSocket:
        return socket

    monkeypatch.setattr(cdp_client, "_connect_web_socket", connect)
    with pytest.raises(RuntimeError, match="load failed"):
        await CDPClient.connect(cdp_url="ws://browser", local_extension_dir=lambda: "/bundle")
    assert socket.closed
    assert [message["method"] for message in socket.sent] == [
        "Extensions.getExtensions",
        "Extensions.loadUnpacked",
    ]


def _lifecycle_client(
    target_type: str, *, attach: bool, detach: bool | BaseException = True
) -> tuple[CDPClient, list[str]]:
    calls: list[str] = []

    def response_for(message: dict[str, object]) -> dict[str, object]:
        method = cast(str, message["method"])
        params = cast(dict[str, object], message.get("params") or {})
        if method == "Runtime.evaluate":
            action = "detach" if '"detach"' in str(params.get("expression")) else "attach"
            calls.append(action)
            if action == "detach" and isinstance(detach, BaseException):
                raise detach
            return {"result": {"result": {"value": detach if action == "detach" else attach}}}
        calls.append(method)
        if method == "Target.createTarget":
            return {"result": {"targetId": "marker"}}
        if method == "Target.getTargetInfo":
            return {"result": {"targetInfo": {"type": target_type}}}
        return {"result": {}}

    client = CDPClient(FakeWebSocket(response_for), "ws://127.0.0.1/devtools/browser/test")
    client._session_id = "worker-session"
    return client, calls


@pytest.mark.asyncio
@pytest.mark.parametrize("target_type", ["page", "iframe", "worker"])
async def test_client_registration_requires_chrome_137_for_hidden_targets(
    target_type: str,
) -> None:
    client, calls = _lifecycle_client(target_type, attach=True)
    try:
        with pytest.raises(RuntimeError, match="requires Chrome 137 or later"):
            await client._register_client(True, "ws://browser")
        assert calls == ["Target.createTarget", "Target.getTargetInfo", "Target.closeTarget"]
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_client_registration_rejects_an_extension_without_lifecycle_support() -> None:
    client, calls = _lifecycle_client("other", attach=False)
    try:
        with pytest.raises(RuntimeError, match="does not support the client watchdog"):
            await client._register_client(True, "ws://browser")
        assert calls == [
            "Target.createTarget",
            "Target.getTargetInfo",
            "attach",
            "Target.closeTarget",
        ]
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_detach_client_runs_once_when_acknowledged() -> None:
    client, calls = _lifecycle_client("other", attach=True)
    try:
        await client._register_client(True, "ws://browser")
        await client.detach_client()
        await client.detach_client()
        assert calls == ["Target.createTarget", "Target.getTargetInfo", "attach", "detach"]
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_detach_client_raises_when_not_acknowledged() -> None:
    client, _ = _lifecycle_client("other", attach=True, detach=False)
    try:
        await client._register_client(True, "ws://browser")
        with pytest.raises(RuntimeError, match="did not acknowledge the detach"):
            await client.detach_client()
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_detach_client_treats_a_closed_connection_as_a_completed_detach() -> None:
    # Browserbase ends a keep_alive=False session once the extension closes its connection.
    client, calls = _lifecycle_client("other", attach=True, detach=CDPConnectionClosedError())
    try:
        await client._register_client(False, "ws://browser")
        await client.detach_client()
        await client.detach_client()
        assert calls.count("detach") == 1
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_detach_client_raises_a_lost_connection_when_the_browser_is_shut_down_on_loss() -> (
    None
):
    client, _ = _lifecycle_client("other", attach=True, detach=CDPConnectionClosedError())
    try:
        await client._register_client(True, "ws://browser")
        with pytest.raises(CDPConnectionClosedError):
            await client.detach_client()
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_detach_client_still_raises_when_detach_fails_with_the_connection_open() -> None:
    client, _ = _lifecycle_client("other", attach=True, detach=RuntimeError("detach failed"))
    try:
        await client._register_client(True, "ws://browser")
        with pytest.raises(RuntimeError, match="detach failed"):
            await client.detach_client()
    finally:
        await client.close()


_BUILD_A = "a" * 64
_BUILD_B = "b" * 64


async def _connect_with_builds(
    monkeypatch: pytest.MonkeyPatch,
    source: dict[str, object],
    builds: dict[str, object],
    installed: list[dict[str, object]] | None = None,
    readiness: dict[str, object] | None = None,
    reload_error: dict[str, object] | None = None,
) -> tuple[CDPClient | None, BaseException | None, list[dict[str, object]]]:
    def response_for(message: dict[str, object]) -> dict[str, object]:
        method = message["method"]
        params = cast(dict[str, object], message.get("params") or {})
        if method == "Extensions.getExtensions":
            return {"result": {"extensions": installed or []}}
        if method == "Extensions.loadUnpacked":
            if reload_error is not None and _first_build_read(socket.sent) < len(socket.sent):
                return {"error": reload_error}
            return {"result": {"id": "stagehand-extension"}}
        if method == "Target.getTargets":
            return {
                "result": {
                    "targetInfos": [
                        {
                            "targetId": target_id,
                            "type": "service_worker",
                            "title": "Stagehand",
                            "url": "chrome-extension://stagehand-extension/service-worker.js",
                        }
                        for target_id in (
                            "new-worker"
                            if _reloads(socket.sent) and reload_error is None
                            else "old-worker",
                        )
                    ]
                }
            }
        if method == "Target.attachToTarget":
            return {"result": {"sessionId": f"{params['targetId']}-session"}}
        if method == "Runtime.evaluate":
            if "build-id.txt" in str(params["expression"]):
                worker = str(message["sessionId"]).removesuffix("-session")
                return {"result": {"result": {"value": builds[worker]}}}
            return {"result": {"result": {"value": readiness or _ready_marker()}}}
        return {"result": {}}

    socket = FakeWebSocket(response_for)

    async def resolve(_: str, **__: object) -> str:
        return "ws://127.0.0.1/devtools/browser/test"

    async def connect(_: str, **__: object) -> FakeWebSocket:
        return socket

    monkeypatch.setattr(cdp_client, "_resolve_browser_web_socket_url", resolve)
    monkeypatch.setattr(cdp_client, "_connect_web_socket", connect)
    try:
        # Waiting for a service worker has no deadline, so a missing replacement would hang.
        async with asyncio.timeout(5):
            client = await CDPClient.connect(cdp_url="ws://browser", **cast(dict[str, Any], source))
    except Exception as error:
        return None, error, socket.sent
    return client, None, socket.sent


def _methods(sent: list[dict[str, object]]) -> list[object]:
    return [message["method"] for message in sent]


def _first_build_read(sent: list[dict[str, object]]) -> int:
    return next(
        (
            index
            for index, message in enumerate(sent)
            if "build-id.txt"
            in str(cast(dict[str, object], message.get("params") or {}).get("expression"))
        ),
        len(sent),
    )


def _reloads(sent: list[dict[str, object]]) -> list[object]:
    return [
        cast(dict[str, object], message["params"])["path"]
        for message in sent[_first_build_read(sent) :]
        if message["method"] == "Extensions.loadUnpacked"
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["extension_dir", "local_extension_dir"])
async def test_connect_replaces_a_worker_from_another_build_after_loading(
    monkeypatch: pytest.MonkeyPatch, source: str
) -> None:
    client, error, sent = await _connect_with_builds(
        monkeypatch,
        {source: "/bundle" if source == "extension_dir" else lambda: "/bundle"},
        {
            "old-worker": {"running": None, "onDisk": _BUILD_B},
            "new-worker": {"running": _BUILD_B, "onDisk": _BUILD_B},
        },
    )
    assert error is None and client is not None
    try:
        assert client.service_worker.target_id == "new-worker"
        assert [method for method in _methods(sent) if str(method).startswith("Extensions.")] == [
            *(["Extensions.getExtensions"] if source == "local_extension_dir" else []),
            "Extensions.loadUnpacked",
            "Extensions.loadUnpacked",
        ]
        assert _reloads(sent) == ["/bundle"]
    finally:
        await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "build",
    [
        {"running": _BUILD_A, "onDisk": _BUILD_A},
        {"running": _BUILD_A, "onDisk": None},
        {"running": _BUILD_A, "onDisk": ""},
    ],
)
async def test_connect_keeps_a_worker_that_is_current_or_unidentified(
    monkeypatch: pytest.MonkeyPatch, build: dict[str, object]
) -> None:
    client, error, sent = await _connect_with_builds(
        monkeypatch, {"extension_dir": "/bundle"}, {"old-worker": build}
    )
    assert error is None and client is not None
    try:
        assert client.service_worker.target_id == "old-worker"
        assert _reloads(sent) == []
    finally:
        await client.close()


async def _connect_installed_from(
    monkeypatch: pytest.MonkeyPatch, installed_path: str, local_dir: str
) -> tuple[CDPClient | None, BaseException | None, list[dict[str, object]]]:
    return await _connect_with_builds(
        monkeypatch,
        {"local_extension_dir": lambda: local_dir},
        {
            "old-worker": {"running": _BUILD_A, "onDisk": _BUILD_B},
            "new-worker": {"running": _BUILD_B, "onDisk": _BUILD_B},
        },
        [{**_installed_extension(), "path": installed_path}],
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "local_dir",
    [
        lambda bundle: str(bundle),
        lambda bundle: f"{bundle}/",
        lambda bundle: str(bundle.parent / "link"),
    ],
    ids=["the same path", "a trailing slash", "a symlink"],
)
async def test_connect_replaces_a_worker_when_installed_from_its_own_directory(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, local_dir: Callable[[Path], str]
) -> None:
    bundle = tmp_path / "Bundle"
    bundle.mkdir()
    (tmp_path / "link").symlink_to(bundle)
    client, error, sent = await _connect_installed_from(monkeypatch, str(bundle), local_dir(bundle))
    assert error is None and client is not None
    try:
        assert client.service_worker.target_id == "new-worker"
        assert [method for method in _methods(sent) if str(method).startswith("Extensions.")] == [
            "Extensions.getExtensions",
            "Extensions.loadUnpacked",
        ]
        assert _reloads(sent) == [local_dir(bundle)]
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_connect_treats_a_directory_in_another_letter_case_as_its_own(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    bundle = tmp_path / "Bundle"
    bundle.mkdir()
    upper = tmp_path / "BUNDLE"
    if not os.path.exists(upper):
        pytest.skip("the filesystem is case-sensitive")
    client, error, _ = await _connect_installed_from(monkeypatch, str(bundle), str(upper))
    assert error is None and client is not None
    try:
        assert client.service_worker.target_id == "new-worker"
    finally:
        await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("local_dir", ["/missing/bundle", "/missing/other/../bundle/"])
async def test_connect_owns_a_directory_it_cannot_read_given_as_the_same_path(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, local_dir: str
) -> None:
    with caplog.at_level("WARNING", logger=cdp_client.__name__):
        client, error, sent = await _connect_installed_from(
            monkeypatch, "/missing/bundle", local_dir
        )
    assert error is None and client is not None
    try:
        assert client.service_worker.target_id == "new-worker"
        assert _reloads(sent) == [local_dir]
        assert caplog.records == []
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_connect_does_not_own_a_directory_it_cannot_read_given_as_another_path(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level("WARNING", logger=cdp_client.__name__):
        client, error, sent = await _connect_installed_from(
            monkeypatch, "/missing/bundle", "/missing/other"
        )
    assert error is None and client is not None
    try:
        assert client.service_worker.target_id == "old-worker"
        assert _reloads(sent) == []
        assert len(caplog.records) == 1
    finally:
        await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "source",
    [
        {"local_extension_dir": lambda: "/bundle"},
        {"extension_id": "stagehand-extension"},
        {"preloaded_extension": True},
    ],
)
async def test_connect_warns_and_continues_with_an_extension_it_does_not_own(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    source: dict[str, object],
) -> None:
    with caplog.at_level("WARNING", logger=cdp_client.__name__):
        client, error, sent = await _connect_with_builds(
            monkeypatch,
            source,
            {"old-worker": {"running": _BUILD_A, "onDisk": _BUILD_B}},
            [_installed_extension()],
        )
    assert error is None and client is not None
    try:
        assert client.service_worker.target_id == "old-worker"
        warnings = [record.getMessage() for record in caplog.records]
        assert len(warnings) == 1
        assert (
            f"runs service worker build {_BUILD_A}, but its directory holds build {_BUILD_B}: "
            "the browser profile kept the worker of another build" in warnings[0]
        )
        assert "Extensions.loadUnpacked" not in _methods(sent)
        assert _reloads(sent) == []
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_connect_keeps_the_incompatibility_error_for_a_worker_it_does_not_replace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, error, _ = await _connect_with_builds(
        monkeypatch,
        {"extension_id": "stagehand-extension"},
        {"old-worker": {"running": _BUILD_A, "onDisk": _BUILD_B}},
        readiness={**_ready_marker(), "marker": _marker(_INCOMPATIBLE_PROTOCOL_VERSION)},
    )
    assert isinstance(error, StagehandRuntimeIncompatibleError)


@pytest.mark.asyncio
async def test_connect_warns_and_continues_when_the_reloaded_worker_still_runs_another_build(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    stale = {"running": _BUILD_A, "onDisk": _BUILD_B}
    with caplog.at_level("WARNING", logger=cdp_client.__name__):
        client, error, sent = await _connect_with_builds(
            monkeypatch, {"extension_dir": "/bundle"}, {"old-worker": stale, "new-worker": stale}
        )
    assert error is None and client is not None
    try:
        assert client.service_worker.target_id == "new-worker"
        assert [record.getMessage() for record in caplog.records] == [
            f"The Stagehand extension stagehand-extension still runs service worker build "
            f"{_BUILD_A} after it was reloaded from a directory that holds build {_BUILD_B}, "
            "so Stagehand continues with the running worker."
        ]
        assert _reloads(sent) == ["/bundle"]
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_connect_warns_and_continues_when_loading_the_extension_again_fails(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level("WARNING", logger=cdp_client.__name__):
        client, error, sent = await _connect_with_builds(
            monkeypatch,
            {"extension_dir": "/bundle"},
            {"old-worker": {"running": _BUILD_A, "onDisk": _BUILD_B}},
            reload_error={"code": -32000, "message": "Manifest file is missing or unreadable"},
        )
    assert error is None and client is not None
    try:
        assert client.service_worker.target_id == "old-worker"
        assert [record.getMessage() for record in caplog.records] == [
            f"The Stagehand extension stagehand-extension runs service worker build {_BUILD_A}, "
            f"but its directory holds build {_BUILD_B}: the browser profile kept the worker of "
            "another build. Stagehand could not load this extension again from its directory "
            "to replace the worker, so it continues with the running worker."
        ]
        assert _reloads(sent) == ["/bundle"]
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_service_worker_build_waits_for_the_runtime_marker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    values: list[object] = [None, {"running": "a", "onDisk": "b"}]
    client = CDPClient(FakeWebSocket(lambda _: None), "ws://browser")
    sent: list[dict[str, object]] = []

    async def send_command(
        method: str, params: dict[str, object] | None = None, **kwargs: object
    ) -> dict[str, object]:
        sent.append({"method": method, "params": params, **kwargs})
        return {"result": {"value": values.pop(0)}}

    async def no_sleep(_: float) -> None:
        return None

    monkeypatch.setattr(client, "send_command", send_command)
    monkeypatch.setattr(cdp_client.asyncio, "sleep", no_sleep)
    try:
        build = await client._read_service_worker_build("worker-session")
        assert (build.running, build.on_disk, build.stale) == ("a", "b", True)
        assert len(sent) == 2
        assert sent[-1]["session_id"] == "worker-session"
        assert cast(dict[str, object], sent[-1]["params"])["awaitPromise"] is True
    finally:
        await client.close()


async def _read_build_with(
    monkeypatch: pytest.MonkeyPatch, answers: Callable[[int], object]
) -> tuple[cdp_client._ServiceWorkerBuild, int]:
    client = CDPClient(FakeWebSocket(lambda _: None), "ws://browser")
    calls = 0

    async def send_command(*_: object, **__: object) -> dict[str, object]:
        nonlocal calls
        calls += 1
        answer = answers(calls)
        if isinstance(answer, BaseException):
            raise answer
        return {"result": {"value": answer}}

    monkeypatch.setattr(client, "send_command", send_command)
    try:
        return await client._read_service_worker_build("worker-session"), calls
    finally:
        await client.close()


def _no_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    async def no_sleep(_: float) -> None:
        return None

    monkeypatch.setattr(cdp_client.asyncio, "sleep", no_sleep)


@pytest.mark.asyncio
async def test_service_worker_build_retries_a_read_that_throws_while_the_worker_starts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _no_sleep(monkeypatch)
    build, calls = await _read_build_with(
        monkeypatch,
        lambda call: (
            RuntimeError("Cannot find default execution context")
            if call == 1
            else {"running": "a", "onDisk": "b"}
        ),
    )
    assert (build.running, build.on_disk, build.stale, calls) == ("a", "b", True, 2)


@pytest.mark.asyncio
async def test_service_worker_build_is_not_compared_when_the_read_keeps_throwing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _no_sleep(monkeypatch)
    build, calls = await _read_build_with(
        monkeypatch, lambda _: RuntimeError("Execution context was destroyed")
    )
    assert (build.running, build.on_disk, build.stale, calls) == (None, None, False, 16)


@pytest.mark.asyncio
async def test_service_worker_build_read_stops_when_the_connection_closes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _no_sleep(monkeypatch)
    with pytest.raises(CDPConnectionClosedError):
        await _read_build_with(monkeypatch, lambda _: CDPConnectionClosedError())


@pytest.mark.asyncio
async def test_service_worker_build_is_not_compared_when_the_marker_never_appears(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(cdp_client, "_SERVICE_WORKER_BUILD_READ_TIMEOUT_SECONDS", 0.05)
    build, calls = await _read_build_with(monkeypatch, lambda _: None)
    assert (build.running, build.on_disk, build.stale) == (None, None, False)
    assert calls >= 1


@pytest.mark.parametrize(
    ("running", "on_disk", "stale"),
    [
        ("a", "a", False),
        ("a", "b", True),
        (None, "b", True),
        ("a", None, False),
        (None, None, False),
        ("__STAGEHAND_EXTENSION_BUILD_ID__", "b", False),
        ("a", "__STAGEHAND_EXTENSION_BUILD_ID__", False),
        ("a", "", False),
        ("", "b", False),
    ],
)
def test_service_worker_build_staleness(
    running: str | None, on_disk: str | None, stale: bool
) -> None:
    assert cdp_client._ServiceWorkerBuild(running=running, on_disk=on_disk).stale is stale
