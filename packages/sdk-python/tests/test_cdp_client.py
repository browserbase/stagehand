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
    StagehandRuntimeIncompatibleError,
)


def _bump_major(version: str) -> str:
    """A protocol version one major ahead of the client's: incompatible by definition."""
    major, rest = version.split(".", 1)
    return f"{int(major) + 1}.{rest}"


INCOMPATIBLE_PROTOCOL_VERSION = _bump_major(STAGEHAND_PROTOCOL_VERSION)


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


def _incompatible_marker() -> dict[str, object]:
    """A ready worker speaking a protocol major this client cannot use."""
    return {
        "marker": {
            "protocolVersion": INCOMPATIBLE_PROTOCOL_VERSION,
            "serverInfo": {"name": "stagehand", "version": "9.0.0"},
            "state": "ready",
        },
        "hasReceiver": True,
    }


def _unknown_marker() -> dict[str, object]:
    """A worker that has not published its runtime marker yet."""
    return {"marker": None, "hasReceiver": False}


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


async def test_preloaded_discovery_keeps_sweeping_when_compatible_worker_lacks_receiver(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A compatible worker without its receiver yet outranks an incompatible sibling.

    Sweep 1 sees [compatible-but-no-receiver, incompatible]; sweep 2 sees the compatible worker
    ready. The incompatible sibling must not fail the connection fast.
    """
    get_targets_calls = 0
    sleeps: list[float] = []

    async def record_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    def response_for(message: dict[str, object]) -> dict[str, object]:
        nonlocal get_targets_calls
        method = message["method"]
        if method == "Target.getTargets":
            get_targets_calls += 1
            return {
                "result": {
                    "targetInfos": [
                        {
                            "targetId": name,
                            "type": "service_worker",
                            "title": name,
                            "url": f"chrome-extension://{name}/service-worker.js",
                        }
                        for name in ("pending", "stale")
                    ]
                }
            }
        if method == "Target.attachToTarget":
            target_id = cast(dict[str, object], message["params"])["targetId"]
            return {"result": {"sessionId": f"{target_id}-session"}}
        if method == "Runtime.evaluate":
            if message.get("sessionId") == "stale-session":
                return {"result": {"result": {"value": _incompatible_marker()}}}
            ready = _ready_marker()
            if get_targets_calls == 1:
                ready["hasReceiver"] = False
            return {"result": {"result": {"value": ready}}}
        return {"result": {}}

    socket = FakeWebSocket(response_for)

    async def resolve(_: str) -> str:
        return "ws://127.0.0.1/devtools/browser/test"

    async def connect(_: str) -> FakeWebSocket:
        return socket

    monkeypatch.setattr(cdp_client, "_resolve_browser_web_socket_url", resolve)
    monkeypatch.setattr(cdp_client, "_connect_web_socket", connect)
    monkeypatch.setattr(cdp_client.asyncio, "sleep", record_sleep)
    client = await CDPClient.connect(
        cdp_url="wss://browserbase",
        preloaded_extension=True,
    )
    try:
        assert client.service_worker.target_id == "pending"
        assert get_targets_calls == 2
        assert sleeps == [0.1]
        detached = [
            cast(dict[str, object], message["params"])["sessionId"]
            for message in socket.sent
            if message["method"] == "Target.detachFromTarget"
        ]
        # Sweep 1 detaches both probed workers; sweep 2 returns on the ready worker first.
        assert detached == ["pending-session", "stale-session"]
    finally:
        await client.close()


async def test_preloaded_discovery_fails_fast_on_a_foreign_runtime_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A worker naming a foreign runtime is incompatible: detach it and raise on the first sweep.

    Before fail-fast this test expected discovery to keep polling and accept a later ready worker.
    """
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
    with pytest.raises(StagehandRuntimeIncompatibleError) as raised:
        await CDPClient.connect(
            cdp_url="wss://browserbase",
            preloaded_extension=True,
        )
    assert raised.value.reason == "runtime-name-mismatch"
    assert raised.value.extension_server_info == {"name": "foreign-extension", "version": "1.0.0"}
    assert get_targets_calls == 1
    detach = [message for message in socket.sent if message["method"] == "Target.detachFromTarget"]
    assert cast(dict[str, object], detach[0]["params"])["sessionId"] == "foreign-session"
    assert socket.closed is True


async def test_preloaded_discovery_fails_fast_on_an_incompatible_protocol_major(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sleeps: list[float] = []

    async def record_sleep(seconds: float) -> None:
        sleeps.append(seconds)

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
            return {"result": {"result": {"value": _incompatible_marker()}}}
        return {"result": {}}

    socket = FakeWebSocket(response_for)

    async def resolve(_: str) -> str:
        return "ws://127.0.0.1/devtools/browser/test"

    async def connect(_: str) -> FakeWebSocket:
        return socket

    monkeypatch.setattr(cdp_client, "_resolve_browser_web_socket_url", resolve)
    monkeypatch.setattr(cdp_client, "_connect_web_socket", connect)
    monkeypatch.setattr(cdp_client.asyncio, "sleep", record_sleep)
    with pytest.raises(StagehandRuntimeIncompatibleError) as raised:
        await CDPClient.connect(
            cdp_url="wss://browserbase",
            preloaded_extension=True,
        )
    assert raised.value.reason == "protocol-major-mismatch"
    assert raised.value.extension_protocol_version == INCOMPATIBLE_PROTOCOL_VERSION
    assert sleeps == [], "the incompatible marker must raise before any second poll"
    evaluates = [message for message in socket.sent if message["method"] == "Runtime.evaluate"]
    assert len(evaluates) == 1


async def test_preloaded_discovery_keeps_polling_when_fallback_install_is_allowed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    evaluate_calls = 0

    def response_for(message: dict[str, object]) -> dict[str, object]:
        nonlocal evaluate_calls
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
            evaluate_calls += 1
            value = _incompatible_marker() if evaluate_calls < 3 else _ready_marker()
            return {"result": {"result": {"value": value}}}
        return {"result": {}}

    socket = FakeWebSocket(response_for)
    client = CDPClient(socket, "ws://127.0.0.1/devtools/browser/test")
    try:
        worker, session_id = await asyncio.wait_for(
            client._wait_for_preloaded_service_worker(
                "service-worker.js", allow_fallback_install=True
            ),
            timeout=5,
        )
        assert worker.target_id == "worker-target"
        assert session_id == "worker-session"
        assert evaluate_calls == 3
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


def _receiver_client(
    values: list[dict[str, object] | None],
) -> tuple[CDPClient, FakeWebSocket, list[dict[str, object]]]:
    """A client whose Runtime.evaluate replies walk `values`; None yields exceptionDetails."""
    evaluates: list[dict[str, object]] = []

    def response_for(message: dict[str, object]) -> dict[str, object]:
        if message["method"] != "Runtime.evaluate":
            return {"result": {}}
        evaluates.append(message)
        value = values[min(len(evaluates), len(values)) - 1]
        if value is None:
            return {"result": {"exceptionDetails": {"text": "not ready"}}}
        return {"result": {"result": {"value": value}}}

    socket = FakeWebSocket(response_for)
    return CDPClient(socket, "ws://127.0.0.1/devtools/browser/test"), socket, evaluates


async def test_runtime_receiver_fails_fast_on_the_first_incompatible_poll(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sleeps: list[float] = []

    async def record_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(cdp_client.asyncio, "sleep", record_sleep)
    client, _, evaluates = _receiver_client([_incompatible_marker()])
    try:
        with pytest.raises(StagehandRuntimeIncompatibleError) as raised:
            await client._wait_for_runtime_receiver("worker-session")
    finally:
        await client.close()

    error = raised.value
    assert error.reason == "protocol-major-mismatch"
    assert error.client_protocol_version == STAGEHAND_PROTOCOL_VERSION
    assert error.extension_protocol_version == INCOMPATIBLE_PROTOCOL_VERSION
    assert error.extension_server_info == {"name": "stagehand", "version": "9.0.0"}
    assert error.remediation == cdp_client.RUNTIME_INCOMPATIBILITY_REMEDIATION
    message = str(error)
    assert message.startswith("Incompatible Stagehand runtime (protocol-major-mismatch): ")
    assert f"client protocol {STAGEHAND_PROTOCOL_VERSION}" in message
    assert f"extension protocol {INCOMPATIBLE_PROTOCOL_VERSION}" in message
    assert "extension stagehand/9.0.0" in message
    assert message.endswith(cdp_client.RUNTIME_INCOMPATIBILITY_REMEDIATION)
    assert len(evaluates) == 1
    assert sleeps == [], "the incompatible marker must raise before any second poll"


async def test_runtime_receiver_fails_fast_on_a_wrong_runtime_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def no_sleep(_: float) -> None:
        raise AssertionError("must not poll again after an incompatible marker")

    monkeypatch.setattr(cdp_client.asyncio, "sleep", no_sleep)
    foreign = _ready_marker()
    foreign["marker"] = {
        "protocolVersion": STAGEHAND_PROTOCOL_VERSION,
        "serverInfo": {"name": "other-runtime", "version": "3.1.4"},
    }
    client, _, evaluates = _receiver_client([foreign])
    try:
        with pytest.raises(StagehandRuntimeIncompatibleError) as raised:
            await client._wait_for_runtime_receiver("worker-session")
    finally:
        await client.close()
    assert raised.value.reason == "runtime-name-mismatch"
    assert raised.value.extension_server_info == {"name": "other-runtime", "version": "3.1.4"}
    assert len(evaluates) == 1


async def test_runtime_receiver_keeps_polling_through_unknown_markers_until_compatible(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sleeps: list[float] = []

    async def record_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(cdp_client.asyncio, "sleep", record_sleep)
    client, _, evaluates = _receiver_client([
        None,  # Runtime.evaluate exceptionDetails: the worker is still booting
        _unknown_marker(),
        _unknown_marker(),
        _ready_marker(),
    ])
    try:
        await asyncio.wait_for(client._wait_for_runtime_receiver("worker-session"), timeout=5)
    finally:
        await client.close()
    assert len(evaluates) == 4
    assert sleeps == [0.1, 0.1, 0.1]


async def test_runtime_receiver_keeps_polling_on_incompatible_when_fallback_install_is_allowed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def no_sleep(_: float) -> None:
        return None

    monkeypatch.setattr(cdp_client.asyncio, "sleep", no_sleep)
    client, _, evaluates = _receiver_client([
        _incompatible_marker(),
        _incompatible_marker(),
        _ready_marker(),
    ])
    try:
        await asyncio.wait_for(
            client._wait_for_runtime_receiver("worker-session", allow_fallback_install=True),
            timeout=5,
        )
    finally:
        await client.close()
    assert len(evaluates) == 3


def test_runtime_incompatible_error_is_exported_from_the_package() -> None:
    import stagehand

    assert stagehand.StagehandRuntimeIncompatibleError is StagehandRuntimeIncompatibleError
    assert "StagehandRuntimeIncompatibleError" in stagehand.__all__


class TestNegotiateRuntime:
    """Mirrors the TypeScript negotiation tests so the two SDKs cannot drift apart.

    The absence of these is why a marker-shape change shipped with the Python client still
    exact-matching the removed `name`/`version` keys: pytest only covered the happy path, and
    its fixture encoded the old shape, so it agreed with the stale code.
    """

    def test_accepts_a_current_marker(self) -> None:
        result = cdp_client._negotiate_runtime({
            "protocolVersion": STAGEHAND_PROTOCOL_VERSION,
            "serverInfo": {"name": "stagehand", "version": "1.0.0"},
        })
        assert result.kind == "compatible"
        assert result.compatible is True
        assert f"protocolVersion={STAGEHAND_PROTOCOL_VERSION}" in result.detail

    def test_tolerates_unknown_extra_keys(self) -> None:
        # A newer runtime may publish fields this client has never heard of, e.g. `status`.
        result = cdp_client._negotiate_runtime({
            "protocolVersion": STAGEHAND_PROTOCOL_VERSION,
            "serverInfo": {"name": "stagehand", "version": "1.0.0"},
            "status": {"state": "ready"},
        })
        assert result.kind == "compatible"

    @pytest.mark.parametrize(
        ("marker", "expected"),
        [
            (None, "no Stagehand runtime marker"),
            ({}, "serverInfo.name=None"),
            (
                {
                    "protocolVersion": 1,
                    "serverInfo": {"name": "stagehand", "version": "1"},
                },
                "protocolVersion=1",
            ),
            ("string", "no Stagehand runtime marker"),
            ({"serverInfo": "not-a-mapping"}, "unreadable"),
            ({"protocolVersion": STAGEHAND_PROTOCOL_VERSION, "serverInfo": None}, "unreadable"),
            (
                {
                    "protocolVersion": STAGEHAND_PROTOCOL_VERSION,
                    "serverInfo": {"name": "stagehand"},
                },
                "serverInfo.version=None",
            ),
            (
                {
                    "protocolVersion": STAGEHAND_PROTOCOL_VERSION,
                    "serverInfo": {"name": "stagehand", "version": 1},
                },
                "serverInfo.version=1",
            ),
            (
                {
                    "protocolVersion": STAGEHAND_PROTOCOL_VERSION,
                    "serverInfo": {"name": "stagehand", "version": ""},
                },
                "serverInfo.version=''",
            ),
            (
                {
                    "protocolVersion": STAGEHAND_PROTOCOL_VERSION,
                    "serverInfo": {"name": "", "version": "1.0.0"},
                },
                "serverInfo.name=''",
            ),
            (
                {
                    "protocolVersion": STAGEHAND_PROTOCOL_VERSION,
                    "serverInfo": {"name": 1, "version": "1.0.0"},
                },
                "serverInfo.name=1",
            ),
            (
                {"protocolVersion": "", "serverInfo": {"name": "stagehand", "version": "1"}},
                "protocolVersion=''",
            ),
        ],
    )
    def test_unreadable_markers_are_unknown_not_incompatible(
        self, marker: object, expected: str
    ) -> None:
        """Absent or unparseable markers mean "not ready yet": the wait loops keep polling."""
        result = cdp_client._negotiate_runtime(marker)
        assert result.kind == "unknown"
        assert result.compatible is False
        assert result.reason is None
        assert expected in result.detail

    @pytest.mark.parametrize(
        ("marker", "reason", "expected"),
        [
            (
                {
                    "protocolVersion": INCOMPATIBLE_PROTOCOL_VERSION,
                    "serverInfo": {"name": "stagehand", "version": "0"},
                },
                "protocol-major-mismatch",
                "Protocol major mismatch: "
                f"client {STAGEHAND_PROTOCOL_VERSION}, server {INCOMPATIBLE_PROTOCOL_VERSION}",
            ),
            (
                {
                    "protocolVersion": "not-semver",
                    "serverInfo": {"name": "stagehand", "version": "2"},
                },
                "protocol-invalid-version",
                f"Invalid protocol version: client {STAGEHAND_PROTOCOL_VERSION}, server not-semver",
            ),
            (
                {
                    "protocolVersion": STAGEHAND_PROTOCOL_VERSION,
                    "serverInfo": {"name": "other", "version": "1"},
                },
                "runtime-name-mismatch",
                'Runtime name mismatch: expected "stagehand", server reported "other"',
            ),
            (
                {
                    "protocolVersion": f"{STAGEHAND_PROTOCOL_VERSION}-beta.1",
                    "serverInfo": {"name": "stagehand", "version": "1"},
                },
                "protocol-prerelease-mismatch",
                "Protocol prereleases must match exactly: "
                f"client {STAGEHAND_PROTOCOL_VERSION}, server {STAGEHAND_PROTOCOL_VERSION}-beta.1",
            ),
        ],
    )
    def test_rejected_markers_are_incompatible(
        self, marker: dict[str, object], reason: str, expected: str
    ) -> None:
        """Markers that parse but fail negotiation are incompatible: the wait loops fail fast."""
        result = cdp_client._negotiate_runtime(marker)
        assert result.kind == "incompatible"
        assert result.compatible is False
        assert result.reason == reason
        # Exact match: the wording is shared verbatim with the TypeScript SDK.
        assert result.detail == expected
        assert result.protocol_version == marker["protocolVersion"]
        server_info = cast(dict[str, object], marker["serverInfo"])
        assert result.server_name == server_info["name"]
        assert result.server_version == server_info["version"]
        error = StagehandRuntimeIncompatibleError(result)
        assert error.reason == reason
        assert error.detail == expected
        assert error.client_protocol_version == STAGEHAND_PROTOCOL_VERSION

    def test_never_raises_on_hostile_input(self) -> None:
        for marker in (
            "string",
            42,
            [],
            {"serverInfo": "not-a-mapping"},
            {"serverInfo": None},
            {"protocolVersion": "1.0.0", "serverInfo": {"name": "", "version": ""}},
            {"protocolVersion": "1.0.0", "serverInfo": {"name": "stagehand"}},
        ):
            assert cdp_client._negotiate_runtime(marker).kind == "unknown"

    def test_incompatible_error_rejects_non_incompatible_results(self) -> None:
        with pytest.raises(ValueError):
            StagehandRuntimeIncompatibleError(
                cdp_client.RuntimeCompatibility(kind="unknown", detail="no marker")
            )

    def test_protocol_semver_directionality(self) -> None:
        assert cdp_client._protocol_compatibility("1.2.4", "1.2.0") is None
        assert cdp_client._protocol_compatibility("1.2.4", "1.9.0") is None
        assert cdp_client._protocol_compatibility("1.2.4", "1.1.99") == (
            "protocol-server-too-old",
            "Server protocol 1.1.99 is older than client requirement 1.2.4",
        )
        assert cdp_client._protocol_compatibility("1.2.4", "2.0.0") == (
            "protocol-major-mismatch",
            "Protocol major mismatch: client 1.2.4, server 2.0.0",
        )
        assert cdp_client._protocol_compatibility("1.3.0-beta.1", "1.3.0-beta.1") is None
        assert cdp_client._protocol_compatibility("1.3.0-beta.1", "1.3.0-beta.2") == (
            "protocol-prerelease-mismatch",
            "Protocol prereleases must match exactly: client 1.3.0-beta.1, server 1.3.0-beta.2",
        )
        assert cdp_client._protocol_compatibility("1.3.0", "not-semver") == (
            "protocol-invalid-version",
            "Invalid protocol version: client 1.3.0, server not-semver",
        )
        assert cdp_client._protocol_compatibility("1.2.4", "nope") == (
            "protocol-invalid-version",
            "Invalid protocol version: client 1.2.4, server nope",
        )
