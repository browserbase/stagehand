from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Mapping
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Protocol, cast
from urllib.request import urlopen

STAGEHAND_SEND_TO_HOST_BINDING = "__stagehandSendToHost"
_RUNTIME_NAME = "stagehand"
_RUNTIME_VERSION = "stagehand.v4"


class _WebSocket(Protocol):
    async def send(self, message: str) -> None: ...

    async def recv(self) -> str | bytes: ...

    async def close(self) -> None: ...


@dataclass(frozen=True)
class ServiceWorkerInfo:
    target_id: str
    url: str
    title: str
    extension_id: str | None = None


class _CDPCommandError(RuntimeError):
    def __init__(self, method: str, error: Mapping[str, object]) -> None:
        self.method = method
        self.code = error.get("code")
        self.data = error.get("data")
        super().__init__(f"CDP command failed: {method}: {error.get('message', 'Unknown error')}")


class CDPConnectionClosedError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("CDP connection closed")


class CDPClient:
    def __init__(
        self,
        socket: _WebSocket,
        web_socket_debugger_url: str,
        command_timeout_ms: int,
    ) -> None:
        if command_timeout_ms <= 0:
            raise ValueError("command_timeout_ms must be positive")

        self.web_socket_debugger_url = web_socket_debugger_url
        self._socket = socket
        self._command_timeout_seconds = command_timeout_ms / 1_000
        self._next_id = 1
        self._pending: dict[int, tuple[str, asyncio.Future[object]]] = {}
        self._incoming: asyncio.Queue[object] = asyncio.Queue()
        self._session_id: str | None = None
        self._service_worker: ServiceWorkerInfo | None = None
        self._closed = False
        self._reader = asyncio.create_task(self._read(), name="stagehand-cdp-reader")

    @classmethod
    async def connect(
        cls,
        *,
        cdp_url: str,
        extension_dir: str | None = None,
        extension_id: str | None = None,
        service_worker_url_includes: str | None = None,
        discovery_timeout_ms: int = 10_000,
        command_timeout_ms: int = 10_000,
        cdp_connect_timeout_ms: int = 10_000,
    ) -> CDPClient:
        if bool(extension_dir) == bool(extension_id):
            raise ValueError("Exactly one of extension_dir or extension_id is required")

        web_socket_debugger_url = await _resolve_browser_web_socket_url(
            cdp_url,
            cdp_connect_timeout_ms,
        )
        socket = await _connect_web_socket(web_socket_debugger_url, cdp_connect_timeout_ms)
        client = cls(socket, web_socket_debugger_url, command_timeout_ms)

        try:
            resolved_extension_id = extension_id
            if extension_dir is not None:
                resolved_extension_id = await client._load_unpacked_extension(extension_dir)

            worker = await client._wait_for_service_worker(
                resolved_extension_id,
                service_worker_url_includes or "service-worker.js",
                discovery_timeout_ms,
            )
            attached = await client.send_command(
                "Target.attachToTarget",
                {"targetId": worker.target_id, "flatten": True},
            )
            session_id = _required_string(attached, "sessionId", "Target.attachToTarget")
            client._session_id = session_id
            client._service_worker = ServiceWorkerInfo(
                target_id=worker.target_id,
                title=worker.title,
                url=worker.url,
                extension_id=resolved_extension_id,
            )

            with suppress(Exception):
                await client.send_command("Runtime.enable", {}, session_id=session_id)
            await client.send_command(
                "Runtime.addBinding",
                {"name": STAGEHAND_SEND_TO_HOST_BINDING},
                session_id=session_id,
            )
            await client._wait_for_runtime_ready(session_id, discovery_timeout_ms)
            return client
        except BaseException:
            await client.close()
            raise

    @property
    def service_worker(self) -> ServiceWorkerInfo:
        if self._service_worker is None:
            raise RuntimeError("Stagehand service worker is not attached")
        return self._service_worker

    async def send(self, message: dict[str, object]) -> None:
        if self._closed:
            raise RuntimeError("CDP client is closed")
        if self._session_id is None:
            raise RuntimeError("Stagehand service worker is not attached")

        serialized = json.dumps(message, separators=(",", ":"))
        evaluated = await self.send_command(
            "Runtime.evaluate",
            {
                "expression": (
                    f"void globalThis.__stagehandReceiveFromHost({json.dumps(serialized)}); true"
                ),
                "awaitPromise": False,
                "returnByValue": True,
            },
            session_id=self._session_id,
        )
        exception_details = evaluated.get("exceptionDetails")
        if isinstance(exception_details, Mapping):
            exception = exception_details.get("exception")
            description = exception.get("description") if isinstance(exception, Mapping) else None
            raise RuntimeError(
                str(
                    description
                    or exception_details.get("text")
                    or "Stagehand service worker rejected an RPC message"
                )
            )

    async def receive(self) -> object:
        message = await self._incoming.get()
        if isinstance(message, BaseException):
            raise message
        return message

    async def send_command(
        self,
        method: str,
        params: Mapping[str, object] | None = None,
        *,
        session_id: str | None = None,
        timeout_ms: int | None = None,
    ) -> dict[str, object]:
        if self._closed:
            raise RuntimeError("CDP client is closed")

        timeout_seconds = (
            self._command_timeout_seconds if timeout_ms is None else timeout_ms / 1_000
        )
        if timeout_seconds <= 0:
            raise ValueError("timeout_ms must be positive")

        command_id = self._next_id
        self._next_id += 1
        response: asyncio.Future[object] = asyncio.get_running_loop().create_future()
        self._pending[command_id] = (method, response)
        message: dict[str, object] = {
            "id": command_id,
            "method": method,
            "params": dict(params or {}),
        }
        if session_id is not None:
            message["sessionId"] = session_id

        try:
            await self._socket.send(json.dumps(message, separators=(",", ":")))
            result = await asyncio.wait_for(asyncio.shield(response), timeout_seconds)
        except TimeoutError as error:
            if not response.done():
                response.cancel()
            raise TimeoutError(f"CDP command timed out: {method}") from error
        except BaseException:
            if not response.done():
                response.cancel()
            raise
        finally:
            self._pending.pop(command_id, None)

        if result is None:
            return {}
        if not isinstance(result, dict):
            raise RuntimeError(f"CDP command returned an invalid result: {method}")
        return cast(dict[str, object], result)

    async def close(self) -> None:
        if self._closed:
            return

        self._closed = True
        reason = RuntimeError("CDP client closed")
        self._reject_pending(reason)
        self._incoming.put_nowait(reason)
        current_task = asyncio.current_task()
        if self._reader is not current_task:
            self._reader.cancel()
            with suppress(asyncio.CancelledError):
                await self._reader
        await self._socket.close()

    async def _read(self) -> None:
        try:
            while not self._closed:
                try:
                    message = await self._socket.recv()
                except Exception as error:
                    raise CDPConnectionClosedError() from error
                await self._handle_message(message)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            if self._closed:
                return
            self._closed = True
            self._reject_pending(error)
            self._incoming.put_nowait(error)
            await self._socket.close()

    async def _handle_message(self, data: str | bytes) -> None:
        if isinstance(data, bytes):
            data = data.decode()
        raw = json.loads(data)
        if not isinstance(raw, dict):
            raise RuntimeError("Invalid CDP message")
        message = cast(dict[str, object], raw)

        command_id = message.get("id")
        if isinstance(command_id, int) and not isinstance(command_id, bool):
            self._handle_response(command_id, message)
            return

        if (
            message.get("method") != "Runtime.bindingCalled"
            or message.get("sessionId") != self._session_id
        ):
            return
        params = message.get("params")
        if not isinstance(params, dict) or params.get("name") != STAGEHAND_SEND_TO_HOST_BINDING:
            return
        payload = params.get("payload")
        execution_context_id = params.get("executionContextId")
        if (
            not isinstance(payload, str)
            or not isinstance(execution_context_id, int)
            or isinstance(execution_context_id, bool)
        ):
            return
        self._incoming.put_nowait(payload)

    def _handle_response(self, command_id: int, message: Mapping[str, object]) -> None:
        pending = self._pending.pop(command_id, None)
        if pending is None:
            return
        method, future = pending
        if future.done():
            return
        error = message.get("error")
        if isinstance(error, Mapping):
            future.set_exception(_CDPCommandError(method, cast(Mapping[str, object], error)))
        else:
            future.set_result(message.get("result"))

    def _reject_pending(self, error: BaseException) -> None:
        for _, future in self._pending.values():
            if not future.done():
                future.set_exception(error)
        self._pending.clear()

    async def _load_unpacked_extension(self, extension_dir: str) -> str:
        try:
            loaded = await self.send_command(
                "Extensions.loadUnpacked",
                {"path": extension_dir},
            )
        except _CDPCommandError as error:
            if error.code == -32601 or "method not found" in str(error).lower():
                raise RuntimeError(
                    "This Chrome build does not support Extensions.loadUnpacked. "
                    "Launch with --load-extension and connect using extension_id instead."
                ) from error
            raise
        return _required_string(loaded, "id", "Extensions.loadUnpacked")

    async def _wait_for_service_worker(
        self,
        extension_id: str | None,
        url_includes: str,
        timeout_ms: int,
    ) -> ServiceWorkerInfo:
        started = time.monotonic()
        activation_target_id: str | None = None
        last_targets: list[object] = []

        while (time.monotonic() - started) * 1_000 < timeout_ms:
            response = await self.send_command("Target.getTargets")
            targets = response.get("targetInfos")
            last_targets = cast(list[object], targets) if isinstance(targets, list) else []
            for target in last_targets:
                if not isinstance(target, dict):
                    continue
                target_info = cast(dict[str, object], target)
                url = target_info.get("url")
                if (
                    target_info.get("type") == "service_worker"
                    and isinstance(url, str)
                    and url.startswith("chrome-extension://")
                    and (
                        extension_id is None
                        or url.startswith(f"chrome-extension://{extension_id}/")
                    )
                    and url_includes in url
                ):
                    if activation_target_id is not None:
                        with suppress(Exception):
                            await self.send_command(
                                "Target.closeTarget",
                                {"targetId": activation_target_id},
                            )
                    return ServiceWorkerInfo(
                        target_id=_required_string(target_info, "targetId", "Target.getTargets"),
                        title=_required_string(target_info, "title", "Target.getTargets"),
                        url=url,
                        extension_id=extension_id,
                    )

            if (
                extension_id is not None
                and activation_target_id is None
                and (time.monotonic() - started) >= 1
            ):
                with suppress(Exception):
                    activation = await self.send_command(
                        "Target.createTarget",
                        {"url": f"chrome-extension://{extension_id}/wake-service-worker.html"},
                    )
                    target_id = activation.get("targetId")
                    activation_target_id = target_id if isinstance(target_id, str) else None
            await asyncio.sleep(0.1)

        if activation_target_id is not None:
            with suppress(Exception):
                await self.send_command("Target.closeTarget", {"targetId": activation_target_id})
        observed = ", ".join(
            f"{target.get('type')}:{target.get('url')}"
            for target in last_targets
            if isinstance(target, dict)
        )
        raise TimeoutError(
            "Timed out discovering the Stagehand service worker target. "
            f"Observed targets: {observed}"
        )

    async def _wait_for_runtime_ready(self, session_id: str, timeout_ms: int) -> None:
        started = time.monotonic()
        last_error = ""
        expression = f"""(() => {{
          const runtime = globalThis.__stagehand_runtime;
          const hasStagehandReceiveFromHost =
            typeof globalThis.__stagehandReceiveFromHost === "function";
          return {{
            ok: runtime?.name === {json.dumps(_RUNTIME_NAME)} &&
              runtime?.version === {json.dumps(_RUNTIME_VERSION)} &&
              hasStagehandReceiveFromHost,
            runtimeName: runtime?.name,
            runtimeVersion: runtime?.version,
            hasStagehandReceiveFromHost,
          }};
        }})()"""

        while (time.monotonic() - started) * 1_000 < timeout_ms:
            try:
                evaluated = await self.send_command(
                    "Runtime.evaluate",
                    {"expression": expression, "returnByValue": True},
                    session_id=session_id,
                )
                exception = evaluated.get("exceptionDetails")
                if isinstance(exception, Mapping):
                    nested = exception.get("exception")
                    description = nested.get("description") if isinstance(nested, Mapping) else None
                    last_error = str(
                        description or exception.get("text") or "readiness evaluation threw"
                    )
                else:
                    result = evaluated.get("result")
                    value = result.get("value") if isinstance(result, Mapping) else None
                    if isinstance(value, Mapping) and value.get("ok") is True:
                        return
                    if isinstance(value, Mapping):
                        last_error = (
                            f"runtime={value.get('runtimeName')}/{value.get('runtimeVersion')}, "
                            "__stagehandReceiveFromHost="
                            f"{value.get('hasStagehandReceiveFromHost')}"
                        )
            except Exception as error:
                last_error = str(error)
            await asyncio.sleep(0.1)

        detail = f" ({last_error})" if last_error else ""
        raise TimeoutError(
            f"Timed out waiting for the Stagehand extension runtime to become ready{detail}"
        )


async def _connect_web_socket(url: str, timeout_ms: int) -> _WebSocket:
    from websockets.asyncio.client import connect

    return cast(
        _WebSocket,
        await connect(url, open_timeout=timeout_ms / 1_000, max_size=None),
    )


async def _resolve_browser_web_socket_url(cdp_url: str, timeout_ms: int) -> str:
    if cdp_url.startswith(("ws://", "wss://")):
        return cdp_url

    base_url = cdp_url.rstrip("/")
    deadline = time.monotonic() + timeout_ms / 1_000
    last_error = ""
    while time.monotonic() <= deadline:
        try:
            version = await asyncio.to_thread(_read_json, f"{base_url}/json/version")
            debugger_url = version.get("webSocketDebuggerUrl")
            if isinstance(debugger_url, str) and debugger_url:
                return debugger_url
            last_error = "CDP version endpoint did not include webSocketDebuggerUrl"
        except Exception as error:
            last_error = str(error)
        await asyncio.sleep(0.25)
    detail = f" (last error: {last_error})" if last_error else ""
    raise TimeoutError(f"Timed out resolving CDP WebSocket URL from {base_url}{detail}")


def _read_json(url: str) -> dict[str, object]:
    with urlopen(url, timeout=2) as response:  # noqa: S310 -- The user selects the CDP URL.
        value: Any = json.load(response)
    if not isinstance(value, dict):
        raise RuntimeError("CDP version endpoint returned invalid JSON")
    return cast(dict[str, object], value)


def _required_string(value: Mapping[str, object], key: str, method: str) -> str:
    result = value.get(key)
    if not isinstance(result, str) or not result:
        raise RuntimeError(f"{method} did not return {key}")
    return result
