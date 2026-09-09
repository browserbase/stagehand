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
        if method == "Extensions.getExtensions":
            return {
                "result": {
                    "extensions": [
                        _installed_extension("other", name="Other Extension"),
                        _installed_extension("preloaded"),
                    ]
                }
            }
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
        assert [message["method"] for message in socket.sent] == [
            "Extensions.getExtensions",
            "Target.getTargets",
            "Target.attachToTarget",
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
        return await client._discover_installed_stagehand_extension_id()
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
            await client._discover_installed_stagehand_extension_id()
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
                'Connected runtime is not Stagehand: serverInfo.name="other"',
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
