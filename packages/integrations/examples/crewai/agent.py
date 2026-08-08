from __future__ import annotations

import os
import sys
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from typing import Any

from crewai.tools import BaseTool
from crewai_tools import MCPServerAdapter

from crewai import Agent
from mcp import StdioServerParameters

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
MODAL_STDIO_BRIDGE_PATH = (
    REPOSITORY_ROOT / "packages/integrations/examples/shared/modal_stdio_bridge.py"
)
SKILL_PATH = REPOSITORY_ROOT / "packages/integrations/codemode/SKILL.md"
DEFAULT_STAGEHAND_LLM = "openai/gpt-5-mini"

BRIDGE_ENV_KEYS = (
    "PATH",
    "HOME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
    "MODAL_TOKEN_ID",
    "MODAL_TOKEN_SECRET",
    "MODAL_PROFILE",
    "BROWSERBASE_API_KEY",
    "BROWSERBASE_PROJECT_ID",
    "STAGEHAND_MODEL_NAME",
    "STAGEHAND_MODEL_API_KEY",
    "STAGEHAND_CODEMODE_IMAGE",
    "STAGEHAND_CODEMODE_MODAL_IMAGE_ID",
    "STAGEHAND_CODEMODE_MODAL_APP",
    "STAGEHAND_CODEMODE_ENTRYPOINT",
    "STAGEHAND_CODEMODE_TIMEOUT_SECONDS",
    "STAGEHAND_CODEMODE_IDLE_TIMEOUT_SECONDS",
    "STAGEHAND_CODEMODE_OUTBOUND_DOMAINS",
)


@lru_cache(maxsize=1)
def load_stagehand_codemode_skill() -> str:
    return SKILL_PATH.read_text(encoding="utf-8").strip()


def modal_bridge_env(overrides: dict[str, str] | None = None) -> dict[str, str]:
    """Build the trusted proxy environment without forwarding agent model keys."""
    child_env = {
        key: value for key in BRIDGE_ENV_KEYS if (value := os.environ.get(key)) is not None
    }
    if overrides:
        child_env.update(overrides)
    return child_env


@contextmanager
def stagehand_code_tools(
    env: dict[str, str] | None = None,
) -> Iterator[list[BaseTool]]:
    """Keep one sandboxed Stagehand MCP connected for a complete CrewAI run."""
    if not MODAL_STDIO_BRIDGE_PATH.is_file():
        raise FileNotFoundError(
            f"Stagehand Modal stdio bridge not found: {MODAL_STDIO_BRIDGE_PATH}"
        )

    parameters = StdioServerParameters(
        command=sys.executable,
        args=[str(MODAL_STDIO_BRIDGE_PATH)],
        cwd=REPOSITORY_ROOT,
        env=modal_bridge_env(env),
    )
    with MCPServerAdapter(parameters, connect_timeout=600) as discovered_tools:
        tools = list(discovered_tools)
        names = [tool.name for tool in tools]
        if names != ["code_execute"]:
            raise RuntimeError(f"Expected only code_execute from Stagehand MCP, got {names!r}.")
        yield tools


def build_stagehand_agent(
    tools: Sequence[BaseTool],
    llm: str | Any = DEFAULT_STAGEHAND_LLM,
) -> Agent:
    return Agent(
        role="Stagehand browser agent",
        goal="Complete browser tasks by writing compact, correct Stagehand V4 JavaScript.",
        backstory=load_stagehand_codemode_skill(),
        llm=llm,
        tools=list(tools),
        max_iter=8,
        verbose=False,
    )


def run_stagehand_agent(prompt: str, llm: str | Any = DEFAULT_STAGEHAND_LLM) -> str:
    with stagehand_code_tools() as tools:
        return str(build_stagehand_agent(tools, llm).kickoff(prompt))
