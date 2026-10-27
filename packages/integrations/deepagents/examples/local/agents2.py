from __future__ import annotations

import asyncio

import dotenv
from deepagents import create_deep_agent
from pydantic import BaseModel, ConfigDict, Field
from stagehand_deepagents import StagehandMiddleware

dotenv.load_dotenv()


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

    agent = create_deep_agent(
        model=model,
        middleware=[StagehandMiddleware()],
        response_format=response_format,
    )
    result = await agent.ainvoke({"messages": [{"role": "user", "content": instruction}]})
    response: FormFillResult = result["structured_response"]

    print(response.model_dump_json(indent=2))


if __name__ == "__main__":
    asyncio.run(main())
