"""Stagehand Python SDK stubs.

This package mirrors the thin-client TypeScript SDK so downstream projects can
begin integrating before the real Python implementation lands.
"""

from .client import StagehandClient, StagehandClientConfig, StagehandSDKNotImplementedError
from .runtime import (
    AISdkClient,
    AgentProvider,
    ConsoleMessage,
    LLMClient,
    Response,
    Stagehand,
    V3,
    V3Evaluator,
    connectToMCPServer,
)
from . import constants as _constants
from . import errors as _errors
from . import types as _types
from .constants import *  # noqa: F401,F403
from .errors import *  # noqa: F401,F403
from .types import *  # noqa: F401,F403

__all__ = [
    "StagehandClient",
    "StagehandClientConfig",
    "StagehandSDKNotImplementedError",
    "ConsoleMessage",
    "Response",
    "LLMClient",
    "AISdkClient",
    "AgentProvider",
    "V3Evaluator",
    "connectToMCPServer",
    "Stagehand",
    "V3",
]
__all__ += list(getattr(_errors, "__all__", []))
__all__ += list(getattr(_constants, "__all__", []))
__all__ += list(getattr(_types, "__all__", []))

errors = _errors
constants = _constants
types = _types
