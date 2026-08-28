from __future__ import annotations

import asyncio
import json
import re
import time
from collections.abc import Mapping
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Protocol, cast
from urllib.request import urlopen

from stagehand._generated.protocol_version import (
    PROTOCOL_SEMVER_PATTERN,
    STAGEHAND_PROTOCOL_VERSION,
)

STAGEHAND_SEND_TO_HOST_BINDING = "__stagehandSendToHost"
_RUNTIME_NAME = "stagehand"
_STAGEHAND_EXTENSION_NAME = "Stagehand Runtime"
_PROTOCOL_SEMVER_PATTERN = re.compile(PROTOCOL_SEMVER_PATTERN)

# Constant on purpose: the TypeScript SDK evaluates the identical expression, so the two cannot
# drift. All judgement happens here rather than in the page.
_RUNTIME_READINESS_EXPRESSION = """(() => ({
  marker: globalThis.__stagehand_runtime ?? null,
  hasReceiver: typeof globalThis.__stagehandReceiveFromHost === "function",
}))()"""


def _callback_batch_expression(
    *,
    message: dict[str, object],
    source: str,
) -> str:
    if not isinstance(source, str) or not source.strip():
        raise TypeError("stagehand.experimental_batch() source must be JavaScript")
    serialized_message = json.dumps(
        json.dumps(message, allow_nan=False, separators=(",", ":")),
        separators=(",", ":"),
    )
    return (
        "(() => { const __name = (fn, name) => { try { "
        "Object.defineProperty(fn, 'name', { value: name, configurable: true }); "
        "} catch {} return fn; }; void globalThis.__stagehandReceiveFromHost("
        f"{serialized_message}, {{ callback: ({source}) }}); return true; }})()"
    )


def _callback_source_from_message(message: dict[str, object]) -> str | None:
    if message.get("method") != "stagehand.callback_batch":
        return None
    params = message.get("params")
    if not isinstance(params, Mapping):
        raise TypeError("Stagehand callback batch request is missing callback_source")
    source = params.get("callback_source")
    if not isinstance(source, str) or not source.strip():
        raise TypeError("Stagehand callback batch request is missing callback_source")
    return source


def _negotiate_runtime(marker: object) -> tuple[bool, str]:
    """Return (compatible, detail). Never raises: a malformed marker is just incompatible."""
    if not isinstance(marker, Mapping):
        return False, "no Stagehand runtime marker"

    server_info = marker.get("serverInfo")
    name = server_info.get("name") if isinstance(server_info, Mapping) else None
    if name != _RUNTIME_NAME:
        return False, f"serverInfo.name={name!r}"

    protocol_version = marker.get("protocolVersion")
    if not isinstance(protocol_version, str):
        return False, f"protocolVersion={protocol_version!r}"
    compatibility = _protocol_compatibility(STAGEHAND_PROTOCOL_VERSION, protocol_version)
    if compatibility is not None:
        return False, compatibility

    return True, f"protocolVersion={protocol_version}"


def _protocol_compatibility(client_version: str, server_version: str) -> str | None:
    client = _PROTOCOL_SEMVER_PATTERN.fullmatch(client_version)
    server = _PROTOCOL_SEMVER_PATTERN.fullmatch(server_version)
    if client is None or server is None:
        return f"invalid protocol version: client={client_version!r} server={server_version!r}"
    if client.group(4) is not None or server.group(4) is not None:
        if client_version != server_version:
            return (
                "protocol prereleases must match exactly: "
                f"client={client_version} server={server_version}"
            )
        return None
    if client.group(1) != server.group(1):
        return f"protocol major mismatch: client={client_version} server={server_version}"
    if int(server.group(2)) < int(client.group(2)):
        return f"server protocol {server_version} is older than client requirement {client_version}"
    return None


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


@dataclass(frozen=True)
class _InstalledExtension:
    id: str
    name: str
    version: str
    path: str
    enabled: bool


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
    ) -> None:
        self.web_socket_debugger_url = web_socket_debugger_url
        self._socket = socket
        self._next_id = 1
        self._pending: dict[int, tuple[str, asyncio.Future[object]]] = {}
        self._incoming: asyncio.Queue[object] = asyncio.Queue()
        self._session_id: str | None = None
        self._service_worker: ServiceWorkerInfo | None = None
        self._closed = False
        self._background_tasks: set[asyncio.Task[dict[str, object]]] = set()
        self._reader = asyncio.create_task(self._read(), name="stagehand-cdp-reader")

    @classmethod
    async def connect(
        cls,
        *,
        cdp_url: str,
        extension_dir: str | None = None,
        extension_id: str | None = None,
        preloaded_extension: bool = False,
        service_worker_url_includes: str | None = None,
    ) -> CDPClient:
        """Connect without an independent lifecycle deadline.

        The production browser factories own the complete 60-second initialization
        lifecycle. Direct internal callers must provide cancellation themselves.
        CDP command acknowledgements inherit that same caller-owned cancellation.
        """
        if sum((bool(extension_dir), bool(extension_id), preloaded_extension)) != 1:
            raise ValueError(
                "Exactly one of extension_dir, extension_id, or preloaded_extension is required"
            )

        web_socket_debugger_url = await _resolve_browser_web_socket_url(cdp_url)
        socket = await _connect_web_socket(web_socket_debugger_url)
        client = cls(socket, web_socket_debugger_url)

        try:
            resolved_extension_id = extension_id
            if extension_dir is not None:
                resolved_extension_id = await client._load_unpacked_extension(extension_dir)
            if preloaded_extension:
                resolved_extension_id = await client._discover_installed_stagehand_extension_id()
            if resolved_extension_id is None:
                raise RuntimeError("Stagehand extension ID was not resolved")

            worker = await client._wait_for_service_worker(
                resolved_extension_id,
                service_worker_url_includes or "service-worker.js",
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
            await client._wait_for_runtime_receiver(session_id)
            return client
        except BaseException:
            await asyncio.shield(client.close())
            raise

    @property
    def service_worker(self) -> ServiceWorkerInfo:
        if self._service_worker is None:
            raise RuntimeError("Stagehand service worker is not attached")
        return self._service_worker

    async def send(
        self,
        message: dict[str, object],
    ) -> None:
        if self._closed:
            raise RuntimeError("CDP client is closed")
        if self._session_id is None:
            raise RuntimeError("Stagehand service worker is not attached")

        serialized = json.dumps(message, separators=(",", ":"))
        callback_source = _callback_source_from_message(message)
        expression = (
            _callback_batch_expression(message=message, source=callback_source)
            if callback_source is not None
            else f"void globalThis.__stagehandReceiveFromHost({json.dumps(serialized)}); true"
        )
        evaluated = await self.send_command(
            "Runtime.evaluate",
            {
                "expression": expression,
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
    ) -> dict[str, object]:
        if self._closed:
            raise RuntimeError("CDP client is closed")

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
            result = await response
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

    async def _discover_installed_stagehand_extension_id(self) -> str:
        response = await self.send_command("Extensions.getExtensions")
        installed = [
            extension
            for extension in _parse_installed_extensions(response)
            if extension.name == _STAGEHAND_EXTENSION_NAME
        ]
        enabled = [extension for extension in installed if extension.enabled]

        if len(enabled) == 1:
            return enabled[0].id
        if len(enabled) > 1:
            ids = ", ".join(sorted(extension.id for extension in enabled))
            raise RuntimeError(f"Multiple enabled Stagehand extensions are installed: {ids}")
        if installed:
            raise RuntimeError(
                "Stagehand extension is installed in the connected browser but is disabled."
            )
        raise RuntimeError(
            "Stagehand extension is not installed in the connected browser. "
            "The extension must be included when the Browserbase session is created."
        )

    async def _wait_for_service_worker(
        self,
        extension_id: str,
        url_includes: str,
    ) -> ServiceWorkerInfo:
        started = time.monotonic()
        activation_target_id: str | None = None

        try:
            while True:
                response = await self.send_command("Target.getTargets")
                targets = response.get("targetInfos")
                target_infos = cast(list[object], targets) if isinstance(targets, list) else []
                for target in target_infos:
                    if not isinstance(target, dict):
                        continue
                    target_info = cast(dict[str, object], target)
                    url = target_info.get("url")
                    if (
                        target_info.get("type") == "service_worker"
                        and isinstance(url, str)
                        and url.startswith("chrome-extension://")
                        and url.startswith(f"chrome-extension://{extension_id}/")
                        and url_includes in url
                    ):
                        return ServiceWorkerInfo(
                            target_id=_required_string(
                                target_info, "targetId", "Target.getTargets"
                            ),
                            title=_required_string(target_info, "title", "Target.getTargets"),
                            url=url,
                            extension_id=extension_id,
                        )

                if activation_target_id is None and (time.monotonic() - started) >= 1:
                    with suppress(Exception):
                        activation = await self.send_command(
                            "Target.createTarget",
                            {"url": f"chrome-extension://{extension_id}/wake-service-worker.html"},
                        )
                        target_id = activation.get("targetId")
                        activation_target_id = target_id if isinstance(target_id, str) else None
                await asyncio.sleep(0.1)
        finally:
            if activation_target_id is not None:
                self._schedule_best_effort_command(
                    "Target.closeTarget", {"targetId": activation_target_id}
                )

    async def _wait_for_runtime_receiver(self, session_id: str) -> None:
        while True:
            try:
                evaluated = await self.send_command(
                    "Runtime.evaluate",
                    {
                        "expression": _RUNTIME_READINESS_EXPRESSION,
                        "returnByValue": True,
                    },
                    session_id=session_id,
                )
                exception = evaluated.get("exceptionDetails")
                if not isinstance(exception, Mapping):
                    result = evaluated.get("result")
                    value = result.get("value") if isinstance(result, Mapping) else None
                    if isinstance(value, Mapping):
                        has_receiver = value.get("hasReceiver") is True
                        compatible, _ = _negotiate_runtime(value.get("marker"))
                        if compatible and has_receiver:
                            return
            except Exception:
                pass
            await asyncio.sleep(0.1)

    def _schedule_best_effort_command(self, method: str, params: Mapping[str, object]) -> None:
        if self._closed:
            return
        task = asyncio.create_task(self.send_command(method, params))
        self._background_tasks.add(task)

        def finish(completed: asyncio.Task[dict[str, object]]) -> None:
            self._background_tasks.discard(completed)
            if not completed.cancelled():
                completed.exception()

        task.add_done_callback(finish)


async def _connect_web_socket(url: str) -> _WebSocket:
    from websockets.asyncio.client import connect

    return cast(
        _WebSocket,
        await connect(url, open_timeout=None, max_size=None),
    )


async def _resolve_browser_web_socket_url(cdp_url: str) -> str:
    if cdp_url.startswith(("ws://", "wss://")):
        return cdp_url

    base_url = cdp_url.rstrip("/")
    while True:
        try:
            version = await asyncio.to_thread(_read_json, f"{base_url}/json/version")
            debugger_url = version.get("webSocketDebuggerUrl")
            if isinstance(debugger_url, str) and debugger_url:
                return debugger_url
        except Exception:
            pass
        await asyncio.sleep(0.25)


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


def _parse_installed_extensions(response: Mapping[str, object]) -> list[_InstalledExtension]:
    raw_extensions = response.get("extensions")
    if not isinstance(raw_extensions, list):
        raise RuntimeError("Extensions.getExtensions did not return extensions")

    extensions: list[_InstalledExtension] = []
    for value in raw_extensions:
        if not isinstance(value, Mapping):
            raise RuntimeError("Extensions.getExtensions returned an invalid extension entry")
        extension_id = value.get("id")
        name = value.get("name")
        version = value.get("version")
        path = value.get("path")
        enabled = value.get("enabled")
        if (
            not isinstance(extension_id, str)
            or not extension_id
            or not isinstance(name, str)
            or not isinstance(version, str)
            or not isinstance(path, str)
            or not isinstance(enabled, bool)
        ):
            raise RuntimeError("Extensions.getExtensions returned an invalid extension entry")
        extensions.append(
            _InstalledExtension(
                id=extension_id,
                name=name,
                version=version,
                path=path,
                enabled=enabled,
            )
        )
    return extensions
