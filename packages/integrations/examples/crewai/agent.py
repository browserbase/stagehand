from __future__ import annotations

import os
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from crewai import Agent
from crewai.tools import BaseTool
from crewai_tools import MCPServerAdapter
from mcp import StdioServerParameters

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
STDIO_SERVER_PATH = (
    REPOSITORY_ROOT / "packages/integrations/dist/codemode/stdio-server.mjs"
)
SKILL_PATH = REPOSITORY_ROOT / "packages/integrations/codemode/SKILL.md"
STAGEHAND_CODEMODE_SKILL = SKILL_PATH.read_text().strip()


@contextmanager
def stagehand_code_tools() -> Iterator[list[BaseTool]]:
    """Keep one Stagehand MCP process connected for a complete CrewAI run."""
    if not STDIO_SERVER_PATH.is_file():
        raise FileNotFoundError(
            "Build @browserbasehq/stagehand-integrations before starting CrewAI: "
            "pnpm turbo run build --filter @browserbasehq/stagehand-integrations"
        )

    parameters = StdioServerParameters(
        command="node",
        args=[str(STDIO_SERVER_PATH)],
        cwd=REPOSITORY_ROOT,
        env=dict(os.environ),
    )
    with MCPServerAdapter(parameters) as discovered_tools:
        tools = list(discovered_tools)
        names = [tool.name for tool in tools]
        if names != ["code_execute"]:
            raise RuntimeError(
                f"Expected only code_execute from Stagehand MCP, got {names!r}."
            )
        yield tools


def build_stagehand_agent(
    tools: Sequence[BaseTool],
    llm: str | Any = "openai/gpt-5-mini",
) -> Agent:
    return Agent(
        role="Stagehand browser agent",
        goal="Complete browser tasks by writing compact, correct Stagehand V4 JavaScript.",
        backstory=STAGEHAND_CODEMODE_SKILL,
        llm=llm,
        tools=list(tools),
        max_iter=8,
        verbose=False,
    )


def run_stagehand_agent(prompt: str, llm: str | Any = "openai/gpt-5-mini") -> str:
    with stagehand_code_tools() as tools:
        return str(build_stagehand_agent(tools, llm).kickoff(prompt))
