from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import TypeVar, overload

from pydantic import BaseModel, RootModel

ParamsT = TypeVar("ParamsT", bound=BaseModel)
ResultT = TypeVar("ResultT", bound=BaseModel)
RootResultT = TypeVar("RootResultT")


class RecordingRPCClient:
    browser_web_socket_debugger_url: str | None = "ws://resolved.example/devtools/browser/1"

    def __init__(self, responses: dict[str, object] | None = None) -> None:
        self.responses = responses or {}
        self.calls: list[tuple[str, BaseModel, object]] = []
        self.requests: dict[str, tuple[object, object, object]] = {}
        self.notifications: dict[str, tuple[object, object]] = {}
        self.closed = False
        self.close_transport_flags: list[bool] = []
        self.callback_sources: list[str | None] = []

    @overload
    async def send(
        self,
        method: str,
        params: BaseModel,
        result_model: type[RootModel[RootResultT]],
        *,
        callback_source: str | None = None,
    ) -> RootResultT: ...

    @overload
    async def send(
        self,
        method: str,
        params: BaseModel,
        result_model: type[ResultT],
        *,
        callback_source: str | None = None,
    ) -> ResultT: ...

    async def send(
        self,
        method: str,
        params: BaseModel,
        result_model: type[BaseModel],
        *,
        callback_source: str | None = None,
    ) -> object:
        self.callback_sources.append(callback_source)
        self.calls.append((method, params, result_model))
        response = self.responses[method]
        if isinstance(response, BaseException):
            raise response
        parsed_result = result_model.model_validate(response, strict=True)
        return parsed_result.root if isinstance(parsed_result, RootModel) else parsed_result

    def on_request(
        self,
        method: str,
        params_model: type[ParamsT],
        result_model: type[ResultT],
        handler: Callable[[ParamsT], ResultT | Awaitable[ResultT]],
    ) -> Callable[[], None]:
        self.requests[method] = (params_model, result_model, handler)

        def remove() -> None:
            self.requests.pop(method, None)

        return remove

    def on_notification(
        self,
        method: str,
        params_model: type[ParamsT],
        listener: Callable[[ParamsT], None | Awaitable[None]],
    ) -> Callable[[], None]:
        self.notifications[method] = (params_model, listener)

        def remove() -> None:
            self.notifications.pop(method, None)

        return remove

    async def close(
        self,
        reason: BaseException | None = None,
        *,
        close_transport: bool = True,
    ) -> None:
        self.closed = True
        self.close_transport_flags.append(close_transport)
