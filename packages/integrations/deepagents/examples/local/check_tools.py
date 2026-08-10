from __future__ import annotations

import asyncio

from _client import SERVER_NAME, create_stagehand_client
from langchain_mcp_adapters.tools import load_mcp_tools


async def main() -> None:
    client = create_stagehand_client()
    async with client.session(SERVER_NAME) as session:
        tools = await load_mcp_tools(session)
        print([tool.name for tool in tools])


if __name__ == "__main__":
    asyncio.run(main())
