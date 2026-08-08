from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from typing import Any

from deepagents import create_deep_agent
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.tools import load_mcp_tools

from mcp import ClientSession

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
MODAL_STDIO_BRIDGE_PATH = (
    REPOSITORY_ROOT / "packages/integrations/examples/shared/modal_stdio_bridge.py"
)
SKILL_PATH = REPOSITORY_ROOT / "packages/integrations/codemode/SKILL.md"
DEFAULT_STAGEHAND_MODEL = "openai:gpt-5-mini"

BRIDGE_ENV_KEYS = (
    "PATH",
    "HOME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
    "MODAL_TOKEN_ID",
    "MODAL_TOKEN_SECRET",
    "MODAL_PROFILE",
    "BROWSERBASE_API_KEY",
    "BROWSERBASE_PROJECT_ID",
    "STAGEHAND_MODEL_NAME",
    "STAGEHAND_MODEL_API_KEY",
    "STAGEHAND_CODEMODE_IMAGE",
    "STAGEHAND_CODEMODE_MODAL_IMAGE_ID",
    "STAGEHAND_CODEMODE_MODAL_APP",
    "STAGEHAND_CODEMODE_ENTRYPOINT",
    "STAGEHAND_CODEMODE_TIMEOUT_SECONDS",
    "STAGEHAND_CODEMODE_IDLE_TIMEOUT_SECONDS",
    "STAGEHAND_CODEMODE_OUTBOUND_DOMAINS",
)


@lru_cache(maxsize=1)
def load_stagehand_codemode_skill() -> str:
    return SKILL_PATH.read_text(encoding="utf-8").strip()


def modal_bridge_env(overrides: Mapping[str, str] | None = None) -> dict[str, str]:
    """Merge proxy overrides without inheriting host model credentials."""
    child_env = {
        key: value for key in BRIDGE_ENV_KEYS if (value := os.environ.get(key)) is not None
    }
    if overrides:
        child_env.update({key: value for key, value in overrides.items() if key in BRIDGE_ENV_KEYS})
    return child_env


def create_stagehand_mcp_client(
    env: Mapping[str, str] | None = None,
) -> MultiServerMCPClient:
    """Create a stdio client for the trusted Modal sandbox bridge."""
    if not MODAL_STDIO_BRIDGE_PATH.is_file():
        raise FileNotFoundError(
            f"Stagehand Modal stdio bridge not found: {MODAL_STDIO_BRIDGE_PATH}"
        )

    return MultiServerMCPClient(
        {
            "stagehand": {
                "transport": "stdio",
                "command": sys.executable,
                "args": [str(MODAL_STDIO_BRIDGE_PATH)],
                "env": modal_bridge_env(env),
            }
        },
        tool_name_prefix=False,
        handle_tool_errors=True,
    )


async def load_stagehand_code_tool(session: ClientSession) -> Any:
    """Discover the one canonical tool without creating another MCP session."""
    tools = await load_mcp_tools(session)
    tool_names = [tool.name for tool in tools]
    if tool_names != ["code_execute"]:
        raise RuntimeError(f"Expected exactly code_execute, got {tool_names}")
    return tools[0]


async def run_stagehand_agent(
    prompt: str,
    model: str | Any = DEFAULT_STAGEHAND_MODEL,
) -> dict[str, Any]:
    client = create_stagehand_mcp_client()

    # Keep discovery, agent construction, and the complete invocation inside one
    # explicit session. A convenience get_tools() call would create fresh stdio
    # sessions and discard Stagehand browser state between tool calls.
    async with client.session("stagehand") as session:
        code_tool = await load_stagehand_code_tool(session)
        agent = create_deep_agent(
            model=model,
            tools=[code_tool],
            system_prompt=load_stagehand_codemode_skill(),
        )
        return await agent.ainvoke(
            {"messages": [{"role": "user", "content": prompt}]},
            config={"recursion_limit": 20},
        )


def _last_message_text(result: dict[str, Any]) -> str:
    messages = result.get("messages", [])
    if not messages:
        return str(result)
    content = getattr(messages[-1], "content", messages[-1])
    return content if isinstance(content, str) else str(content)


async def _main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(f'Usage: {Path(sys.argv[0]).name} "<browser task>"')
    prompt = " ".join(sys.argv[1:])
    model = os.environ.get("STAGEHAND_LANGCHAIN_MODEL", DEFAULT_STAGEHAND_MODEL)
    result = await run_stagehand_agent(prompt, model=model)
    print(_last_message_text(result))


if __name__ == "__main__":
    asyncio.run(_main())
