from __future__ import annotations

import asyncio

import dotenv
from deepagents import create_deep_agent
from langchain_stagehand import StagehandMiddleware
from pydantic import BaseModel, ConfigDict, Field
from stagehand import Stagehand, local_browser

dotenv.load_dotenv()


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

    # For Browserbase, use browserbase.launch(api_key=os.environ["BROWSERBASE_API_KEY"]).
    browser = await local_browser.launch(headless=False)
    try:
        stagehand = await Stagehand.create(browser=browser)
        agent = create_deep_agent(
            model=model,
            middleware=[StagehandMiddleware(stagehand=stagehand)],
            response_format=response_format,
        )
        result = await agent.ainvoke({"messages": [{"role": "user", "content": instruction}]})
    finally:
        await browser.close()

    if response_format is not None:
        response = result["structured_response"]
        print(response.model_dump_json(indent=2))
        return
    print(result["messages"][-1].content)


if __name__ == "__main__":
    asyncio.run(main())
