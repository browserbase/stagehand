from __future__ import annotations

import copy
import hashlib
import json
from functools import cache
from importlib.resources import files
from typing import Any, Literal

ToolSet = Literal["playwright", "legacy", "explicitSnapshotActions"]


class StagehandFacadeBundleError(Exception):
    """The bundle's content does not match its ``sha256``."""


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def parse_bundle(text: str) -> dict[str, Any]:
    bundle = json.loads(text)
    content = {"sources": bundle.get("sources"), "contract": bundle.get("contract")}
    digest = hashlib.sha256(canonical_json(content).encode("utf-8")).hexdigest()
    if digest != bundle.get("sha256"):
        raise StagehandFacadeBundleError(
            f"Facade bundle content does not match its sha256 (expected {bundle.get('sha256')}, "
            f"computed {digest}); reinstall stagehand-middleware or re-sync _bundle.json."
        )
    return bundle


@cache
def _bundle() -> dict[str, Any]:
    return parse_bundle(
        files("stagehand_middleware.facade").joinpath("_bundle.json").read_text(encoding="utf-8")
    )


def facade_bundle() -> dict[str, Any]:
    """A copy of the vendored, checksum-verified bundle. Changing it does not affect
    the host, which keeps using its own copy."""
    return copy.deepcopy(_bundle())


def facade_tools(tool_set: ToolSet = "playwright") -> list[dict[str, Any]]:
    """The tools/list entries (name, description, inputSchema) of a tool set.

    ``playwright`` is the default surface, ``legacy`` the earlier run description,
    and ``explicitSnapshotActions`` the wording the TypeScript facade uses with
    ``EXPLICIT_SNAPSHOT_ACTIONS=1``.
    """
    return copy.deepcopy(_bundle()["contract"]["tools"][tool_set])


def facade_instructions(tool_set: ToolSet = "playwright") -> str:
    """The agent instructions for a tool set, for the agent's system prompt.

    They are what the TypeScript hosts send with the same tool set; the MCP server
    itself sends no instructions.
    """
    instructions: str = _bundle()["contract"]["instructions"][tool_set]
    return instructions


def contract_error(key: str, **params: str) -> str:
    """A message from ``contract.errors`` with its ``${name}`` placeholders filled."""
    message: str = _bundle()["contract"]["errors"][key]
    for name, value in params.items():
        message = message.replace(f"${{{name}}}", value, 1)
    return message
