from __future__ import annotations

import asyncio

import httpx

from ._generated.models import (
    BrowserbaseHttpResponse,
    BrowserbaseRequestParams,
    BrowserbaseRequestResult,
    BrowserbaseTransportError,
    Operation,
    Reason,
)
from .browserbase_connection import BrowserbaseConnection

_OPERATION_PATHS: dict[Operation, str] = {
    Operation.gateway_responses: "/llm/responses",
    Operation.cache_get: "/cache/get",
    Operation.cache_set: "/cache/set",
}


def _error(reason: Reason, message: str) -> BrowserbaseRequestResult:
    return BrowserbaseRequestResult(
        root=BrowserbaseTransportError(type="error", reason=reason, message=message)
    )


async def execute_browserbase_request(
    connection: BrowserbaseConnection | None,
    params: BrowserbaseRequestParams,
) -> BrowserbaseRequestResult:
    """Execute one HTTP attempt; task cancellation propagates to the RPC owner."""
    # Revalidate mutable header dictionaries at the boundary.
    params = BrowserbaseRequestParams.model_validate_json(
        params.model_dump_json(warnings="none"), strict=True
    )
    if connection is None:
        return _error(Reason.unavailable, "Browserbase connection is unavailable")

    loop = asyncio.get_running_loop()
    deadline = (
        None
        if params.remaining_timeout_ms is None
        else loop.time() + params.remaining_timeout_ms / 1_000
    )
    try:
        headers = httpx.Headers(params.headers, encoding="latin-1")
        headers.setdefault("content-type", "application/json")
        headers["x-bb-api-key"] = connection.api_key
        if params.operation is Operation.gateway_responses:
            headers["x-bb-session-id"] = connection.session_id
            headers.setdefault("authorization", f"Bearer {connection.api_key}")
        request = httpx.Request(
            "POST",
            f"{connection.api_url}{_OPERATION_PATHS[params.operation]}",
            headers=headers,
            content=params.body.encode("utf-8"),
        )
    except (ValueError, httpx.InvalidURL):
        raise TypeError("Invalid Browserbase HTTP request") from None

    if deadline is not None and deadline <= loop.time():
        return _error(Reason.timeout, "Browserbase request timed out")
    budget = asyncio.timeout_at(deadline)
    try:
        async with budget:
            async with httpx.AsyncClient(timeout=None, follow_redirects=False) as client:
                response = await client.send(request)
                response_headers = dict(response.headers)
                # httpx decodes transfer bytes; these headers no longer describe the body.
                response_headers.pop("content-encoding", None)
                response_headers.pop("content-length", None)
                return BrowserbaseRequestResult(
                    root=BrowserbaseHttpResponse(
                        type="response",
                        status=response.status_code,
                        status_text=response.reason_phrase,
                        headers=response_headers,
                        # Match fetch text decoding, including BOM removal and invalid bytes.
                        body=response.content.decode("utf-8-sig", errors="replace"),
                    )
                )
    except TimeoutError:
        if not budget.expired():
            raise
        return _error(Reason.timeout, "Browserbase request timed out")
    except (httpx.InvalidURL, httpx.LocalProtocolError, httpx.UnsupportedProtocol):
        raise TypeError("Invalid Browserbase HTTP request") from None
    except httpx.RequestError:
        return _error(Reason.network, "Browserbase HTTP request failed")
