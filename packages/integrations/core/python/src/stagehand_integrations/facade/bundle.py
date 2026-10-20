"""The facade bundle: the browser-side sources and model-facing contract of the facade.

`_bundle.json` is a copy of `dist/facade-bundle.json` from
`@browserbasehq/stagehand-integrations` (see `src/facade/bundle.ts` there for
its shape). The TypeScript facade sends the same sources and advertises the
same tools.
"""

from __future__ import annotations

import copy
import json
from functools import cache
from importlib.resources import files
from typing import Any, Literal

ToolSet = Literal["playwright", "legacy", "explicitSnapshotActions"]


@cache
def facade_bundle() -> dict[str, Any]:
    """The vendored bundle, parsed once. Treat it as read-only."""
    return json.loads(
        files("stagehand_integrations.facade").joinpath("_bundle.json").read_text(encoding="utf-8")
    )


def facade_tools(tool_set: ToolSet = "playwright") -> list[dict[str, Any]]:
    """The tools/list entries (name, description, inputSchema) of a tool set.

    ``playwright`` is the default surface, ``legacy`` the earlier run description,
    and ``explicitSnapshotActions`` the wording the TypeScript facade uses with
    ``EXPLICIT_SNAPSHOT_ACTIONS=1``.
    """
    return copy.deepcopy(facade_bundle()["contract"]["tools"][tool_set])


def contract_error(key: str, **params: str) -> str:
    """A message from ``contract.errors`` with its ``${name}`` placeholders filled."""
    message: str = facade_bundle()["contract"]["errors"][key]
    for name, value in params.items():
        message = message.replace(f"${{{name}}}", value, 1)
    return message
