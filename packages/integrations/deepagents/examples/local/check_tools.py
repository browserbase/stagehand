from __future__ import annotations

import asyncio
from pathlib import Path

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.tools import load_mcp_tools


async def main() -> None:
    server_project = Path(__file__).resolve().parents[2]
    client = MultiServerMCPClient(
        {
            "stagehand_browser": {
                "transport": "stdio",
                "command": "uv",
                "args": [
                    "run",
                    "--project",
                    str(server_project),
                    "--locked",
                    "stagehand-deepagents-mcp",
                ],
            }
        }
    )
    async with client.session("stagehand_browser") as session:
        tools = await load_mcp_tools(session)
        print([tool.name for tool in tools])


if __name__ == "__main__":
    asyncio.run(main())
