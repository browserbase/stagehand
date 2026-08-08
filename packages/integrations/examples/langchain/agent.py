from __future__ import annotations

import asyncio
import os
import sys
from builtins import BaseExceptionGroup
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Protocol

from deepagents import create_deep_agent
from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.tools import load_mcp_tools
from mcp import ClientSession

DEFAULT_STAGEHAND_MODEL = "openai:gpt-5-mini"


class StagehandLangChainConnectionError(RuntimeError):
    """LangChain could not establish the authenticated Stagehand MCP connection."""


class StagehandLangChainToolContractError(RuntimeError):
    """The remote Stagehand MCP tool contract was not the expected code-mode API."""


class StagehandLangChainCleanupError(RuntimeError):
    """LangChain could not close its Stagehand MCP session."""


class StagehandLangChainSetupError(RuntimeError):
    """LangChain could not construct the Stagehand browser agent."""


class StagehandLangChainRunError(RuntimeError):
    """The LangChain Stagehand browser run failed."""


class StagehandSandboxConnection(Protocol):
    url: str
    token: str


def create_stagehand_mcp_client(
    connection: StagehandSandboxConnection,
) -> MultiServerMCPClient:
    """Create a native authenticated Streamable HTTP client."""
    return MultiServerMCPClient(
        {
            "stagehand": {
                "transport": "streamable_http",
                "url": connection.url,
                "headers": {"Authorization": f"Bearer {connection.token}"},
            }
        },
        tool_name_prefix=False,
        handle_tool_errors=True,
    )


async def load_stagehand_code_tool(session: ClientSession) -> BaseTool:
    """Discover the one canonical tool without creating another MCP session."""
    try:
        tools = await load_mcp_tools(session)
    except Exception:  # noqa: BLE001 -- MCP discovery is an untyped boundary.
        raise StagehandLangChainConnectionError(
            "Could not discover the Stagehand MCP tool."
        ) from None
    tool_names = [tool.name for tool in tools]
    if tool_names != ["code_execute"]:
        raise StagehandLangChainToolContractError(
            "The Stagehand MCP server returned an invalid tool contract."
        )
    if "# Stagehand V4 code-mode syntax" not in tools[0].description:
        raise StagehandLangChainToolContractError(
            "The Stagehand MCP server returned an invalid tool contract."
        )
    return tools[0]


@asynccontextmanager
async def stagehand_code_session(
    connection: StagehandSandboxConnection,
) -> AsyncIterator[BaseTool]:
    """Keep one remote MCP session open for every tool call in an agent run."""
    try:
        client = create_stagehand_mcp_client(connection)
    except Exception:  # noqa: BLE001 -- client construction is an untyped boundary.
        raise StagehandLangChainConnectionError(
            "Could not connect LangChain to the Stagehand MCP server."
        ) from None

    primary_error: BaseException | None = None
    try:
        async with client.session("stagehand") as session:
            try:
                code_tool = await load_stagehand_code_tool(session)
                yield code_tool
            except BaseException as error:
                primary_error = error
                raise
    except (
        StagehandLangChainConnectionError,
        StagehandLangChainToolContractError,
    ):
        raise
    except BaseException as error:
        if primary_error is not None:
            if error is primary_error:
                raise
            raise BaseExceptionGroup(
                "LangChain run and MCP cleanup both failed",
                [
                    primary_error,
                    StagehandLangChainCleanupError(
                        "Could not close the LangChain Stagehand MCP session."
                    ),
                ],
            ) from None
        if not isinstance(error, Exception):
            raise
        raise StagehandLangChainConnectionError(
            "Could not connect LangChain to the Stagehand MCP server."
        ) from None


def build_stagehand_agent(
    code_tool: BaseTool,
    model: str | Any = DEFAULT_STAGEHAND_MODEL,
) -> Any:
    if code_tool.name != "code_execute":
        raise StagehandLangChainToolContractError(
            "The Stagehand MCP server returned an invalid tool contract."
        )
    try:
        return create_deep_agent(
            model=model,
            tools=[code_tool],
            system_prompt=code_tool.description,
        )
    except Exception:  # noqa: BLE001 -- Deep Agent construction is untyped.
        raise StagehandLangChainSetupError(
            "Could not configure the LangChain Stagehand agent."
        ) from None


def stagehand_tool_call_count(result: dict[str, Any]) -> int:
    """Count model-selected code_execute calls in a LangGraph result."""
    count = 0
    for message in result.get("messages", []):
        for call in getattr(message, "tool_calls", []):
            name = (
                call.get("name")
                if isinstance(call, dict)
                else getattr(call, "name", None)
            )
            if name == "code_execute":
                count += 1
    return count


async def run_stagehand_agent(
    connection: StagehandSandboxConnection,
    prompt: str,
    model: str | Any = DEFAULT_STAGEHAND_MODEL,
) -> dict[str, Any]:
    async with stagehand_code_session(connection) as code_tool:
        try:
            return await build_stagehand_agent(code_tool, model).ainvoke(
                {"messages": [{"role": "user", "content": prompt}]},
                config={"recursion_limit": 20},
            )
        except (
            StagehandLangChainSetupError,
            StagehandLangChainToolContractError,
        ):
            raise
        except Exception:  # noqa: BLE001 -- Deep Agent execution is untyped.
            raise StagehandLangChainRunError(
                "The LangChain Stagehand agent run failed."
            ) from None


def _last_message_text(result: dict[str, Any]) -> str:
    messages: Sequence[Any] = result.get("messages", [])
    if not messages:
        return str(result)
    content = getattr(messages[-1], "content", messages[-1])
    return content if isinstance(content, str) else str(content)


async def _main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(f'Usage: {Path(sys.argv[0]).name} "<browser task>"')
    from sandbox import StagehandSandboxLease

    prompt = " ".join(sys.argv[1:])
    model = os.environ.get("STAGEHAND_LANGCHAIN_MODEL", DEFAULT_STAGEHAND_MODEL)
    with StagehandSandboxLease() as connection:
        result = await run_stagehand_agent(connection, prompt, model=model)
    print(_last_message_text(result))


if __name__ == "__main__":
    asyncio.run(_main())
