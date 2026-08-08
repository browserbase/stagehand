from __future__ import annotations

import os
from builtins import BaseExceptionGroup
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from typing import Any, Protocol

from crewai import Agent
from crewai.tools import BaseTool
from crewai_tools import MCPServerAdapter

DEFAULT_STAGEHAND_LLM = os.environ.get("CREWAI_MODEL", "openai/gpt-5-mini")


class StagehandSandboxConnection(Protocol):
    url: str
    token: str


@contextmanager
def stagehand_code_tools(
    connection: StagehandSandboxConnection,
) -> Iterator[list[BaseTool]]:
    """Keep one authenticated remote MCP client open for a complete CrewAI run."""
    adapter = MCPServerAdapter(
        {
            "url": connection.url,
            "transport": "streamable-http",
            "headers": {"Authorization": f"Bearer {connection.token}"},
        },
        connect_timeout=60,
    )
    try:
        tools = list(adapter.tools)
        names = [tool.name for tool in tools]
        if names != ["code_execute"]:
            raise RuntimeError(
                f"Expected only code_execute from Stagehand MCP, got {names!r}."
            )
        if "# Stagehand V4 code-mode syntax" not in tools[0].description:
            raise RuntimeError("code_execute did not include the canonical guidance")
        yield tools
    except BaseException as primary_error:
        try:
            adapter.stop()
        except BaseException as cleanup_error:
            raise BaseExceptionGroup(
                "CrewAI run and MCP cleanup both failed",
                [primary_error, cleanup_error],
            )
        raise
    else:
        adapter.stop()


def build_stagehand_agent(
    tools: Sequence[BaseTool],
    llm: str | Any = DEFAULT_STAGEHAND_LLM,
) -> Agent:
    if len(tools) != 1 or tools[0].name != "code_execute":
        raise ValueError("CrewAI Stagehand agent requires exactly code_execute")
    return Agent(
        role="Stagehand browser agent",
        goal="Complete browser tasks by writing compact, correct Stagehand V4 JavaScript.",
        backstory=tools[0].description,
        llm=llm,
        tools=list(tools),
        max_iter=8,
        verbose=False,
    )


def run_stagehand_agent(
    connection: StagehandSandboxConnection,
    prompt: str,
    llm: str | Any = DEFAULT_STAGEHAND_LLM,
) -> str:
    with stagehand_code_tools(connection) as tools:
        return str(build_stagehand_agent(tools, llm).kickoff(prompt))
