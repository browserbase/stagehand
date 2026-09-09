from __future__ import annotations

import asyncio
import json
import re
import time
from collections.abc import Mapping
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Literal, Protocol, cast
from urllib.request import urlopen

from stagehand._generated.protocol_version import (
    PROTOCOL_SEMVER_PATTERN,
    STAGEHAND_PROTOCOL_VERSION,
)

STAGEHAND_SEND_TO_HOST_BINDING = "__stagehandSendToHost"
_RUNTIME_NAME = "stagehand"
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


RuntimeIncompatibilityReason = Literal[
    "protocol-invalid-version",
    "protocol-major-mismatch",
    "protocol-server-too-old",
    "protocol-prerelease-mismatch",
    "runtime-name-mismatch",
]

RUNTIME_INCOMPATIBILITY_REMEDIATION = (
    "Upgrade the Stagehand SDK and the Stagehand extension together so their protocol majors "
    "match, or start the session with the extension bundled in this SDK."
)


@dataclass(frozen=True)
class RuntimeCompatibility:
    """Outcome of negotiating against the extension's `globalThis.__stagehand_runtime` marker.

    - ``compatible``: the marker parses and satisfies the protocol rules.
    - ``incompatible``: the marker parses but the protocol rules reject it, or it names a
      foreign runtime. Callers fail fast on this instead of re-polling.
    - ``unknown``: the marker is absent, not yet set, or unreadable. Callers keep polling.
    """

    kind: Literal["compatible", "incompatible", "unknown"]
    detail: str
    reason: RuntimeIncompatibilityReason | None = None
    protocol_version: str | None = None
    server_name: str | None = None
    server_version: str | None = None

    @property
    def compatible(self) -> bool:
        return self.kind == "compatible"


class StagehandRuntimeIncompatibleError(RuntimeError):
    """Raised as soon as the connected Stagehand extension reports a runtime this SDK cannot use.

    Covers a protocol major mismatch, an extension older than the client requirement, a
    prerelease mismatch, an invalid protocol version, or a foreign runtime name.
    """

    def __init__(self, compatibility: RuntimeCompatibility) -> None:
        if compatibility.kind != "incompatible" or compatibility.reason is None:
            raise ValueError("StagehandRuntimeIncompatibleError requires an incompatible result")
        self.compatibility = compatibility
        self.reason: RuntimeIncompatibilityReason = compatibility.reason
        self.detail = compatibility.detail
        self.client_protocol_version = STAGEHAND_PROTOCOL_VERSION
        self.extension_protocol_version = compatibility.protocol_version
        self.extension_server_info = {
            "name": compatibility.server_name,
            "version": compatibility.server_version,
        }
        self.remediation = RUNTIME_INCOMPATIBILITY_REMEDIATION
        super().__init__(
            f"Incompatible Stagehand runtime ({self.reason}): {self.detail}; "
            f"client protocol {self.client_protocol_version}, "
            f"extension protocol {self.extension_protocol_version}, "
            f"extension {compatibility.server_name}/{compatibility.server_version}. "
            f"{RUNTIME_INCOMPATIBILITY_REMEDIATION}"
        )


def _negotiate_runtime(marker: object) -> RuntimeCompatibility:
    """Classify a runtime marker. Never raises: a malformed marker is ``unknown``."""
    if not isinstance(marker, Mapping):
        return RuntimeCompatibility(kind="unknown", detail="no Stagehand runtime marker")

    server_info = marker.get("serverInfo")
    name = server_info.get("name") if isinstance(server_info, Mapping) else None
    version = server_info.get("version") if isinstance(server_info, Mapping) else None
    protocol_version = marker.get("protocolVersion")
    if not isinstance(name, str) or not isinstance(protocol_version, str):
        # Not a marker shape this client can read: the worker may still be publishing it.
        return RuntimeCompatibility(
            kind="unknown",
            detail=f"unreadable runtime marker: serverInfo.name={name!r} "
            f"protocolVersion={protocol_version!r}",
        )
    server_version = version if isinstance(version, str) else None

    if name != _RUNTIME_NAME:
        return RuntimeCompatibility(
            kind="incompatible",
            reason="runtime-name-mismatch",
            detail=f"runtime name mismatch: expected {_RUNTIME_NAME!r}, serverInfo.name={name!r}",
            protocol_version=protocol_version,
            server_name=name,
            server_version=server_version,
        )

    mismatch = _protocol_compatibility(STAGEHAND_PROTOCOL_VERSION, protocol_version)
    if mismatch is not None:
        reason, detail = mismatch
        return RuntimeCompatibility(
            kind="incompatible",
            reason=reason,
            detail=detail,
            protocol_version=protocol_version,
            server_name=name,
            server_version=server_version,
        )

    return RuntimeCompatibility(
        kind="compatible",
        detail=f"protocolVersion={protocol_version}",
        protocol_version=protocol_version,
        server_name=name,
        server_version=server_version,
    )


def _protocol_compatibility(
    client_version: str, server_version: str
) -> tuple[RuntimeIncompatibilityReason, str] | None:
    """Return ``(reason, detail)`` when the versions are incompatible, else ``None``."""
    client = _PROTOCOL_SEMVER_PATTERN.fullmatch(client_version)
    server = _PROTOCOL_SEMVER_PATTERN.fullmatch(server_version)
    if client is None or server is None:
        return (
            "protocol-invalid-version",
            f"invalid protocol version: client={client_version!r} server={server_version!r}",
        )
    if client.group(4) is not None or server.group(4) is not None:
        if client_version != server_version:
            return (
                "protocol-prerelease-mismatch",
                "protocol prereleases must match exactly: "
                f"client={client_version} server={server_version}",
            )
        return None
    if client.group(1) != server.group(1):
        return (
            "protocol-major-mismatch",
            f"protocol major mismatch: client={client_version} server={server_version}",
        )
    if int(server.group(2)) < int(client.group(2)):
        return (
            "protocol-server-too-old",
            f"server protocol {server_version} is older than client requirement {client_version}",
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
            if preloaded_extension:
                worker, session_id = await client._wait_for_preloaded_service_worker(
                    service_worker_url_includes or "service-worker.js",
                )
                resolved_extension_id = _extension_id_from_url(worker.url)
            else:
                resolved_extension_id = extension_id
                if extension_dir is not None:
                    resolved_extension_id = await client._load_unpacked_extension(extension_dir)

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

    async def _wait_for_service_worker(
        self,
        extension_id: str | None,
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
                        and (
                            extension_id is None
                            or url.startswith(f"chrome-extension://{extension_id}/")
                        )
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
        finally:
            if activation_target_id is not None:
                self._schedule_best_effort_command(
                    "Target.closeTarget", {"targetId": activation_target_id}
                )

    async def _wait_for_preloaded_service_worker(
        self,
        url_includes: str,
        *,
        allow_fallback_install: bool = False,
    ) -> tuple[ServiceWorkerInfo, str]:
        """Return a discovered worker and its flat CDP session, left attached for the caller.

        Each candidate must be attached to evaluate readiness; unready candidates are detached
        before the next poll. A sweep that finds no compatible worker but at least one
        incompatible one raises ``StagehandRuntimeIncompatibleError`` immediately unless
        ``allow_fallback_install`` is True (reserved for a future preloaded-extension flow).
        """
        while True:
            incompatible: RuntimeCompatibility | None = None
            response = await self.send_command("Target.getTargets")
            targets = response.get("targetInfos")
            target_infos = cast(list[object], targets) if isinstance(targets, list) else []
            for target in target_infos:
                if not isinstance(target, dict):
                    continue
                target_info = cast(dict[str, object], target)
                url = target_info.get("url")
                if not (
                    target_info.get("type") == "service_worker"
                    and isinstance(url, str)
                    and url.startswith("chrome-extension://")
                    and url_includes in url
                ):
                    continue

                session_id: str | None = None
                keep_attached = False
                try:
                    attached = await self.send_command(
                        "Target.attachToTarget",
                        {
                            "targetId": _required_string(
                                target_info, "targetId", "Target.getTargets"
                            ),
                            "flatten": True,
                        },
                    )
                    session_id = _required_string(attached, "sessionId", "Target.attachToTarget")
                    evaluated = await self.send_command(
                        "Runtime.evaluate",
                        {
                            "expression": _RUNTIME_READINESS_EXPRESSION,
                            "returnByValue": True,
                        },
                        session_id=session_id,
                    )
                    if not isinstance(evaluated.get("exceptionDetails"), Mapping):
                        result = evaluated.get("result")
                        value = result.get("value") if isinstance(result, Mapping) else None
                        if isinstance(value, Mapping):
                            compatibility = _negotiate_runtime(value.get("marker"))
                            if compatibility.kind == "incompatible" and not allow_fallback_install:
                                incompatible = compatibility
                            if compatibility.compatible and value.get("hasReceiver") is True:
                                service_worker = ServiceWorkerInfo(
                                    target_id=_required_string(
                                        target_info, "targetId", "Target.getTargets"
                                    ),
                                    title=_required_string(
                                        target_info, "title", "Target.getTargets"
                                    ),
                                    url=url,
                                    extension_id=_extension_id_from_url(url),
                                )
                                keep_attached = True
                                return service_worker, session_id
                except Exception:
                    # The worker may still be starting. Detach and retry until cancellation.
                    pass
                finally:
                    if session_id is not None and not keep_attached:
                        with suppress(Exception):
                            await self.send_command(
                                "Target.detachFromTarget",
                                {"sessionId": session_id},
                            )
            # No compatible worker in this sweep and at least one incompatible one: fail fast
            # instead of re-polling until the initialization deadline.
            if incompatible is not None:
                raise StagehandRuntimeIncompatibleError(incompatible)
            await asyncio.sleep(0.1)

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
                exception = evaluated.get("exceptionDetails")
                if not isinstance(exception, Mapping):
                    result = evaluated.get("result")
                    value = result.get("value") if isinstance(result, Mapping) else None
                    if isinstance(value, Mapping):
                        has_receiver = value.get("hasReceiver") is True
                        compatibility = _negotiate_runtime(value.get("marker"))
                        # Fail fast by default; allow_fallback_install is reserved for a future
                        # Browserbase preloaded-extension flow that may replace the runtime.
                        if compatibility.kind == "incompatible" and not allow_fallback_install:
                            raise StagehandRuntimeIncompatibleError(compatibility)
                        if compatibility.compatible and has_receiver:
                            return
            except StagehandRuntimeIncompatibleError:
                raise
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


def _extension_id_from_url(url: str) -> str | None:
    prefix = "chrome-extension://"
    if not url.startswith(prefix):
        return None
    extension_id, separator, _ = url.removeprefix(prefix).partition("/")
    return extension_id if separator and extension_id else None
