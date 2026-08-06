import asyncio
import json
from collections.abc import Callable
from types import SimpleNamespace
from typing import Self, cast

import pytest

from stagehand import cdp_client
from stagehand._generated.protocol_version import STAGEHAND_PROTOCOL_VERSION
from stagehand.cdp_client import (
    STAGEHAND_SEND_TO_HOST_BINDING,
    CDPClient,
    ServiceWorkerInfo,
)


def _ready_marker() -> dict[str, object]:
    """The readiness envelope a current service worker publishes."""
    return {
        "marker": {
            "protocolVersion": STAGEHAND_PROTOCOL_VERSION,
            "serverInfo": {"name": "stagehand", "version": "4.0.0"},
            "state": "ready",
        },
        "hasReceiver": True,
    }


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

    async def resolve(_: str) -> str:
        return "ws://127.0.0.1/devtools/browser/test"

    async def connect(_: str) -> FakeWebSocket:
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

    async def resolve(_: str) -> str:
        return "ws://127.0.0.1/devtools/browser/test"

    async def connect(_: str) -> FakeWebSocket:
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
async def test_callback_batch_evaluates_in_the_attached_service_worker() -> None:
    socket = FakeWebSocket(
        lambda _: {
            "result": {
                "result": {
                    "value": {"ok": True, "value": {"title": "Example"}},
                }
            }
        }
    )
    client = CDPClient(socket, "ws://127.0.0.1/devtools/browser/test")
    client._session_id = "worker-session"

    try:
        result = await client.run_callback_batch(
            source="async ({ page }, input) => ({ title: await page.title(), input })",
            input={"quote": '"); globalThis.__injectionSucceeded = true; ("'},
            page_id="page-1",
            timeout=2_000,
        )
        assert result == {"title": "Example"}
        params = cast(dict[str, object], socket.sent[0]["params"])
        assert params["awaitPromise"] is True
        assert params["returnByValue"] is True
        expression = cast(str, params["expression"])
        assert "__stagehandRunCallbackBatch" in expression
        assert '"pageId":"page-1"' in expression
        assert r"\"); globalThis.__injectionSucceeded = true; (\"" in expression
        assert '"); globalThis.__injectionSucceeded = true; ("' not in expression
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

    def open_url(_: str, *, timeout: object = None) -> Response:
        nonlocal observed_timeout
        observed_timeout = timeout
        return Response()

    monkeypatch.setattr(cdp_client, "urlopen", open_url)
    monkeypatch.setattr(cdp_client.json, "load", lambda _: {"webSocketDebuggerUrl": "ws://cdp"})

    assert cdp_client._read_json("http://127.0.0.1:9222/json/version") == {
        "webSocketDebuggerUrl": "ws://cdp"
    }
    assert observed_timeout == 2


@pytest.mark.asyncio
async def test_connect_explains_when_chrome_cannot_load_an_extension(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    socket = FakeWebSocket(lambda _: {"error": {"code": -32601, "message": "Method not found"}})

    async def resolve(_: str) -> str:
        return "ws://127.0.0.1/devtools/browser/test"

    async def connect(_: str) -> FakeWebSocket:
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


async def test_connect_discovers_a_ready_preloaded_extension(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def response_for(message: dict[str, object]) -> dict[str, object]:
        method = message["method"]
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
            return {"result": {"result": {"value": _ready_marker()}}}
        return {"result": {}}

    socket = FakeWebSocket(response_for)

    async def resolve(_: str) -> str:
        return "ws://127.0.0.1/devtools/browser/test"

    async def connect(_: str) -> FakeWebSocket:
        return socket

    monkeypatch.setattr(cdp_client, "_resolve_browser_web_socket_url", resolve)
    monkeypatch.setattr(cdp_client, "_connect_web_socket", connect)
    client = await CDPClient.connect(
        cdp_url="wss://browserbase",
        preloaded_extension=True,
    )
    try:
        assert client.service_worker.extension_id == "preloaded"
        assert "Extensions.loadUnpacked" not in [message["method"] for message in socket.sent]
    finally:
        await client.close()


async def test_preloaded_discovery_detaches_stale_worker_then_accepts_ready_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_targets_calls = 0

    def response_for(message: dict[str, object]) -> dict[str, object]:
        nonlocal get_targets_calls
        method = message["method"]
        if method == "Target.getTargets":
            get_targets_calls += 1
            name = "stale" if get_targets_calls == 1 else "ready"
            return {
                "result": {
                    "targetInfos": [
                        {
                            "targetId": name,
                            "type": "service_worker",
                            "title": name,
                            "url": f"chrome-extension://{name}/service-worker.js",
                        }
                    ]
                }
            }
        if method == "Target.attachToTarget":
            target_id = cast(dict[str, object], message["params"])["targetId"]
            return {"result": {"sessionId": f"{target_id}-session"}}
        if method == "Runtime.evaluate":
            if message.get("sessionId") == "stale-session":
                stale = _ready_marker()
                stale["hasReceiver"] = False
                return {"result": {"result": {"value": stale}}}
            return {"result": {"result": {"value": _ready_marker()}}}
        return {"result": {}}

    socket = FakeWebSocket(response_for)

    async def resolve(_: str) -> str:
        return "ws://127.0.0.1/devtools/browser/test"

    async def connect(_: str) -> FakeWebSocket:
        return socket

    monkeypatch.setattr(cdp_client, "_resolve_browser_web_socket_url", resolve)
    monkeypatch.setattr(cdp_client, "_connect_web_socket", connect)
    client = await CDPClient.connect(
        cdp_url="wss://browserbase",
        preloaded_extension=True,
    )
    try:
        assert client.service_worker.target_id == "ready"
        detach = [
            message for message in socket.sent if message["method"] == "Target.detachFromTarget"
        ]
        assert cast(dict[str, object], detach[0]["params"])["sessionId"] == "stale-session"
    finally:
        await client.close()


async def test_preloaded_discovery_detaches_incompatible_worker_then_accepts_ready_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_targets_calls = 0

    def response_for(message: dict[str, object]) -> dict[str, object]:
        nonlocal get_targets_calls
        method = message["method"]
        if method == "Target.getTargets":
            get_targets_calls += 1
            name = "foreign" if get_targets_calls == 1 else "ready"
            return {
                "result": {
                    "targetInfos": [
                        {
                            "targetId": name,
                            "type": "service_worker",
                            "title": name,
                            "url": f"chrome-extension://{name}/service-worker.js",
                        }
                    ]
                }
            }
        if method == "Target.attachToTarget":
            target_id = cast(dict[str, object], message["params"])["targetId"]
            return {"result": {"sessionId": f"{target_id}-session"}}
        if method == "Runtime.evaluate":
            if message.get("sessionId") == "foreign-session":
                incompatible = _ready_marker()
                incompatible["marker"] = {
                    "protocolVersion": STAGEHAND_PROTOCOL_VERSION,
                    "serverInfo": {"name": "foreign-extension", "version": "1.0.0"},
                    "state": "ready",
                }
                return {"result": {"result": {"value": incompatible}}}
            return {"result": {"result": {"value": _ready_marker()}}}
        return {"result": {}}

    socket = FakeWebSocket(response_for)

    async def resolve(_: str) -> str:
        return "ws://127.0.0.1/devtools/browser/test"

    async def connect(_: str) -> FakeWebSocket:
        return socket

    monkeypatch.setattr(cdp_client, "_resolve_browser_web_socket_url", resolve)
    monkeypatch.setattr(cdp_client, "_connect_web_socket", connect)
    client = await CDPClient.connect(
        cdp_url="wss://browserbase",
        preloaded_extension=True,
    )
    try:
        assert client.service_worker.target_id == "ready"
        detach = [
            message for message in socket.sent if message["method"] == "Target.detachFromTarget"
        ]
        assert cast(dict[str, object], detach[0]["params"])["sessionId"] == "foreign-session"
    finally:
        await client.close()


async def test_preloaded_discovery_accepts_worker_without_extension_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def response_for(message: dict[str, object]) -> dict[str, object]:
        method = message["method"]
        if method == "Target.getTargets":
            return {
                "result": {
                    "targetInfos": [
                        {
                            "targetId": "worker-target",
                            "type": "service_worker",
                            "title": "Stagehand",
                            "url": "chrome-extension:///service-worker.js",
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

    async def resolve(_: str) -> str:
        return "ws://127.0.0.1/devtools/browser/test"

    async def connect(_: str) -> FakeWebSocket:
        return socket

    monkeypatch.setattr(cdp_client, "_resolve_browser_web_socket_url", resolve)
    monkeypatch.setattr(cdp_client, "_connect_web_socket", connect)
    client = await CDPClient.connect(
        cdp_url="wss://browserbase",
        preloaded_extension=True,
    )
    try:
        assert client.service_worker.extension_id is None
    finally:
        await client.close()


async def test_preloaded_discovery_detaches_ready_worker_with_missing_title(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_targets_calls = 0

    def response_for(message: dict[str, object]) -> dict[str, object]:
        nonlocal get_targets_calls
        method = message["method"]
        if method == "Target.getTargets":
            get_targets_calls += 1
            if get_targets_calls == 1:
                target = {
                    "targetId": "missing-title",
                    "type": "service_worker",
                    "url": "chrome-extension://missing-title/service-worker.js",
                }
            else:
                target = {
                    "targetId": "ready",
                    "type": "service_worker",
                    "title": "ready",
                    "url": "chrome-extension://ready/service-worker.js",
                }
            return {"result": {"targetInfos": [target]}}
        if method == "Target.attachToTarget":
            target_id = cast(dict[str, object], message["params"])["targetId"]
            return {"result": {"sessionId": f"{target_id}-session"}}
        if method == "Runtime.evaluate":
            return {"result": {"result": {"value": _ready_marker()}}}
        return {"result": {}}

    socket = FakeWebSocket(response_for)

    async def resolve(_: str) -> str:
        return "ws://127.0.0.1/devtools/browser/test"

    async def connect(_: str) -> FakeWebSocket:
        return socket

    monkeypatch.setattr(cdp_client, "_resolve_browser_web_socket_url", resolve)
    monkeypatch.setattr(cdp_client, "_connect_web_socket", connect)
    client = await CDPClient.connect(
        cdp_url="wss://browserbase",
        preloaded_extension=True,
    )
    try:
        assert client.service_worker.target_id == "ready"
        detach = [
            message for message in socket.sent if message["method"] == "Target.detachFromTarget"
        ]
        assert cast(dict[str, object], detach[0]["params"])["sessionId"] == (
            "missing-title-session"
        )
    finally:
        await client.close()


async def test_preloaded_discovery_remains_open_until_the_caller_cancels(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    discovery_started = asyncio.Event()

    def response_for(message: dict[str, object]) -> dict[str, object]:
        if message["method"] == "Target.getTargets":
            discovery_started.set()
            return {
                "result": {
                    "targetInfos": [
                        {
                            "targetId": "page",
                            "type": "page",
                            "title": "Page",
                            "url": "https://example.com",
                        }
                    ]
                }
            }
        return {"result": {}}

    socket = FakeWebSocket(response_for)

    async def resolve(_: str) -> str:
        return "ws://127.0.0.1/devtools/browser/test"

    async def connect(_: str) -> FakeWebSocket:
        return socket

    monkeypatch.setattr(cdp_client, "_resolve_browser_web_socket_url", resolve)
    monkeypatch.setattr(cdp_client, "_connect_web_socket", connect)
    connecting = asyncio.create_task(
        CDPClient.connect(
            cdp_url="wss://browserbase",
            preloaded_extension=True,
        )
    )
    await asyncio.wait_for(discovery_started.wait(), timeout=1)
    await asyncio.sleep(0.01)
    connecting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(connecting, timeout=1)
    assert socket.closed is True


class TestNegotiateRuntime:
    """Mirrors the TypeScript negotiation tests so the two SDKs cannot drift apart.

    The absence of these is why a marker-shape change shipped with the Python client still
    exact-matching the removed `name`/`version` keys: pytest only covered the happy path, and
    its fixture encoded the old shape, so it agreed with the stale code.
    """

    def test_accepts_a_current_marker(self) -> None:
        compatible, detail = cdp_client._negotiate_runtime({
            "protocolVersion": STAGEHAND_PROTOCOL_VERSION,
            "serverInfo": {"name": "stagehand", "version": "4.0.0"},
        })
        assert compatible is True
        assert f"protocolVersion={STAGEHAND_PROTOCOL_VERSION}" in detail

    def test_tolerates_unknown_extra_keys(self) -> None:
        # A newer runtime may publish fields this client has never heard of, e.g. `status`.
        compatible, _ = cdp_client._negotiate_runtime({
            "protocolVersion": STAGEHAND_PROTOCOL_VERSION,
            "serverInfo": {"name": "stagehand", "version": "4.0.0"},
            "status": {"state": "ready"},
        })
        assert compatible is True

    @pytest.mark.parametrize(
        ("marker", "expected"),
        [
            (None, "no Stagehand runtime marker"),
            ({}, "serverInfo.name=None"),
            (
                {
                    "protocolVersion": STAGEHAND_PROTOCOL_VERSION - 1,
                    "serverInfo": {"name": "stagehand", "version": "0"},
                },
                "below",
            ),
            (
                {
                    "protocolVersion": STAGEHAND_PROTOCOL_VERSION + 1,
                    "serverInfo": {"name": "stagehand", "version": "2"},
                },
                "above",
            ),
            (
                {
                    "protocolVersion": STAGEHAND_PROTOCOL_VERSION,
                    "serverInfo": {"name": "other", "version": "1"},
                },
                "name=",
            ),
            (
                {
                    "protocolVersion": str(STAGEHAND_PROTOCOL_VERSION),
                    "serverInfo": {"name": "stagehand", "version": "1"},
                },
                repr(str(STAGEHAND_PROTOCOL_VERSION)),
            ),
        ],
    )
    def test_rejects_unusable_markers(self, marker: object, expected: str) -> None:
        compatible, detail = cdp_client._negotiate_runtime(marker)
        assert compatible is False
        assert expected in detail

    def test_never_raises_on_hostile_input(self) -> None:
        for marker in ("string", 42, [], {"serverInfo": "not-a-mapping"}, {"serverInfo": None}):
            assert cdp_client._negotiate_runtime(marker)[0] is False
