from __future__ import annotations

import os
import queue
import threading
from builtins import BaseExceptionGroup
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from typing import Any, Protocol

from crewai import Agent
from crewai.tools import BaseTool
from crewai_tools import MCPServerAdapter

DEFAULT_STAGEHAND_LLM = os.environ.get("CREWAI_MODEL", "openai/gpt-5-mini")
ADAPTER_STOP_TIMEOUT_SECONDS = 30


class StagehandCrewAIConnectionError(RuntimeError):
    """CrewAI could not establish the authenticated Stagehand MCP connection."""


class StagehandCrewAIToolContractError(RuntimeError):
    """The remote Stagehand MCP tool contract was not the expected code-mode API."""


class StagehandCrewAICleanupError(RuntimeError):
    """CrewAI could not close its Stagehand MCP adapter."""


class StagehandCrewAISetupError(RuntimeError):
    """CrewAI could not construct the Stagehand browser agent."""


class StagehandCrewAIRunError(RuntimeError):
    """The CrewAI Stagehand browser run failed."""


class StagehandSandboxConnection(Protocol):
    url: str
    token: str


@contextmanager
def stagehand_code_tools(
    connection: StagehandSandboxConnection,
) -> Iterator[list[BaseTool]]:
    """Keep one authenticated remote MCP client open for a complete CrewAI run."""
    adapter: MCPServerAdapter | None = None
    try:
        adapter = MCPServerAdapter(
            {
                "url": connection.url,
                "transport": "streamable-http",
                "headers": {"Authorization": f"Bearer {connection.token}"},
            },
            connect_timeout=60,
        )
        tools = list(adapter.tools)
        names = [tool.name for tool in tools]
        if names != ["code_execute"]:
            raise StagehandCrewAIToolContractError(
                "The Stagehand MCP server returned an invalid tool contract."
            )
        if "# Stagehand V4 code-mode syntax" not in tools[0].description:
            raise StagehandCrewAIToolContractError(
                "The Stagehand MCP server returned an invalid tool contract."
            )
    except Exception as error:  # noqa: BLE001 -- third-party discovery is untyped.
        primary_error = (
            error
            if isinstance(error, StagehandCrewAIToolContractError)
            else StagehandCrewAIConnectionError(
                "Could not connect CrewAI to the Stagehand MCP server."
            )
        )
        if adapter is None:
            raise primary_error from None
        try:
            stop_adapter(adapter)
        except StagehandCrewAICleanupError as cleanup_error:
            raise BaseExceptionGroup(
                "CrewAI MCP setup and cleanup both failed",
                [primary_error, cleanup_error],
            )
        raise primary_error from None

    try:
        yield tools
    except BaseException as primary_error:
        try:
            stop_adapter(adapter)
        except StagehandCrewAICleanupError as cleanup_error:
            raise BaseExceptionGroup(
                "CrewAI run and MCP cleanup both failed",
                [primary_error, cleanup_error],
            )
        raise
    else:
        stop_adapter(adapter)


def build_stagehand_agent(
    tools: Sequence[BaseTool],
    llm: str | Any = DEFAULT_STAGEHAND_LLM,
) -> Agent:
    if len(tools) != 1 or tools[0].name != "code_execute":
        raise StagehandCrewAIToolContractError(
            "The Stagehand MCP server returned an invalid tool contract."
        )
    try:
        return Agent(
            role="Stagehand browser agent",
            goal="Complete browser tasks by writing compact, correct Stagehand V4 JavaScript.",
            backstory=tools[0].description,
            llm=llm,
            tools=list(tools),
            max_iter=8,
            verbose=False,
        )
    except Exception:  # noqa: BLE001 -- CrewAI construction is an untyped boundary.
        raise StagehandCrewAISetupError(
            "Could not configure the CrewAI Stagehand agent."
        ) from None


def run_stagehand_agent(
    connection: StagehandSandboxConnection,
    prompt: str,
    llm: str | Any = DEFAULT_STAGEHAND_LLM,
) -> str:
    with stagehand_code_tools(connection) as tools:
        try:
            return str(build_stagehand_agent(tools, llm).kickoff(prompt))
        except (StagehandCrewAISetupError, StagehandCrewAIToolContractError):
            raise
        except Exception:  # noqa: BLE001 -- CrewAI kickoff is an untyped boundary.
            raise StagehandCrewAIRunError(
                "The CrewAI Stagehand agent run failed."
            ) from None


def stop_adapter(adapter: MCPServerAdapter) -> None:
    result: queue.Queue[BaseException | None] = queue.Queue(maxsize=1)

    def stop() -> None:
        try:
            adapter.stop()
            result.put(None)
        except BaseException as error:  # noqa: BLE001 -- adapter shutdown is an untyped boundary.
            result.put(error)

    # MCPServerAdapter exposes only a synchronous stop with no cancellation hook or
    # documented thread affinity. A daemon supervisor bounds that call; after a
    # timeout the sandbox lease may unwind while the orphaned stop finishes, and
    # its result is intentionally ignored because cleanup failure was reported.
    try:
        threading.Thread(
            target=stop,
            name="stagehand-crewai-mcp-cleanup",
            daemon=True,
        ).start()
    except BaseException:  # noqa: BLE001 -- cleanup startup is an untyped boundary.
        raise StagehandCrewAICleanupError(
            "Could not close the CrewAI Stagehand MCP adapter."
        ) from None
    try:
        error = result.get(timeout=ADAPTER_STOP_TIMEOUT_SECONDS)
    except queue.Empty:
        error = TimeoutError()
    if error is not None:
        raise StagehandCrewAICleanupError(
            "Could not close the CrewAI Stagehand MCP adapter."
        ) from None
