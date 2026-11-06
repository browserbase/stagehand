from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import httpx

from ._generated.models import (
    BrowserbaseCancelParams,
    BrowserbaseRequestParams,
    BrowserbaseRequestResult,
    BrowserbaseTransportError,
    Reason,
)
from .browserbase_connection import BrowserbaseConnection
from .browserbase_transport import execute_browserbase_request
from .rpc_client import RPCClient, RPCRequestContext


@dataclass
class _PendingRequest:
    task: asyncio.Task[BrowserbaseRequestResult]
    reason: Reason | None = None

    def cancel(self, reason: Reason) -> None:
        if self.reason is None and not self.task.done():
            self.reason = reason
            self.task.cancel()


def register_browserbase_transport(
    client: RPCClient,
    connection: BrowserbaseConnection | None,
) -> Callable[[], Awaitable[None]]:
    """Install Browserbase handlers on one RPC connection; return async disposal."""
    pending: dict[int, _PendingRequest] = {}
    disposal: asyncio.Task[None] | None = None
    http_client: httpx.AsyncClient | None = None

    async def handle(
        params: BrowserbaseRequestParams, context: RPCRequestContext
    ) -> BrowserbaseRequestResult:
        nonlocal http_client
        if disposal is not None:
            raise RuntimeError("Browserbase transport is disposed")
        if context.request_id in pending:
            raise RuntimeError("Browserbase request ID is already in use")
        if http_client is None and connection is not None:
            http_client = httpx.AsyncClient(timeout=None, follow_redirects=False)
        request = _PendingRequest(
            asyncio.create_task(
                execute_browserbase_request(connection, params, http_client=http_client)
            )
        )
        pending[context.request_id] = request
        try:
            return await request.task
        except asyncio.CancelledError:
            owner = asyncio.current_task()
            # Connection close cancels the owner; only explicit HTTP cancellation becomes a result.
            if request.reason is None or (owner is not None and owner.cancelling()):
                raise
            return BrowserbaseRequestResult(
                root=BrowserbaseTransportError(
                    type="error",
                    reason=request.reason,
                    message=(
                        "Browserbase request timed out"
                        if request.reason is Reason.timeout
                        else "Browserbase request cancelled"
                    ),
                )
            )
        finally:
            pending.pop(context.request_id, None)

    def cancel(params: BrowserbaseCancelParams) -> None:
        request = pending.get(params.request_id.root)
        if request is not None:
            request.cancel(Reason(params.reason.value))

    remove_request = client.on_request_with_context(
        "browserbase.request", BrowserbaseRequestParams, BrowserbaseRequestResult, handle
    )
    try:
        remove_notification = client.on_notification(
            "browserbase.cancel", BrowserbaseCancelParams, cancel
        )
    except Exception:
        remove_request()
        raise

    async def cleanup() -> None:
        requests = list(pending.values())
        for request in requests:
            request.cancel(Reason.cancelled)
        try:
            await asyncio.gather(*(request.task for request in requests), return_exceptions=True)
        finally:
            if http_client is not None:
                await http_client.aclose()

    async def dispose() -> None:
        nonlocal disposal
        if disposal is None:
            remove_request()
            remove_notification()
            remove_close()
            disposal = asyncio.create_task(cleanup())
        await asyncio.shield(disposal)

    remove_close = client.on_close(dispose)
    return dispose
