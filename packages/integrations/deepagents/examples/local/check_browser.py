from __future__ import annotations

import asyncio
import re

from _client import SERVER_NAME, create_stagehand_client
from langchain_mcp_adapters.tools import load_mcp_tools


async def main() -> None:
    client = create_stagehand_client()
    async with client.session(SERVER_NAME) as session:
        tools = {tool.name: tool for tool in await load_mcp_tools(session)}
        run_result = await tools["run"].ainvoke(
            {
                "code": """
const html = `<title>Stagehand MCP</title><button id="go"
  onclick="document.body.dataset.clicked='yes'">Continue</button>`;
await page.goto('data:text/html,' + encodeURIComponent(html));
return { title: await page.title(), buttons: await page.locator('button').count() };
"""
            }
        )
        print("run:", run_result)

        snapshot_result = await tools["snapshot"].ainvoke({})
        print("snapshot:", snapshot_result)
        match = re.search(r"\[([^\]]+)]\s+button", str(snapshot_result), re.IGNORECASE)
        if match is None:
            raise RuntimeError("button ID not found in snapshot")
        action_result = await tools["run"].ainvoke(
            {"actions": [{"op": "click", "id": match.group(1)}]}
        )
        print("action:", action_result)

        screenshot_result = await tools["screenshot"].ainvoke({})
        print("screenshot content blocks:", len(screenshot_result))


if __name__ == "__main__":
    asyncio.run(main())
