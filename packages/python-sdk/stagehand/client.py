"""Stagehand Python SDK client stubs."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Dict, Optional


class StagehandSDKNotImplementedError(NotImplementedError):
    """Raised when a stubbed method has not been implemented yet."""

    def __init__(self, method: str) -> None:
        super().__init__(f"Stagehand SDK stub: {method} is not implemented yet.")
        self.method = method


@dataclass
class StagehandClientConfig:
    """Thin configuration container used to instantiate the SDK client."""

    api_key: Optional[str] = None
    """Stagehand API key. Defaults to reading from the environment in the real client."""

    base_url: str = "https://api.stagehand.dev"
    """Base API endpoint that requests should target."""


class StagehandClient:
    """Stubbed Python mirror of the Stagehand TypeScript SDK."""

    def __init__(self, config: Optional[StagehandClientConfig] = None, /, **overrides: Any) -> None:
        self.config = config or StagehandClientConfig()
        if overrides:
            # Allow ergonomic overrides without touching the dataclass for every experiment.
            merged = {**asdict(self.config), **overrides}
            self.config = StagehandClientConfig(**merged)

    def act(self, action: str, *, agent: Optional[str] = None, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Request the Stagehand agent to execute a single high-level action.

        This mirrors the `act` method in the TypeScript SDK: it eventually sends a
        command to the Stagehand service, waits for agent execution, and returns
        the structured result. The Python stub simply documents the expected
        shape and raises to remind callers that the real implementation is pending.
        """

        raise StagehandSDKNotImplementedError("StagehandClient.act")
