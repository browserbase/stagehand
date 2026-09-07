from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
import sys
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import run_eval as runner  # noqa: E402


def config(*, mcp: bool = False) -> runner.RunnerConfig:
    return runner.parse_config({
        "prompt": "Use the mounted browser.",
        "system_prompt": None,
        "model": "openai:fixture-model",
        "mcp_servers": {"browser": {"command": "fixture", "args": []}} if mcp else {},
        "recursion_limit": 10,
        "max_tool_steps": 5,
    })


@pytest.mark.parametrize("stalled_phase", ["session", "tools"])
async def test_mcp_setup_deadline_cancels_setup_before_starting_agent(
    monkeypatch: pytest.MonkeyPatch, stalled_phase: str,
) -> None:
    cancelled = False
    session_closed = False

    async def stall() -> None:
        nonlocal cancelled
        try:
            await asyncio.Event().wait()
        finally:
            cancelled = True

    class Client:
        @asynccontextmanager
        async def session(self, _name: str):
            nonlocal session_closed
            try:
                if stalled_phase == "session":
                    await stall()
                yield object()
            finally:
                session_closed = True

    async def load_tools(_session: object, *, server_name: str):
        assert server_name == "browser"
        await stall()
        return []

    def unexpected_agent(*_args: object):
        pytest.fail("The agent must not start after MCP setup times out")

    monkeypatch.setattr(runner, "MultiServerMCPClient", lambda _: Client())
    monkeypatch.setattr(runner, "load_mcp_tools", load_tools)
    monkeypatch.setattr(runner, "MCP_SETUP_TIMEOUT_S", 0.02)
    events: list[dict[str, Any]] = []
    result = await asyncio.wait_for(
        runner.run(config(mcp=True), build_agent=unexpected_agent, emit=events.append), 1,
    )
    assert result == 1
    assert cancelled and session_closed
    assert [event["kind"] for event in events if event["type"] == "error"] == ["mcp_setup_timeout"]
    assert events[-2]["type"] == "final"
    assert events[-1]["type"] == "usage"


@pytest.mark.parametrize("inactivity,wall,expected", [
    (0.5, 0.02, "wall_timeout"),
    (0.02, 0.5, "inactivity_timeout"),
])
async def test_shorter_deadline_wins_when_both_guards_are_enabled(
    monkeypatch: pytest.MonkeyPatch, inactivity: float, wall: float, expected: str,
) -> None:
    closed = False

    class Agent:
        async def astream(self, *_args: object, **_kwargs: object):
            nonlocal closed
            try:
                await asyncio.Event().wait()
                yield {}
            finally:
                closed = True

    monkeypatch.setattr(runner, "INACTIVITY_TIMEOUT_S", inactivity)
    monkeypatch.setattr(runner, "WALL_TIMEOUT_S", wall)
    events: list[dict[str, Any]] = []
    result = await asyncio.wait_for(
        runner.run(config(), build_agent=lambda *_: Agent(), emit=events.append), 1,
    )
    # Stream failures use the typed error event; the process still drains final/usage.
    assert result == 0
    assert closed
    assert [event["kind"] for event in events if event["type"] == "error"] == [expected]


@pytest.mark.parametrize("value", ["nan", "inf", "-1", "invalid"])
def test_invalid_timeout_env_keeps_default(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv("DEEPAGENTS_TEST_TIMEOUT", value)
    assert runner._env_float("DEEPAGENTS_TEST_TIMEOUT", 3.0) == 3.0
