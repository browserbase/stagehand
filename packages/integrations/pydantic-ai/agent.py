import argparse
import asyncio
import os
import shutil
import sys
from pathlib import Path

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPToolset, StdioTransport

FACADE_AGENT_INSTRUCTIONS = (
    "Browser tool surface: Stagehand Playwright facade.\n"
    "You control one persistent browser through exactly three tools:\n"
    "- run: execute JavaScript against an initialized Playwright page, context, and browser "
    "(page.goto, page.locator(selector).click()/fill(), page.getByRole(...), page.evaluate(...), "
    "page.waitForURL(...), and the supported Playwright-shaped API). Use await directly and return "
    "JSON-serializable values so you can inspect progress. Alternatively, pass snapshot actions.\n"
    "- snapshot: inspect the active page's accessibility tree and hydrate bracketed element IDs "
    "for run actions.\n"
    "- screenshot: inspect the rendered page visually.\n"
    "\n"
    'Pass run exactly one of code or actions; every action uses "op" and "id", never '
    '"kind" or "ref". Snapshot IDs are valid only for the latest snapshot of the active page; '
    "snapshot again after navigation or stale IDs. The first browser action should usually be: "
    "await page.goto(url, { waitUntil: 'domcontentloaded' }). Do not launch another browser or "
    "create a separate browser process."
)


class PageReport(BaseModel):
    title: str = Field(description="The document title of the active page")
    url: str = Field(description="The URL of the active page")
    notes: str = Field(description="A short description of what the agent observed")


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


def facade_toolset() -> MCPToolset:
    node = shutil.which("node")
    if node is None:
        msg = "Node.js is required to run the Stagehand facade MCP server, but node was not found."
        raise RuntimeError(msg)
    return MCPToolset(
        StdioTransport(command=node, args=[str(resolve_server_path())], env=facade_env()),
        tool_error_behavior="failed",
    )


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
            instructions=FACADE_AGENT_INSTRUCTIONS,
            output_type=PageReport,
        )
    return Agent(
        resolved_model,
        name="stagehand_browser_agent",
        instructions=FACADE_AGENT_INSTRUCTIONS,
    )


async def run_instruction(instruction: str, *, structured: bool) -> str | PageReport:
    toolset = facade_toolset()
    agent = build_agent(structured=structured)
    async with toolset:
        result = await agent.run(instruction, toolsets=[toolset])
    return result.output


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run a Pydantic AI agent against the Stagehand facade MCP server."
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
