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

Navigate to the requested form, take a snapshot, identify the requested fields, and fill them with
the supplied mock data. Prefer one batched run actions call after taking the snapshot. Do not submit
the form unless explicitly asked.
"""


class FilledField(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str = Field(description="The form field that was filled")
    value: str = Field(description="The mock value entered into the field")


class FormFillResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(description="The final page URL")
    fields: list[FilledField] = Field(description="The fields successfully filled")
    completed: bool = Field(description="Whether all requested fields were filled")


async def main() -> None:
    model = "openai:gpt-5.6-luna"
    instruction = """Navigate to https://file.1040.com/estimate/ and wait for it to load. Fill the
form with this mock data:
- age: 26
- dependents under age 17: 1
- wages / W-2 Box 1: 54321
- federal tax / Box 2: 8345
- state tax / Box 17: 2222

and then every other field with data of your choice.

Do not submit the form. Return a summary of the fields you successfully filled."""
    response_format = FormFillResult

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
        response: FormFillResult = result["structured_response"]

    print(response.model_dump_json(indent=2))


if __name__ == "__main__":
    asyncio.run(main())
