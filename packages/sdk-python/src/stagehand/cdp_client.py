from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from collections.abc import Callable, Mapping
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Literal, Protocol, cast
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen

from typing_extensions import override
from websockets.asyncio.client import connect as WebSocketConnect
from websockets.exceptions import ConnectionClosed, InvalidStatus

from stagehand._generated.protocol_version import (
    PROTOCOL_SEMVER_PATTERN,
    STAGEHAND_PROTOCOL_VERSION,
)

_LOGGER = logging.getLogger(__name__)

STAGEHAND_SEND_TO_HOST_BINDING = "__stagehandSendToHost"
_RUNTIME_NAME = "stagehand"
_STAGEHAND_EXTENSION_NAME = "Stagehand Runtime"
_PROTOCOL_SEMVER_PATTERN = re.compile(PROTOCOL_SEMVER_PATTERN)

_RUNTIME_READINESS_EXPRESSION = """(() => ({
  marker: globalThis.__stagehand_runtime ?? null,
  hasReceiver: typeof globalThis.__stagehandReceiveFromHost === "function",
}))()"""

_SERVICE_WORKER_BUILD_EXPRESSION = """(async () => {
  if (globalThis.__stagehand_runtime === undefined) return null;
  let onDisk = null;
  try {
    const response = await fetch(chrome.runtime.getURL("build-id.txt"), {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) onDisk = (await response.text()).trim();
  } catch {}
  return { running: globalThis.__stagehand_build_id ?? null, onDisk };
})()"""
_SERVICE_WORKER_BUILD_READ_RETRIES = 15
_SERVICE_WORKER_BUILD_READ_TIMEOUT_SECONDS = 10


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


RUNTIME_INCOMPATIBLE_REMEDIATION = (
    "Upgrade the Stagehand SDK and the Stagehand extension together so their protocol majors "
    "match, or start the session with the extension bundled in this SDK."
)


@dataclass(frozen=True)
class _RuntimeNegotiation:
    kind: Literal["compatible", "incompatible", "unknown"]
    detail: str
    reason: str | None = None
    protocol_version: str | None = None
    server_name: str | None = None
    server_version: str | None = None

    @property
    def compatible(self) -> bool:
        return self.kind == "compatible"


class StagehandRuntimeIncompatibleError(RuntimeError):
    """The connected Stagehand extension speaks a protocol this SDK cannot use.

    Raised on the first readiness poll that observes the incompatible marker; initialization
    does not wait for the timeout because the extension will not change its protocol version
    while the session is open.
    """

    def __init__(self, negotiation: _RuntimeNegotiation) -> None:
        self.reason = negotiation.reason or "protocol-incompatible"
        self.client_protocol_version = STAGEHAND_PROTOCOL_VERSION
        self.reported_protocol_version = negotiation.protocol_version
        self.server_name = negotiation.server_name
        self.server_version = negotiation.server_version
        self.remediation = RUNTIME_INCOMPATIBLE_REMEDIATION
        super().__init__(
            f"Incompatible Stagehand runtime: {negotiation.detail}; "
            f"client protocol {self.client_protocol_version}, "
            f"reported protocol {self.reported_protocol_version}, "
            f"server {self.server_name}/{self.server_version}. "
            f"{self.remediation}"
        )


def _negotiate_runtime(marker: object) -> _RuntimeNegotiation:
    if not isinstance(marker, Mapping):
        return _RuntimeNegotiation("unknown", "no Stagehand runtime marker")

    server_info = marker.get("serverInfo")
    if not isinstance(server_info, Mapping):
        return _RuntimeNegotiation("unknown", f"serverInfo={server_info!r}")
    name = server_info.get("name")
    version = server_info.get("version")
    if not isinstance(name, str) or not name or not isinstance(version, str) or not version:
        return _RuntimeNegotiation(
            "unknown", f"serverInfo.name={name!r} serverInfo.version={version!r}"
        )

    protocol_version = marker.get("protocolVersion")
    if not isinstance(protocol_version, str) or not protocol_version:
        return _RuntimeNegotiation("unknown", f"protocolVersion={protocol_version!r}")

    if name != _RUNTIME_NAME:
        return _RuntimeNegotiation(
            "incompatible",
            f'Runtime name mismatch: expected "{_RUNTIME_NAME}", server reported "{name}"',
            reason="runtime-name-mismatch",
            protocol_version=protocol_version,
            server_name=name,
            server_version=version,
        )

    incompatibility = _protocol_compatibility(STAGEHAND_PROTOCOL_VERSION, protocol_version)
    if incompatibility is not None:
        reason, detail = incompatibility
        return _RuntimeNegotiation(
            "incompatible",
            detail,
            reason=reason,
            protocol_version=protocol_version,
            server_name=name,
            server_version=version,
        )

    return _RuntimeNegotiation(
        "compatible",
        f"protocolVersion={protocol_version}",
        protocol_version=protocol_version,
        server_name=name,
        server_version=version,
    )


def _protocol_compatibility(client_version: str, server_version: str) -> tuple[str, str] | None:
    client = _PROTOCOL_SEMVER_PATTERN.fullmatch(client_version)
    server = _PROTOCOL_SEMVER_PATTERN.fullmatch(server_version)
    if client is None or server is None:
        return (
            "protocol-invalid-version",
            f"Invalid protocol version: client {client_version}, server {server_version}",
        )
    if client.group(4) is not None or server.group(4) is not None:
        if client_version != server_version:
            return (
                "protocol-prerelease-mismatch",
                "Protocol prereleases must match exactly: "
                f"client {client_version}, server {server_version}",
            )
        return None
    if client.group(1) != server.group(1):
        return (
            "protocol-major-mismatch",
            f"Protocol major mismatch: client {client_version}, server {server_version}",
        )
    if int(server.group(2)) < int(client.group(2)):
        return (
            "protocol-server-too-old",
            f"Server protocol {server_version} is older than client requirement {client_version}",
        )
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


_UNSTAMPED_BUILD_ID = "__STAGEHAND_EXTENSION_BUILD_ID__"

_StaleServiceWorkerReplacement = Literal["not owned", "reloaded", "reload failed"]


@dataclass(frozen=True)
class _ServiceWorkerBuild:
    running: str | None
    on_disk: str | None

    @property
    def stale(self) -> bool:
        if {"", _UNSTAMPED_BUILD_ID} & {self.running, self.on_disk}:
            return False
        return self.on_disk is not None and self.running != self.on_disk


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


_CLIENT_TARGET_URL = "about:blank#stagehand-client-connection"


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
        self._client_target_id: str | None = None
        self._client_close_browser_on_loss = False
        self._background_tasks: set[asyncio.Task[dict[str, object]]] = set()
        self._reader = asyncio.create_task(self._read(), name="stagehand-cdp-reader")

    @classmethod
    async def connect(
        cls,
        *,
        cdp_url: str,
        extension_dir: str | None = None,
        local_extension_dir: Callable[[], str] | None = None,
        extension_id: str | None = None,
        preloaded_extension: bool = False,
        service_worker_url_includes: str | None = None,
        headers: Mapping[str, str] | None = None,
        close_browser_on_disconnect: bool | None = None,
        extension_cdp_url: str | None = None,
    ) -> CDPClient:
        if (
            sum((
                bool(extension_dir),
                local_extension_dir is not None,
                bool(extension_id),
                preloaded_extension,
            ))
            != 1
        ):
            raise ValueError(
                "Exactly one of extension_dir, local_extension_dir, extension_id, "
                "or preloaded_extension is required"
            )

        web_socket_debugger_url = await _resolve_browser_web_socket_url(cdp_url, headers=headers)
        web_socket_headers = headers or None
        if web_socket_headers and not _can_forward_headers(cdp_url, web_socket_debugger_url):
            web_socket_headers = None
            _LOGGER.debug(
                "CDP headers were withheld from the advertised WebSocket endpoint because "
                "its host or port differs, or forwarding would downgrade transport security. "
                "If the handshake is rejected, check the gateway's advertised CDP endpoint."
            )
        socket = await _connect_web_socket(web_socket_debugger_url, headers=web_socket_headers)
        client = cls(socket, web_socket_debugger_url)

        try:
            resolved_extension_id = extension_id
            loaded_from: str | None = None
            installed_path: str | None = None
            if local_extension_dir is not None:
                (
                    resolved_extension_id,
                    loaded_from,
                    installed_path,
                ) = await client._discover_or_load_extension(
                    load_if_not_found=True, extension_dir=local_extension_dir
                )
            elif extension_dir is not None:
                resolved_extension_id = await client._load_unpacked_extension(extension_dir)
                loaded_from = extension_dir
            elif preloaded_extension:
                resolved_extension_id = await client._resolve_extension(load_if_not_found=False)
            if resolved_extension_id is None:
                raise RuntimeError("Stagehand extension ID was not resolved")

            worker, session_id = await client._attach_service_worker(
                resolved_extension_id, service_worker_url_includes or "service-worker.js"
            )
            build = await client._read_service_worker_build(session_id)
            if build.stale and installed_path is not None and local_extension_dir is not None:
                directory = local_extension_dir()
                if _same_directory(installed_path, directory):
                    loaded_from = directory
            replacement: _StaleServiceWorkerReplacement = "not owned"
            if build.stale and loaded_from is not None:
                try:
                    resolved_extension_id = await client._load_unpacked_extension(loaded_from)
                    replacement = "reloaded"
                except CDPConnectionClosedError:
                    raise
                except Exception:
                    replacement = "reload failed"
                if replacement == "reloaded":
                    worker, session_id = await client._attach_service_worker(
                        resolved_extension_id,
                        service_worker_url_includes or "service-worker.js",
                        exclude_target_id=worker.target_id,
                    )
                    build = await client._read_service_worker_build(session_id)
            if build.stale:
                _LOGGER.warning(
                    _stale_service_worker_message(resolved_extension_id, build, replacement)
                )
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
            if close_browser_on_disconnect is not None:
                await client._register_client(
                    close_browser_on_disconnect,
                    extension_cdp_url or web_socket_debugger_url,
                )
            return client
        except BaseException:
            await asyncio.shield(client.close())
            raise

    @property
    def closed(self) -> bool:
        return self._closed

    @property
    def service_worker(self) -> ServiceWorkerInfo:
        if self._service_worker is None:
            raise RuntimeError("Stagehand service worker is not attached")
        return self._service_worker

    async def _register_client(self, close_browser_on_disconnect: bool, cdp_url: str) -> None:
        marker = await self.send_command(
            "Target.createTarget",
            {"url": _CLIENT_TARGET_URL, "hidden": True, "background": True},
        )
        target_id = _required_string(marker, "targetId", "Target.createTarget")
        # Chrome accepts unknown parameters: a build without hidden targets opens an
        # ordinary tab that outlives this connection and would never signal its loss.
        info = await self.send_command("Target.getTargetInfo", {"targetId": target_id})
        target_info = info.get("targetInfo")
        if not isinstance(target_info, dict) or target_info.get("type") != "other":
            await self.send_command("Target.closeTarget", {"targetId": target_id})
            raise RuntimeError(
                "Stagehand requires Chrome 137 or later, which supports hidden targets"
            )
        if not await self._client_lifecycle_command({
            "action": "attach",
            "targetId": target_id,
            "cdpUrl": cdp_url,
            "closeBrowserOnDisconnect": close_browser_on_disconnect,
        }):
            await self.send_command("Target.closeTarget", {"targetId": target_id})
            raise RuntimeError(
                "The Stagehand extension in this browser does not support the client "
                "watchdog; update the extension"
            )
        self._client_target_id = target_id
        self._client_close_browser_on_loss = close_browser_on_disconnect

    async def detach_client(self) -> None:
        if self._client_target_id is None or self._closed:
            return
        try:
            async with asyncio.timeout(10):
                acknowledged = await self._client_lifecycle_command({
                    "action": "detach",
                    "targetId": self._client_target_id,
                })
        except CDPConnectionClosedError:
            # Browserbase ends a keep_alive=False session once the extension closes its own
            # connection, which closes this one before the acknowledgement arrives: the
            # detach happened. A failure or timeout with this connection open still raises,
            # and so does a lost connection when the extension shuts the browser down on
            # loss: it may not have received the detach.
            if self._client_close_browser_on_loss:
                raise
            acknowledged = True
        if not acknowledged:
            raise RuntimeError("The Stagehand extension did not acknowledge the detach")
        self._client_target_id = None

    async def _client_lifecycle_command(self, params: dict[str, object]) -> bool:
        expression = (
            "(async () => { "
            'if (typeof globalThis.__stagehandClientLifecycle !== "function") return false; '
            f"await globalThis.__stagehandClientLifecycle({json.dumps(params)}); "
            "return true; })()"
        )
        result = await self.send_command(
            "Runtime.evaluate",
            {"expression": expression, "awaitPromise": True, "returnByValue": True},
            session_id=self._session_id,
        )
        value = result.get("result")
        if (
            result.get("exceptionDetails")
            or not isinstance(value, dict)
            or not isinstance(value.get("value"), bool)
        ):
            raise RuntimeError(
                f"Stagehand client lifecycle failed: {result.get('exceptionDetails')}"
            )
        return bool(value["value"])

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
            try:
                await self._socket.send(json.dumps(message, separators=(",", ":")))
            except ConnectionClosed as error:
                raise CDPConnectionClosedError() from error
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
                    "Preload the Stagehand extension and connect using a Chrome build "
                    "that supports Extensions.getExtensions."
                ) from error
            raise
        return _required_string(loaded, "id", "Extensions.loadUnpacked")

    async def _attach_service_worker(
        self,
        extension_id: str,
        url_includes: str,
        *,
        exclude_target_id: str | None = None,
    ) -> tuple[ServiceWorkerInfo, str]:
        worker = await self._wait_for_service_worker(
            extension_id, url_includes, exclude_target_id=exclude_target_id
        )
        attached = await self.send_command(
            "Target.attachToTarget",
            {"targetId": worker.target_id, "flatten": True},
        )
        return worker, _required_string(attached, "sessionId", "Target.attachToTarget")

    async def _read_service_worker_build(self, session_id: str) -> _ServiceWorkerBuild:
        try:
            async with asyncio.timeout(_SERVICE_WORKER_BUILD_READ_TIMEOUT_SECONDS):
                return await self._poll_service_worker_build(session_id)
        except TimeoutError:
            return _ServiceWorkerBuild(running=None, on_disk=None)

    async def _poll_service_worker_build(self, session_id: str) -> _ServiceWorkerBuild:
        failures = 0
        while True:
            value: object = None
            try:
                evaluated = await self.send_command(
                    "Runtime.evaluate",
                    {
                        "expression": _SERVICE_WORKER_BUILD_EXPRESSION,
                        "returnByValue": True,
                        "awaitPromise": True,
                    },
                    session_id=session_id,
                )
                result = evaluated.get("result")
                if not isinstance(evaluated.get("exceptionDetails"), Mapping) and isinstance(
                    result, Mapping
                ):
                    value = result.get("value")
            except CDPConnectionClosedError:
                raise
            except Exception:
                failures += 1
                if failures > _SERVICE_WORKER_BUILD_READ_RETRIES:
                    return _ServiceWorkerBuild(running=None, on_disk=None)
            if isinstance(value, Mapping):
                running, on_disk = value.get("running"), value.get("onDisk")
                if isinstance(running, str | None) and isinstance(on_disk, str | None):
                    return _ServiceWorkerBuild(running=running, on_disk=on_disk)
            if value is not None:
                return _ServiceWorkerBuild(running=None, on_disk=None)
            await asyncio.sleep(0.1)

    async def _resolve_extension(
        self,
        *,
        load_if_not_found: bool,
        extension_dir: Callable[[], str] | None = None,
    ) -> str:
        extension_id, _, _ = await self._discover_or_load_extension(
            load_if_not_found=load_if_not_found, extension_dir=extension_dir
        )
        return extension_id

    async def _discover_or_load_extension(
        self,
        *,
        load_if_not_found: bool,
        extension_dir: Callable[[], str] | None = None,
    ) -> tuple[str, str | None, str | None]:
        installed: _InstalledExtension | None = None
        try:
            installed = await self._get_installed_stagehand_extension()
        except _CDPCommandError as error:
            unsupported = error.method == "Extensions.getExtensions" and (
                error.code == -32601
                or "method not found" in str(error).lower()
                or "wasn't found" in str(error).lower()
            )
            if not load_if_not_found or not unsupported:
                raise
        if installed is not None:
            return installed.id, None, installed.path
        if load_if_not_found:
            if extension_dir is None:
                raise ValueError("extension_dir is required to load the Stagehand extension")
            directory = extension_dir()
            return await self._load_unpacked_extension(directory), directory, None
        raise RuntimeError(
            "Stagehand extension is not installed in the connected browser. "
            "The extension must be included when the Browserbase session is created."
        )

    async def _get_installed_stagehand_extension(self) -> _InstalledExtension | None:
        response = await self.send_command("Extensions.getExtensions")
        installed = [
            extension
            for extension in _parse_installed_extensions(response)
            if extension.name == _STAGEHAND_EXTENSION_NAME
        ]
        enabled = [extension for extension in installed if extension.enabled]

        if len(enabled) == 1:
            return enabled[0]
        if len(enabled) > 1:
            ids = ", ".join(sorted(extension.id for extension in enabled))
            raise RuntimeError(f"Multiple enabled Stagehand extensions are installed: {ids}")
        if installed:
            raise RuntimeError(
                "Stagehand extension is installed in the connected browser but is disabled."
            )
        return None

    async def _wait_for_service_worker(
        self,
        extension_id: str,
        url_includes: str,
        *,
        exclude_target_id: str | None = None,
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
                        and target_info.get("targetId") != exclude_target_id
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

    async def _wait_for_runtime_receiver(
        self,
        session_id: str,
        *,
        allow_fallback_install: bool = False,
    ) -> None:
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
            except Exception:
                evaluated = None
            if evaluated is not None:
                exception = evaluated.get("exceptionDetails")
                if not isinstance(exception, Mapping):
                    result = evaluated.get("result")
                    value = result.get("value") if isinstance(result, Mapping) else None
                    if isinstance(value, Mapping):
                        has_receiver = value.get("hasReceiver") is True
                        negotiation = _negotiate_runtime(value.get("marker"))
                        if negotiation.kind == "incompatible" and not allow_fallback_install:
                            raise StagehandRuntimeIncompatibleError(negotiation)
                        if negotiation.compatible and has_receiver:
                            return
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


class _UnsafeCDPRedirectError(RuntimeError):
    """A redirect would expose caller headers to an unauthorized endpoint."""


_DEFAULT_PORTS = {"http": 80, "ws": 80, "https": 443, "wss": 443}


def _can_forward_headers(source: str, destination: str) -> bool:
    try:
        first, second = urlsplit(source), urlsplit(destination)
        return (
            first.scheme in _DEFAULT_PORTS
            and second.scheme in _DEFAULT_PORTS
            and first.hostname is not None
            and first.hostname == second.hostname
            and (first.port if first.port is not None else _DEFAULT_PORTS[first.scheme])
            == (second.port if second.port is not None else _DEFAULT_PORTS[second.scheme])
            and not (first.scheme in ("https", "wss") and second.scheme in ("http", "ws"))
        )
    except ValueError:
        return False


class _CDPRedirectHandler(HTTPRedirectHandler):
    @override
    def redirect_request(
        self, req: Request, fp: Any, code: int, msg: str, headers: Any, newurl: str
    ) -> Request | None:
        if not _can_forward_headers(req.full_url, newurl):
            raise _UnsafeCDPRedirectError(
                "Refusing CDP HTTP redirect with headers to a different host or port, "
                "or an insecure endpoint"
            )
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class _CDPWebSocketConnect(WebSocketConnect):
    @override
    def process_redirect(self, exc: Exception) -> Exception | str:
        if (
            self.additional_headers
            and isinstance(exc, InvalidStatus)
            and exc.response.status_code in (300, 301, 302, 303, 307, 308)
            and "Location" in exc.response.headers
            and not _can_forward_headers(
                self.uri, urljoin(self.uri, exc.response.headers["Location"])
            )
        ):
            return _UnsafeCDPRedirectError(
                "Refusing CDP WebSocket redirect with headers to a different host or port, "
                "or an insecure endpoint"
            )
        return super().process_redirect(exc)


async def _connect_web_socket(url: str, *, headers: Mapping[str, str] | None = None) -> _WebSocket:
    return cast(
        _WebSocket,
        await _CDPWebSocketConnect(
            url, open_timeout=None, max_size=None, additional_headers=headers
        ),
    )


async def _resolve_browser_web_socket_url(
    cdp_url: str, *, headers: Mapping[str, str] | None = None
) -> str:
    if cdp_url.startswith(("ws://", "wss://")):
        return cdp_url

    base_url = cdp_url.rstrip("/")
    while True:
        try:
            version = await asyncio.to_thread(_read_json, f"{base_url}/json/version", headers)
            debugger_url = version.get("webSocketDebuggerUrl")
            if isinstance(debugger_url, str) and debugger_url:
                return debugger_url
        except _UnsafeCDPRedirectError:
            raise
        except HTTPError as error:
            error.close()
            if error.code in (401, 403):
                raise RuntimeError(
                    f"CDP discovery was rejected with HTTP {error.code}. "
                    "Check the gateway credentials and access permissions."
                ) from None
        except Exception:
            pass
        await asyncio.sleep(0.25)


def _read_json(url: str, headers: Mapping[str, str] | None = None) -> dict[str, object]:
    request = Request(url, headers=dict(headers or {}))
    open_url = build_opener(_CDPRedirectHandler()).open if headers else urlopen
    with open_url(request, timeout=2) as response:
        value: Any = json.load(response)
    if not isinstance(value, dict):
        raise RuntimeError("CDP version endpoint returned invalid JSON")
    return cast(dict[str, object], value)


def _same_directory(first: str, second: str) -> bool:
    try:
        return os.path.samefile(first, second)
    except OSError:
        return os.path.normpath(first) == os.path.normpath(second)


def _stale_service_worker_message(
    extension_id: str, build: _ServiceWorkerBuild, replacement: _StaleServiceWorkerReplacement
) -> str:
    running = (
        "a service worker without a build identity"
        if build.running is None
        else f"service worker build {build.running}"
    )
    if replacement == "reloaded":
        return (
            f"The Stagehand extension {extension_id} still runs {running} "
            f"after it was reloaded from a directory that holds build {build.on_disk}, "
            "so Stagehand continues with the running worker."
        )
    reason = (
        "Stagehand could not load this extension again from its directory to replace the worker"
        if replacement == "reload failed"
        else "Stagehand did not load this extension from its own directory"
    )
    return (
        f"The Stagehand extension {extension_id} runs {running}, but its "
        f"directory holds build {build.on_disk}: the browser profile kept the worker of "
        f"another build. {reason}, so it continues with the running worker."
    )


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
