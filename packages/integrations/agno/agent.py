import asyncio
import os
import shutil
import sys
from pathlib import Path

from agno.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools.mcp import MCPTools
from mcp import StdioServerParameters

FACADE_AGENT_INSTRUCTIONS = (
    "Browser tool surface: Stagehand Playwright facade.\n"
    "You control one persistent browser through exactly three tools:\n"
    "- run: execute JavaScript against an initialized Playwright page, context, and "
    "browser (page.goto, page.locator(selector).click()/fill(), page.getByRole(...), "
    "page.evaluate(...), page.waitForURL(...), and the supported Playwright-shaped API). "
    "Use await directly and return JSON-serializable values so you can inspect progress. "
    "Alternatively, pass snapshot actions.\n"
    "- snapshot: inspect the active page's accessibility tree and hydrate bracketed "
    "element IDs for run actions.\n"
    "- screenshot: inspect the rendered page visually.\n"
    "\n"
    'Pass run exactly one of code or actions; every action uses "op" and "id", never '
    '"kind" or "ref". Snapshot IDs are valid only for the latest snapshot of the active '
    "page; snapshot again after navigation or stale IDs. The first browser action should "
    "usually be: await page.goto(url, { waitUntil: 'domcontentloaded' }). Do not launch "
    "another browser or create a separate browser process."
)


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


def facade_session() -> MCPTools:
    return MCPTools(server_params=server_params(), timeout_seconds=60)


async def run_agent(instruction: str) -> None:
    async with facade_session() as tools:
        agent = Agent(
            model=OpenAIChat(id=os.environ.get("AGNO_MODEL", "gpt-5.6-luna")),
            tools=[tools],
            instructions=FACADE_AGENT_INSTRUCTIONS,
            markdown=True,
        )
        await agent.aprint_response(instruction, stream=True)


def main() -> None:
    instruction = " ".join(sys.argv[1:]).strip()
    if not instruction:
        print(f'Usage: {Path(sys.argv[0]).name} "your instruction"', file=sys.stderr)
        raise SystemExit(2)
    asyncio.run(run_agent(instruction))


if __name__ == "__main__":
    main()
