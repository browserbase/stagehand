from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from functools import wraps
from typing import ParamSpec, TypeVar

STAGEHAND_INIT_TIMEOUT_MS = 60_000

P = ParamSpec("P")
T = TypeVar("T")


async def with_stagehand_init_deadline(operation: Awaitable[T]) -> T:
    deadline = asyncio.timeout(STAGEHAND_INIT_TIMEOUT_MS / 1_000)
    try:
        async with deadline:
            return await operation
    except TimeoutError as error:
        if deadline.expired():
            raise TimeoutError(
                f"Stagehand initialization timed out after {STAGEHAND_INIT_TIMEOUT_MS}ms"
            ) from error
        raise


def stagehand_init_deadline(
    operation: Callable[P, Awaitable[T]],
) -> Callable[P, Awaitable[T]]:
    @wraps(operation)
    async def bounded(*args: P.args, **kwargs: P.kwargs) -> T:
        return await with_stagehand_init_deadline(operation(*args, **kwargs))

    return bounded
