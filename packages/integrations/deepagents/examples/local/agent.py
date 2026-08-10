from __future__ import annotations

import asyncio
from pathlib import Path

import dotenv
from deepagents import create_deep_agent
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.tools import load_mcp_tools
from pydantic import BaseModel, ConfigDict, Field

dotenv.load_dotenv()

BROWSER_INSTRUCTIONS = """You control one persistent browser through exactly three tools:
- snapshot: inspect the active page and hydrate bracketed element IDs.
- run: provide either snapshot actions or JavaScript using the Playwright-shaped page API.
- screenshot: inspect the rendered page visually.

Use snapshot actions for simple interactions and run code for multi-step workflows. Snapshot IDs are
valid only for the latest snapshot of the active page. Snapshot again after navigation or stale IDs.
Do not launch another browser.
"""


class SportsEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(description="The name of the event")
    sport: str = Field(description="The sport being played")
    summary: str = Field(description="A concise summary of the event")
    source_url: str = Field(description="The source URL for the event information")


class SportsSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    events: list[SportsEvent] = Field(description="The day's main sporting events")


async def main() -> None:
    model = "openai:gpt-5.6-luna"
    instruction = "Go find me a summary of all main sports events today"
    response_format = SportsSummary

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
        agent = create_deep_agent(
            model=model,
            tools=tools,
            system_prompt=BROWSER_INSTRUCTIONS,
            response_format=response_format,
        )
        result = await agent.ainvoke({"messages": [{"role": "user", "content": instruction}]})

    if response_format is not None:
        response = result["structured_response"]
        print(response.model_dump_json(indent=2))
        return
    print(result["messages"][-1].content)


if __name__ == "__main__":
    asyncio.run(main())
