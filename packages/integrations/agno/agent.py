import asyncio
import base64
import json
import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

from agno.agent import Agent
from agno.media import Image
from agno.models.openai import OpenAIChat
from agno.tools.function import Function, ToolResult
from jsonschema import ValidationError, validate
from stagehand import Stagehand, browserbase, local_browser
from stagehand_middleware.facade import StagehandFacadeTools, facade_instructions, facade_tools


def browser_tools(facade: StagehandFacadeTools) -> list[Function]:
    async def run(**arguments: object) -> str:
        result = await facade.run(**arguments)
        return result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)

    async def snapshot(includeIframes: bool = True) -> str:
        return await facade.snapshot(include_iframes=includeIframes)

    async def screenshot(
        fullPage: bool | None = None,
        type: Literal["png", "jpeg"] = "png",
        quality: float | None = None,
    ) -> ToolResult:
        image = await facade.screenshot(full_page=fullPage, type=type, quality=quality)
        return ToolResult(
            content="Screenshot captured.",
            images=[Image(content=base64.b64decode(image["data"]), mime_type=image["mimeType"])],
        )

    functions = {"run": run, "snapshot": snapshot, "screenshot": screenshot}

    def make_tool(definition: dict[str, Any]) -> Function:
        function = functions[definition["name"]]
        schema = definition["inputSchema"]

        async def call(**arguments: object) -> object:
            # Keep validation when bypassing Agno's signature-based schema generation.
            try:
                validate(arguments, schema)
            except ValidationError as error:
                raise ValueError(error.message) from None
            return await function(**arguments)

        return Function(
            name=definition["name"],
            description=definition["description"],
            parameters=schema,
            entrypoint=call,
            skip_entrypoint_processing=True,
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


def build_agent(facade: StagehandFacadeTools) -> Agent:
    return Agent(
        model=OpenAIChat(
            id=os.environ.get("AGNO_MODEL", "gpt-6-luna"),
            base_url=os.environ.get("OPENAI_BASE_URL"),
            request_params={"parallel_tool_calls": False},
        ),
        tools=browser_tools(facade),
        instructions=facade_instructions(),
        markdown=True,
    )


async def run_agent(instruction: str) -> None:
    async with browser_session() as facade:
        await build_agent(facade).aprint_response(instruction, stream=True)


def main() -> None:
    instruction = " ".join(sys.argv[1:]).strip()
    if not instruction:
        print(f'Usage: {Path(sys.argv[0]).name} "your instruction"', file=sys.stderr)
        raise SystemExit(2)
    asyncio.run(run_agent(instruction))


if __name__ == "__main__":
    main()
