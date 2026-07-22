import asyncio
import json
from collections.abc import Callable
from typing import cast

import pytest

from stagehand import cdp_client
from stagehand.cdp_client import (
    STAGEHAND_SEND_TO_HOST_BINDING,
    CDPClient,
    ServiceWorkerInfo,
)


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
            return {"result": {"result": {"value": {"ok": True}}}}
        return {"result": {}}

    socket = FakeWebSocket(response_for)

    async def resolve(_: str, __: int) -> str:
        return "ws://127.0.0.1/devtools/browser/test"

    async def connect(_: str, __: int) -> FakeWebSocket:
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
            return {"result": {"result": {"value": {"ok": True}}}}
        return {"result": {}}

    socket = FakeWebSocket(response_for)

    async def resolve(_: str, __: int) -> str:
        return "ws://127.0.0.1/devtools/browser/test"

    async def connect(_: str, __: int) -> FakeWebSocket:
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
    client = CDPClient(socket, "ws://127.0.0.1/devtools/browser/test", 1_000)
    client._session_id = "worker-session"

    try:
        await client.send({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "ping",
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
async def test_commands_time_out_and_are_removed() -> None:
    socket = FakeWebSocket(lambda _: None)
    client = CDPClient(socket, "ws://127.0.0.1/devtools/browser/test", 5)

    try:
        with pytest.raises(TimeoutError, match="CDP command timed out: Target.getTargets"):
            await client.send_command("Target.getTargets")
        assert client._pending == {}
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_connect_explains_when_chrome_cannot_load_an_extension(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    socket = FakeWebSocket(lambda _: {"error": {"code": -32601, "message": "Method not found"}})

    async def resolve(_: str, __: int) -> str:
        return "ws://127.0.0.1/devtools/browser/test"

    async def connect(_: str, __: int) -> FakeWebSocket:
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
