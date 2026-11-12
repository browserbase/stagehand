from __future__ import annotations

import asyncio
from dataclasses import dataclass


@dataclass(frozen=True)
class DecisionContext:
    """Local callback budget. Cancellation is delivered as asyncio.CancelledError."""

    request_id: int
    _deadline: float

    def remaining_ms(self) -> float:
        """Remaining milliseconds, or infinity for an operation without a deadline."""
        return max(0.0, (self._deadline - asyncio.get_running_loop().time()) * 1000)
