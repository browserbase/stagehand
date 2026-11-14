import argparse
import asyncio
import base64
import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

from jsonschema import ValidationError, validate
from pydantic import BaseModel, Field
from pydantic_ai import Agent, BinaryContent, ModelRetry, Tool
from pydantic_ai.toolsets import FunctionToolset
from stagehand import Stagehand, browserbase, local_browser
from stagehand_middleware.facade import (
    StagehandFacadeExecutionError,
    StagehandFacadeInputError,
    StagehandFacadeTools,
    facade_instructions,
    facade_tools,
)


class PageReport(BaseModel):
    title: str = Field(description="The document title of the active page")
    url: str = Field(description="The URL of the active page")
    notes: str = Field(description="A short description of what the agent observed")


def browser_tools(facade: StagehandFacadeTools) -> list[Tool[None]]:
    async def snapshot(includeIframes: bool = True) -> str:
        return await facade.snapshot(include_iframes=includeIframes)

    async def screenshot(
        fullPage: bool | None = None,
        type: Literal["png", "jpeg"] = "png",
        quality: float | None = None,
    ) -> BinaryContent:
        image = await facade.screenshot(full_page=fullPage, type=type, quality=quality)
        return BinaryContent(data=base64.b64decode(image["data"]), media_type=image["mimeType"])

    functions = {"run": facade.run, "snapshot": snapshot, "screenshot": screenshot}

    def make_tool(definition: dict[str, Any]) -> Tool[None]:
        function = functions[definition["name"]]
        schema = definition["inputSchema"]

        async def call(**arguments: object) -> object:
            # from_schema advertises the schema but does not validate arguments.
            try:
                validate(arguments, schema)
            except ValidationError as error:
                raise ModelRetry(error.message) from None
            try:
                return await function(**arguments)
            except (StagehandFacadeInputError, StagehandFacadeExecutionError) as error:
                raise ModelRetry(str(error)) from None

        return Tool.from_schema(
            call,
            name=definition["name"],
            description=definition["description"],
            json_schema=schema,
            sequential=True,
        )

    return [make_tool(definition) for definition in facade_tools()]


@asynccontextmanager
async def browser_session() -> AsyncIterator[StagehandFacadeTools]:
    provider = os.environ.get(
        "STAGEHAND_BROWSER", "browserbase" if os.environ.get("BROWSERBASE_API_KEY") else "local"
    ).lower()
    if provider not in {"local", "browserbase"}:
        raise ValueError("STAGEHAND_BROWSER must be 'local' or 'browserbase'")
    if provider == "browserbase":
        api_key = os.environ.get("BROWSERBASE_API_KEY")
        if not api_key:
            raise ValueError("BROWSERBASE_API_KEY is required for Browserbase")
        browser = await browserbase.launch(api_key=api_key)
    else:
        headless = os.environ.get("STAGEHAND_HEADLESS", "false").lower() in {"1", "true", "yes"}
        browser = await local_browser.launch(headless=headless)
    try:
        stagehand = await Stagehand.create(
            browser=browser,
            model=os.environ.get("STAGEHAND_MODEL") or None,
            model_api_key=os.environ.get("STAGEHAND_MODEL_API_KEY") or None,
        )
    except BaseException:
        await browser.close()
        raise

    facade = StagehandFacadeTools(stagehand)
    try:
        yield facade
    finally:
        await facade.close()


def default_model() -> str:
    return os.environ.get("PYDANTIC_AI_MODEL", "openai:gpt-6-sol")


def build_agent(
    *,
    structured: bool,
    model: str | None = None,
) -> Agent[None, str] | Agent[None, PageReport]:
    resolved_model = model if model is not None else default_model()
    if structured:
        return Agent(
            resolved_model,
            name="stagehand_browser_agent",
            instructions=facade_instructions(),
            output_type=PageReport,
        )
    return Agent(
        resolved_model,
        name="stagehand_browser_agent",
        instructions=facade_instructions(),
    )


async def run_instruction(instruction: str, *, structured: bool) -> str | PageReport:
    agent = build_agent(structured=structured)
    async with browser_session() as facade:
        with Agent.parallel_tool_call_execution_mode("sequential"):
            result = await agent.run(instruction, toolsets=[FunctionToolset(browser_tools(facade))])
    return result.output


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run a Pydantic AI agent with Stagehand browser middleware."
    )
    parser.add_argument("instruction", nargs="+", help="Browser task for the agent")
    parser.add_argument(
        "--structured",
        action="store_true",
        help="Return a PageReport model instead of plain text",
    )
    args = parser.parse_args()
    instruction = " ".join(args.instruction).strip()
    if not instruction:
        print(f'Usage: {Path(sys.argv[0]).name} "your instruction"', file=sys.stderr)
        raise SystemExit(2)

    output = asyncio.run(run_instruction(instruction, structured=args.structured))
    print(output)


if __name__ == "__main__":
    main()
