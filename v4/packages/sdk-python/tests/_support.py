from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import TypeVar

from pydantic import BaseModel

ParamsT = TypeVar("ParamsT", bound=BaseModel)
ResultT = TypeVar("ResultT", bound=BaseModel)


class RecordingRPCClient:
    def __init__(self, responses: dict[str, object] | None = None) -> None:
        self.responses = responses or {}
        self.calls: list[tuple[str, BaseModel, object]] = []
        self.requests: dict[str, tuple[object, object, object]] = {}
        self.notifications: dict[str, tuple[object, object]] = {}
        self.closed = False

    async def send(
        self,
        method: str,
        params: BaseModel,
        result_model: type[ResultT],
    ) -> ResultT:
        self.calls.append((method, params, result_model))
        response = self.responses[method]
        if isinstance(response, BaseException):
            raise response
        return result_model.model_validate(response, strict=True)

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

    async def close(self, reason: BaseException | None = None) -> None:
        self.closed = True
