"""Shared MCP client config for the local Deep Agents examples.

The MCP stdio client strips the parent environment down to a safe default
set (HOME, PATH, SHELL, TERM, USER), so the server would never see
STAGEHAND_* / BROWSERBASE_* configuration without an explicit env block.
Every script in this example builds its client here so the allowlist can't
regress in one copy.
"""

from __future__ import annotations

import os
from pathlib import Path

from langchain_mcp_adapters.client import MultiServerMCPClient

SERVER_NAME = "stagehand_browser"

_SERVER_PROJECT = Path(__file__).resolve().parents[2]


def _allowlisted_env() -> dict[str, str]:
    """Forward only STAGEHAND_* and BROWSERBASE_* variables to the server."""
    return {
        name: value
        for name, value in os.environ.items()
        if (name.startswith("STAGEHAND_") or name.startswith("BROWSERBASE_")) and value
    }


def create_stagehand_client() -> MultiServerMCPClient:
    return MultiServerMCPClient(
        {
            SERVER_NAME: {
                "transport": "stdio",
                "command": "uv",
                "args": [
                    "run",
                    "--project",
                    str(_SERVER_PROJECT),
                    "--locked",
                    "stagehand-deepagents-mcp",
                ],
                "env": _allowlisted_env(),
            }
        }
    )
