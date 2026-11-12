from __future__ import annotations

import asyncio
import inspect
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from ._generated.models import (
    DecisionCancelParams,
    DecisionChooseParams,
    DecisionChooseResult,
    DecisionSelectedResult,
)
from .decision_context import DecisionContext
from .rpc_client import RPCClient, RPCRequestContext


@dataclass
class _PendingDecision:
    task: asyncio.Task[DecisionChooseResult]
    stopped: asyncio.Future[None]
    error: Exception | None = None

    def cancel(self, error: Exception) -> None:
        if self.error is None:
            self.error = error
            self.stopped.set_result(None)
            self.task.cancel()


def _observe_result(task: asyncio.Task[DecisionChooseResult]) -> None:
    # A callback may suppress cancellation; never deliver its late result.
    if not task.cancelled():
        task.exception()


def register_decision_handler(
    client: RPCClient,
    choose: Callable[
        [DecisionChooseParams, DecisionContext],
        DecisionChooseResult | Awaitable[DecisionChooseResult],
    ],
) -> Callable[[], None]:
    """Internal registration boundary; Stagehand owns configuration and teardown."""
    pending: dict[int, _PendingDecision] = {}

    async def handle(
        params: DecisionChooseParams, context: RPCRequestContext
    ) -> DecisionChooseResult:
        if context.request_id in pending:
            raise RuntimeError("Decision request ID is already in use")
        ids = {candidate.id for candidate in params.candidates}
        loop = asyncio.get_running_loop()
        deadline = (
            float("inf") if params.timeout_ms is None else loop.time() + params.timeout_ms / 1000
        )
        callback_context = DecisionContext(context.request_id, deadline)

        async def invoke() -> DecisionChooseResult:
            if callback_context.remaining_ms() == 0:
                raise TimeoutError("Decision timed out")
            result = choose(params, callback_context)
            if inspect.isawaitable(result):
                result = await result
            return DecisionChooseResult.model_validate(result)

        request = _PendingDecision(asyncio.create_task(invoke()), loop.create_future())
        request.task.add_done_callback(_observe_result)
        pending[context.request_id] = request
        timer = (
            None
            if params.timeout_ms is None
            else loop.call_at(deadline, request.cancel, TimeoutError("Decision timed out"))
        )
        try:
            await asyncio.wait((request.task, request.stopped), return_when=asyncio.FIRST_COMPLETED)
            if request.error is not None:
                raise request.error
            if callback_context.remaining_ms() == 0:
                raise TimeoutError("Decision timed out")
            result = request.task.result()
            if isinstance(result.root, DecisionSelectedResult) and result.root.id not in ids:
                raise ValueError("Decision selected an ID outside the supplied candidates")
            return result
        finally:
            if timer is not None:
                timer.cancel()
            pending.pop(context.request_id, None)
            if not request.task.done() and not request.task.cancelling():
                request.task.cancel()

    def cancel(params: DecisionCancelParams) -> None:
        request = pending.get(params.request_id.root)
        if request is not None:
            request.cancel(
                TimeoutError("Decision timed out")
                if params.reason.value == "timeout"
                else RuntimeError("Decision cancelled")
            )

    remove_request = client.on_request_with_context(
        "decision.choose", DecisionChooseParams, DecisionChooseResult, handle
    )
    remove_notification = client.on_notification("decision.cancel", DecisionCancelParams, cancel)

    def remove() -> None:
        remove_request()
        remove_notification()
        for request in pending.values():
            request.cancel(RuntimeError("Decision handler removed"))
        pending.clear()

    return remove
