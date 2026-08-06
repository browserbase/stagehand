from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Mapping
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Protocol, cast
from urllib.request import urlopen

from stagehand._generated.protocol_version import STAGEHAND_PROTOCOL_VERSION

STAGEHAND_SEND_TO_HOST_BINDING = "__stagehandSendToHost"
_RUNTIME_NAME = "stagehand"
_MINIMUM_PROTOCOL_VERSION = STAGEHAND_PROTOCOL_VERSION
_MAXIMUM_PROTOCOL_VERSION = STAGEHAND_PROTOCOL_VERSION

# Constant on purpose: the TypeScript SDK evaluates the identical expression, so the two cannot
# drift. All judgement happens here rather than in the page.
_RUNTIME_READINESS_EXPRESSION = """(() => ({
  marker: globalThis.__stagehand_runtime ?? null,
  hasReceiver: typeof globalThis.__stagehandReceiveFromHost === "function",
}))()"""


def _callback_batch_expression(
    *,
    source: str,
    input: object,
    page_id: str | None,
    timeout: int,
) -> str:
    if not isinstance(source, str) or not source.strip():
        raise TypeError("stagehand._experimental_batch() source must be JavaScript")
    serialized_input = json.dumps(
        input,
        allow_nan=False,
        separators=(",", ":"),
    )
    options: dict[str, object] = {"timeout": timeout}
    if page_id is not None:
        options["pageId"] = page_id
    serialized_options = json.dumps(options, separators=(",", ":"))
    return (
        "(async (__name) => { if (typeof globalThis.__stagehandRunCallbackBatch !== "
        "'function') return { ok: false, error: { name: "
        "'StagehandRuntimeIncompatibleError', message: "
        "'The connected Stagehand runtime does not support callback batches' } }; "
        "return await globalThis.__stagehandRunCallbackBatch("
        f"({source}), {serialized_input}, {serialized_options}); }})"
        "((fn, name) => { try { Object.defineProperty(fn, 'name', "
        "{ value: name, configurable: true }); } catch {} return fn; })"
    )


def _negotiate_runtime(marker: object) -> tuple[bool, str]:
    """Return (compatible, detail). Never raises: a malformed marker is just incompatible."""
    if not isinstance(marker, Mapping):
        return False, "no Stagehand runtime marker"

    server_info = marker.get("serverInfo")
    name = server_info.get("name") if isinstance(server_info, Mapping) else None
    if name != _RUNTIME_NAME:
        return False, f"serverInfo.name={name!r}"

    protocol_version = marker.get("protocolVersion")
    if not isinstance(protocol_version, int) or isinstance(protocol_version, bool):
        return False, f"protocolVersion={protocol_version!r}"
    if protocol_version < _MINIMUM_PROTOCOL_VERSION:
        return False, f"protocolVersion={protocol_version} below {_MINIMUM_PROTOCOL_VERSION}"
    if protocol_version > _MAXIMUM_PROTOCOL_VERSION:
        return False, f"protocolVersion={protocol_version} above {_MAXIMUM_PROTOCOL_VERSION}"

    return True, f"protocolVersion={protocol_version}"


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

    async def run_callback_batch(
        self,
        *,
        source: str,
        input: object,
        page_id: str | None,
        timeout: int,
    ) -> object:
        if self._closed:
            raise RuntimeError("CDP client is closed")
        if self._session_id is None:
            raise RuntimeError("Stagehand service worker is not attached")
        expression = _callback_batch_expression(
            source=source,
            input=input,
            page_id=page_id,
            timeout=timeout,
        )
        async with asyncio.timeout((timeout + 1_000) / 1_000):
            evaluated = await self.send_command(
                "Runtime.evaluate",
                {
                    "expression": expression,
                    "awaitPromise": True,
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
                    or "Stagehand callback batch evaluation failed"
                )
            )
        result = evaluated.get("result")
        envelope = result.get("value") if isinstance(result, Mapping) else None
        if not isinstance(envelope, Mapping) or not isinstance(envelope.get("ok"), bool):
            raise RuntimeError("Stagehand callback batch returned an invalid result")
        if envelope.get("ok") is False:
            error = envelope.get("error")
            message = error.get("message") if isinstance(error, Mapping) else None
            raise RuntimeError(str(message or "Stagehand callback batch failed"))
        value_is_undefined = envelope.get("valueIsUndefined") is True
        has_value = "value" in envelope
        if value_is_undefined == has_value:
            raise RuntimeError("Stagehand callback batch returned an invalid result")
        if value_is_undefined:
            return None
        return envelope.get("value")

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
    ) -> tuple[ServiceWorkerInfo, str]:
        """Return a discovered worker and its flat CDP session, left attached for the caller.

        Each candidate must be attached to evaluate readiness; unready or incompatible
        candidates are detached before the next poll.
        """
        while True:
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
                            compatible, _ = _negotiate_runtime(value.get("marker"))
                            if compatible and value.get("hasReceiver") is True:
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
            await asyncio.sleep(0.1)

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


def _extension_id_from_url(url: str) -> str | None:
    prefix = "chrome-extension://"
    if not url.startswith(prefix):
        return None
    extension_id, separator, _ = url.removeprefix(prefix).partition("/")
    return extension_id if separator and extension_id else None
