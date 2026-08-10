import base64
import os
import shutil
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

from crewai import Agent, Crew, Task
from crewai.tools import BaseTool
from crewai_tools.adapters.mcp_adapter import CrewAIToolAdapter
from mcp import StdioServerParameters
from mcp.types import CallToolResult, ContentBlock, ImageContent, TextContent, Tool
from mcpadapt.core import MCPAdapt

FACADE_AGENT_INSTRUCTIONS = (
    "You control one persistent browser through exactly three tools:\n"
    "- snapshot: inspect the active page and hydrate bracketed element IDs.\n"
    "- run: provide either snapshot actions or JavaScript using the Playwright-shaped "
    "page API.\n"
    "- screenshot: inspect the rendered page visually.\n"
    "\n"
    "Use snapshot actions for simple interactions and run code for multi-step workflows. "
    'Pass run exactly one of code or actions; every action uses "op" and "id", never '
    '"kind" or "ref". Snapshot IDs are valid only for the latest snapshot of the active '
    "page; snapshot again after navigation or stale IDs. Do not launch another browser."
)


class ImageSavingToolAdapter(CrewAIToolAdapter):
    """CrewAIToolAdapter drops MCP ImageContent blocks (text-only conversion).

    Wrap the tool callable so image blocks are saved to disk and replaced with
    a text block naming the saved file before the text-only conversion runs.
    """

    def adapt(
        self,
        func: Callable[[dict[str, Any] | None], CallToolResult],
        mcp_tool: Tool,
    ) -> BaseTool:
        def wrapped(arguments: dict[str, Any] | None) -> CallToolResult:
            result = func(arguments)
            new_content: list[ContentBlock] = []
            for block in result.content:
                if not isinstance(block, ImageContent):
                    new_content.append(block)
                    continue

                suffix = {"image/jpeg": ".jpeg", "image/png": ".png"}.get(block.mimeType, ".img")
                image_bytes = base64.b64decode(block.data)
                file_descriptor, path = tempfile.mkstemp(
                    prefix="stagehand-screenshot-", suffix=suffix
                )
                with os.fdopen(file_descriptor, "wb") as screenshot_file:
                    screenshot_file.write(image_bytes)
                new_content.append(TextContent(type="text", text=f"Screenshot saved to {path}."))

            return result.model_copy(update={"content": new_content})

        return super().adapt(wrapped, mcp_tool)


def resolve_server_path() -> Path:
    server_path = (
        Path(__file__).resolve().parent.parent / "core" / "dist" / "facade" / "stdio-server.mjs"
    )
    if not server_path.is_file():
        msg = (
            f"Stagehand facade server not found at {server_path}. Build it from the repository "
            "root first: pnpm exec turbo run build --filter "
            "@browserbasehq/stagehand-integrations"
        )
        raise FileNotFoundError(msg)
    return server_path


def facade_env() -> dict[str, str]:
    # Model-provider credentials (for example, OPENAI_API_KEY) are deliberately not forwarded.
    return {
        name: value
        for name, value in os.environ.items()
        if name.startswith(("STAGEHAND_", "BROWSERBASE_"))
    }


def server_params() -> StdioServerParameters:
    node = shutil.which("node")
    if node is None:
        msg = "Node.js is required to run the Stagehand facade MCP server, but node was not found."
        raise RuntimeError(msg)
    return StdioServerParameters(
        command=node,
        args=[str(resolve_server_path())],
        env=facade_env(),
    )


def facade_session(connect_timeout: int = 30) -> MCPAdapt:
    return MCPAdapt(server_params(), ImageSavingToolAdapter(), connect_timeout)


def main() -> None:
    instruction = " ".join(sys.argv[1:]).strip()
    if not instruction:
        print(f'Usage: {Path(sys.argv[0]).name} "your instruction"', file=sys.stderr)
        raise SystemExit(2)

    model = os.environ.get("CREWAI_MODEL", "openai/gpt-5-mini")
    with facade_session() as tools:
        agent = Agent(
            role="Stagehand browser agent",
            goal="Complete the requested browser task accurately and safely.",
            backstory=FACADE_AGENT_INSTRUCTIONS,
            tools=list(tools),
            llm=model,
        )
        task = Task(
            description=instruction,
            expected_output="A concise report of the completed browser task and its result.",
            agent=agent,
        )
        crew = Crew(agents=[agent], tasks=[task])
        result = crew.kickoff()

    print(result)


if __name__ == "__main__":
    main()
