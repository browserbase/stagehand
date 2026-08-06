from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from deepagents import create_deep_agent
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.tools import load_mcp_tools
from mcp import ClientSession

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
STDIO_SERVER_PATH = (
    REPOSITORY_ROOT / "packages/integrations/dist/codemode/stdio-server.mjs"
)
SKILL_PATH = REPOSITORY_ROOT / "packages/integrations/codemode/SKILL.md"
STAGEHAND_CODEMODE_SKILL = SKILL_PATH.read_text(encoding="utf-8").strip()


def create_stagehand_mcp_client(
    env: Mapping[str, str] | None = None,
) -> MultiServerMCPClient:
    """Create a client that forwards Stagehand local/Browserbase configuration."""
    if not STDIO_SERVER_PATH.is_file():
        raise RuntimeError(
            "Build the Stagehand integrations package before running this example: "
            "pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations"
        )

    child_env = dict(os.environ if env is None else env)
    return MultiServerMCPClient(
        {
            "stagehand": {
                "transport": "stdio",
                "command": "node",
                "args": [str(STDIO_SERVER_PATH)],
                "env": child_env,
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
    model: str | Any = "openai:gpt-5-mini",
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
            system_prompt=STAGEHAND_CODEMODE_SKILL,
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
    model = os.environ.get("STAGEHAND_LANGCHAIN_MODEL", "openai:gpt-5-mini")
    result = await run_stagehand_agent(prompt, model=model)
    print(_last_message_text(result))


if __name__ == "__main__":
    asyncio.run(_main())
