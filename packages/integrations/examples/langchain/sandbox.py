"""Expose the shared Vercel Sandbox lease from the LangChain example directory."""

from __future__ import annotations

import sys
from pathlib import Path

SHARED_EXAMPLES_DIRECTORY = Path(__file__).resolve().parents[1] / "shared"
sys.path.insert(0, str(SHARED_EXAMPLES_DIRECTORY))

from vercel_sandbox_lease import (  # noqa: E402
    StagehandSandboxConnection,
    StagehandSandboxLease,
    StagehandSandboxLeaseError,
)

__all__ = [
    "StagehandSandboxConnection",
    "StagehandSandboxLease",
    "StagehandSandboxLeaseError",
]
