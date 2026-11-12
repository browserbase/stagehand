from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable

from ._generated.models import (
    DecisionChooseParams,
    DecisionChooseResult,
    DecisionSelectedResult,
)
from .rpc_client import RPCClient, RPCRequestContext


def register_decision_handler(
    client: RPCClient,
    choose: Callable[
        [DecisionChooseParams, RPCRequestContext],
        DecisionChooseResult | Awaitable[DecisionChooseResult],
    ],
) -> Callable[[], None]:
    """Internal registration boundary; Stagehand owns configuration and teardown."""

    async def handle(
        params: DecisionChooseParams, context: RPCRequestContext
    ) -> DecisionChooseResult:
        # Snapshot IDs before application code can mutate its request object.
        ids = {candidate.id for candidate in params.candidates}
        result = choose(params, context)
        if inspect.isawaitable(result):
            result = await result
        result = DecisionChooseResult.model_validate(result)
        if isinstance(result.root, DecisionSelectedResult) and result.root.id not in ids:
            raise ValueError("Decision selected an ID outside the supplied candidates")
        return result

    return client.on_request_with_context(
        "decision.choose", DecisionChooseParams, DecisionChooseResult, handle
    )
