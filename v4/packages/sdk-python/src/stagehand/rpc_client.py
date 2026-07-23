from __future__ import annotations

import asyncio
import inspect
import json
from collections.abc import Awaitable, Callable, Coroutine
from contextlib import suppress
from typing import Annotated, Literal, Protocol, TypeVar, cast

from pydantic import BaseModel, ConfigDict, Field, JsonValue, TypeAdapter, ValidationError

from ._generated import models

_MAX_REQUEST_ID = 9_007_199_254_740_991
_MAX_PENDING_NOTIFICATIONS = 100

ParamsT = TypeVar("ParamsT", bound=BaseModel)
ResultT = TypeVar("ResultT", bound=BaseModel)
SchemaT = TypeVar("SchemaT", bound=BaseModel)

_RequestId = Annotated[int, Field(ge=0, le=_MAX_REQUEST_ID, strict=True)]
_Params = dict[str, JsonValue] | list[JsonValue] | None
_RequestHandler = Callable[[BaseModel], Awaitable[BaseModel]]
_NotificationListener = Callable[[BaseModel], Coroutine[object, object, None]]


class _JSONRPCModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class _JSONRPCRequest(_JSONRPCModel):
    jsonrpc: Literal["2.0"]
    id: _RequestId
    method: str
    params: _Params = None
    traceparent: str | None = None
    tracestate: str | None = None


class _JSONRPCNotification(_JSONRPCModel):
    jsonrpc: Literal["2.0"]
    method: str
    params: _Params = None


class _JSONRPCSuccessResponse(_JSONRPCModel):
    jsonrpc: Literal["2.0"]
    id: _RequestId
    result: JsonValue


class _JSONRPCError(_JSONRPCModel):
    code: Annotated[int, Field(ge=-_MAX_REQUEST_ID, le=_MAX_REQUEST_ID, strict=True)]
    message: str
    data: JsonValue | None = None


class _JSONRPCErrorResponse(_JSONRPCModel):
    jsonrpc: Literal["2.0"]
    id: _RequestId | None
    error: _JSONRPCError


_json_value = TypeAdapter(JsonValue)
_response = TypeAdapter(_JSONRPCSuccessResponse | _JSONRPCErrorResponse)


class _Transport(Protocol):
    async def send(self, message: dict[str, object]) -> None: ...

    async def receive(self) -> object: ...

    async def close(self) -> None: ...


class RPCError(RuntimeError):
    def __init__(self, error: _JSONRPCError) -> None:
        self.code = error.code
        self.data = error.data
        super().__init__(error.message)


class RPCClient:
    def __init__(self, transport: _Transport, *, request_timeout_ms: int = 10_000) -> None:
        if request_timeout_ms <= 0:
            raise ValueError("request_timeout_ms must be positive")

        self._transport = transport
        self._request_timeout_seconds = request_timeout_ms / 1_000
        self._next_request_id = 1
        self._pending: dict[
            int,
            tuple[str, type[BaseModel], asyncio.Future[object]],
        ] = {}
        self._request_handlers: dict[
            str,
            tuple[object, type[BaseModel], type[BaseModel], _RequestHandler],
        ] = {}
        self._notification_listeners: dict[
            str,
            list[tuple[object, type[BaseModel], _NotificationListener]],
        ] = {}
        self._pending_notifications: list[_JSONRPCNotification] = []
        self._inbound_tasks: set[asyncio.Task[None]] = set()
        self._closed = False
        self._close_reason: BaseException | None = None
        self._reader = asyncio.create_task(self._read(), name="stagehand-rpc-reader")

    async def send(
        self,
        method: str,
        params: BaseModel,
        result_model: type[ResultT],
    ) -> ResultT:
        if self._closed:
            raise RuntimeError("RPC client is closed") from self._close_reason

        # Revalidate at the wire boundary because nested lists and dictionaries remain mutable.
        encoded_params = params.model_dump_json(
            by_alias=True,
            exclude_unset=True,
            warnings="none",
        )
        parsed_params = type(params).model_validate_json(encoded_params, strict=True)
        request_id = self._next_request_id
        self._next_request_id += 1
        response: asyncio.Future[object] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = (
            method,
            cast(type[BaseModel], result_model),
            response,
        )
        request = _JSONRPCRequest(
            jsonrpc="2.0",
            id=request_id,
            method=method,
            params=parsed_params.model_dump(
                mode="json",
                by_alias=True,
                exclude_unset=True,
            ),
        )

        try:
            async with asyncio.timeout(self._request_timeout_seconds):
                await self._transport.send(
                    cast(
                        dict[str, object],
                        request.model_dump(mode="json", exclude_none=True, exclude_unset=True),
                    )
                )
                result = await response
                return cast(ResultT, result)
        except TimeoutError as error:
            raise TimeoutError(f"RPC request timed out: {method}") from error
        finally:
            self._pending.pop(request_id, None)
            if not response.done():
                response.cancel()

    def on_request(
        self,
        method: str,
        params_model: type[ParamsT],
        result_model: type[ResultT],
        handler: Callable[[ParamsT], ResultT | Awaitable[ResultT]],
    ) -> Callable[[], None]:
        if self._closed:
            raise RuntimeError("RPC client is closed") from self._close_reason

        async def handle(params: BaseModel) -> BaseModel:
            result = handler(cast(ParamsT, params))
            if inspect.isawaitable(result):
                return cast(BaseModel, await result)
            return result

        token = object()
        self._request_handlers[method] = (
            token,
            cast(type[BaseModel], params_model),
            cast(type[BaseModel], result_model),
            handle,
        )

        def remove() -> None:
            registered = self._request_handlers.get(method)
            if registered is not None and registered[0] is token:
                del self._request_handlers[method]

        return remove

    def on_notification(
        self,
        method: str,
        params_model: type[ParamsT],
        listener: Callable[[ParamsT], None | Awaitable[None]],
    ) -> Callable[[], None]:
        if self._closed:
            raise RuntimeError("RPC client is closed") from self._close_reason

        registered = self._notification_listeners.setdefault(method, [])
        if registered and registered[0][1] is not params_model:
            raise ValueError(f"Notification model already registered for {method}")

        async def notify(params: BaseModel) -> None:
            result = listener(cast(ParamsT, params))
            if inspect.isawaitable(result):
                await result

        token = object()
        registered.append((
            token,
            cast(type[BaseModel], params_model),
            notify,
        ))

        pending = [entry for entry in self._pending_notifications if entry.method == method]
        self._pending_notifications = [
            entry for entry in self._pending_notifications if entry.method != method
        ]
        for notification in pending:
            try:
                parsed = self._validate_json_value(params_model, notification.params)
            except (TypeError, ValueError, ValidationError):
                continue
            self._track_inbound(notify(parsed))

        def remove() -> None:
            listeners = self._notification_listeners.get(method)
            if listeners is None:
                return
            listeners[:] = [entry for entry in listeners if entry[0] is not token]
            if not listeners:
                del self._notification_listeners[method]

        return remove

    async def close(self, reason: BaseException | None = None) -> None:
        if self._closed:
            return

        self._closed = True
        self._close_reason = reason or RuntimeError("RPC client closed")
        self._request_handlers.clear()
        self._notification_listeners.clear()
        self._pending_notifications.clear()
        for _, _, response in self._pending.values():
            if not response.done():
                response.set_exception(self._close_reason)
        self._pending.clear()

        current_task = asyncio.current_task()
        if self._reader is not current_task:
            self._reader.cancel()
            with suppress(asyncio.CancelledError):
                await self._reader

        for task in self._inbound_tasks:
            if task is not current_task:
                task.cancel()
        remaining = [task for task in self._inbound_tasks if task is not current_task]
        if remaining:
            await asyncio.gather(*remaining, return_exceptions=True)
        self._inbound_tasks.clear()
        await self._transport.close()

    async def _read(self) -> None:
        try:
            while not self._closed:
                await self._receive(await self._transport.receive())
        except asyncio.CancelledError:
            raise
        except Exception as error:
            await self.close(error)

    async def _receive(self, raw: object) -> None:
        if isinstance(raw, str):
            try:
                decoded = json.loads(raw)
            except json.JSONDecodeError:
                await self._send_error(None, -32700, "Parse error")
                return
        else:
            decoded = raw

        try:
            message = _json_value.validate_python(decoded, strict=True)
        except ValidationError:
            await self._send_error(None, -32600, "Invalid request")
            return
        if not isinstance(message, dict):
            await self._send_error(None, -32600, "Invalid request")
            return

        if "result" in message or "error" in message:
            try:
                response = _response.validate_python(message, strict=True)
            except ValidationError:
                await self.close(RuntimeError("Invalid JSON-RPC response"))
                return
            self._receive_response(response)
            return

        if "method" in message and "id" not in message:
            try:
                notification = _JSONRPCNotification.model_validate(message, strict=True)
            except ValidationError:
                return
            self._receive_notification(notification)
            return

        try:
            request = _JSONRPCRequest.model_validate(message, strict=True)
        except ValidationError:
            request_id = message.get("id")
            valid_id = (
                isinstance(request_id, int)
                and not isinstance(request_id, bool)
                and 0 <= request_id <= _MAX_REQUEST_ID
            )
            await self._send_error(request_id if valid_id else None, -32600, "Invalid request")
            return
        self._track_inbound(self._handle_request(request))

    def _receive_response(
        self,
        response: _JSONRPCSuccessResponse | _JSONRPCErrorResponse,
    ) -> None:
        if response.id is None:
            return
        pending = self._pending.get(response.id)
        if pending is None:
            return
        _, result_model, future = pending
        if future.done():
            return

        if isinstance(response, _JSONRPCErrorResponse):
            future.set_exception(RPCError(response.error))
            return

        try:
            result = result_model.model_validate_json(
                json.dumps(response.result, separators=(",", ":")),
                strict=True,
            )
        except (TypeError, ValueError, ValidationError) as error:
            future.set_exception(error)
        else:
            future.set_result(result)

    def _receive_notification(self, notification: _JSONRPCNotification) -> None:
        registered = self._notification_listeners.get(notification.method)
        if not registered:
            if len(self._pending_notifications) == _MAX_PENDING_NOTIFICATIONS:
                self._pending_notifications.pop(0)
            self._pending_notifications.append(notification)
            return

        try:
            params = self._validate_json_value(registered[0][1], notification.params)
        except (TypeError, ValueError, ValidationError):
            return
        for _, _, listener in registered:
            self._track_inbound(listener(params))

    async def _handle_request(self, request: _JSONRPCRequest) -> None:
        registered = self._request_handlers.get(request.method)
        if registered is None:
            await self._send_error(request.id, -32601, "Method not found")
            return
        _, params_model, result_model, handler = registered

        try:
            params = self._validate_json_value(params_model, request.params)
        except (TypeError, ValueError, ValidationError):
            await self._send_error(request.id, -32602, "Invalid params")
            return

        try:
            result = await handler(params)
        except Exception as error:
            await self._send_error(
                request.id,
                -32603,
                str(error),
                {"name": type(error).__name__},
            )
            return

        try:
            validated_result = result_model.model_validate(result, strict=True)
            encoded_result = validated_result.model_dump_json(
                by_alias=True,
                exclude_unset=True,
                warnings="none",
            )
            parsed_result = result_model.model_validate_json(encoded_result, strict=True)
            wire_result = parsed_result.model_dump(
                mode="json",
                by_alias=True,
                exclude_unset=True,
            )
        except (TypeError, ValueError, ValidationError):
            await self._send_error(request.id, -32603, "Internal error")
            return
        response = _JSONRPCSuccessResponse(
            jsonrpc="2.0",
            id=request.id,
            result=wire_result,
        )
        await self._transport.send(
            cast(dict[str, object], response.model_dump(mode="json", exclude_unset=True))
        )

    async def _send_error(
        self,
        request_id: int | None,
        code: int,
        message: str,
        data: JsonValue | None = None,
    ) -> None:
        response = _JSONRPCErrorResponse(
            jsonrpc="2.0",
            id=request_id,
            error=_JSONRPCError(
                code=code,
                message=message,
                **({"data": data} if data is not None else {}),
            ),
        )
        await self._transport.send(
            cast(
                dict[str, object],
                response.model_dump(mode="json", exclude_unset=True),
            )
        )

    @staticmethod
    def _validate_json_value(model: type[SchemaT], value: object) -> SchemaT:
        return model.model_validate_json(
            json.dumps(value, separators=(",", ":")),
            strict=True,
        )

    def _track_inbound(self, operation: Coroutine[object, object, None]) -> None:
        task = asyncio.create_task(operation)
        self._inbound_tasks.add(task)
        task.add_done_callback(self._finish_inbound)

    def _finish_inbound(self, task: asyncio.Task[None]) -> None:
        self._inbound_tasks.discard(task)
        if not task.cancelled() and (error := task.exception()) is not None:
            asyncio.create_task(self.close(error))


async def connect_rpc_client(
    *,
    cdp_url: str,
    extension_dir: str | None = None,
    extension_id: str | None = None,
    service_worker_url_includes: str | None = None,
    discovery_timeout_ms: int = 10_000,
    command_timeout_ms: int = 10_000,
    cdp_connect_timeout_ms: int = 10_000,
    telemetry: models.TelemetryConfig | None = None,
) -> RPCClient:
    from .cdp_client import CDPClient

    cdp = await CDPClient.connect(
        cdp_url=cdp_url,
        extension_dir=extension_dir,
        extension_id=extension_id,
        service_worker_url_includes=service_worker_url_includes,
        discovery_timeout_ms=discovery_timeout_ms,
        command_timeout_ms=command_timeout_ms,
        cdp_connect_timeout_ms=cdp_connect_timeout_ms,
    )
    client = RPCClient(cdp, request_timeout_ms=command_timeout_ms)
    configure = models.RuntimeConfigureParams(
        cdp_url=cdp.web_socket_debugger_url,
        **({"telemetry": telemetry} if telemetry is not None else {}),
    )

    try:
        await client.send("runtime.configure", configure, models.RuntimeConfigureResult)
    except BaseException:
        await client.close()
        raise
    return client
