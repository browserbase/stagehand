from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
import sys
from typing import Any

import anyio
from langchain_core.messages import AIMessage, ToolMessage
from mcp import ClientSession
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


@pytest.mark.parametrize("stall_tools", [False, True])
async def test_real_mcp_session_closes_in_its_owning_task(
    monkeypatch: pytest.MonkeyPatch, stall_tools: bool,
) -> None:
    closed = False
    close_errors: list[Exception] = []
    agent_started = False

    class Client:
        @asynccontextmanager
        async def session(self, _name: str):
            nonlocal closed
            incoming_send, incoming_receive = anyio.create_memory_object_stream(1)
            outgoing_send, outgoing_receive = anyio.create_memory_object_stream(1)
            try:
                try:
                    # This opens the real MCP/AnyIO receive task group, without
                    # initializing a server or sending any network requests.
                    async with ClientSession(incoming_receive, outgoing_send) as session:
                        yield session
                    closed = True
                except Exception as error:
                    close_errors.append(error)
                    raise
            finally:
                for stream in (incoming_send, incoming_receive, outgoing_send, outgoing_receive):
                    await stream.aclose()

    async def load_tools(_session: object, *, server_name: str):
        if stall_tools:
            await asyncio.Event().wait()
        return []

    class Agent:
        async def astream(self, *_args: object, **_kwargs: object):
            nonlocal agent_started
            agent_started = True
            yield {"agent": {"messages": [AIMessage(content="complete")]}}

    monkeypatch.setattr(runner, "MultiServerMCPClient", lambda _: Client())
    monkeypatch.setattr(runner, "load_mcp_tools", load_tools)
    monkeypatch.setattr(runner, "MCP_SETUP_TIMEOUT_S", 0.02)
    events: list[dict[str, Any]] = []
    result = await asyncio.wait_for(
        runner.run(config(mcp=True), build_agent=lambda *_: Agent(), emit=events.append), 1,
    )
    assert closed
    assert close_errors == []
    assert agent_started is not stall_tools
    assert result == (1 if stall_tools else 0)
    assert [event["kind"] for event in events if event["type"] == "error"] == (
        ["mcp_setup_timeout"] if stall_tools else []
    )


@pytest.mark.parametrize("stop", ["complete", "tool_step_budget"])
async def test_stream_context_keeps_task_ownership_across_chunks_and_close(
    monkeypatch: pytest.MonkeyPatch, stop: str,
) -> None:
    closed = False
    close_errors: list[Exception] = []

    class Agent:
        async def astream(self, *_args: object, **_kwargs: object):
            nonlocal closed
            try:
                async with anyio.create_task_group():
                    try:
                        yield {"agent": {"messages": [AIMessage(content="working")]}}
                        if stop == "tool_step_budget":
                            for index in range(5):
                                yield {"tools": {"messages": [ToolMessage(
                                    content="done", tool_call_id=f"call-{index}", name="run",
                                )]}}
                        else:
                            yield {"agent": {"messages": [AIMessage(content="complete")]}}
                    except GeneratorExit:
                        # Closing a well-behaved stream exits its group normally.
                        pass
                closed = True
            except Exception as error:
                close_errors.append(error)
                raise
            finally:
                # GeneratorExit on the step cap still exits its task group.
                if not close_errors:
                    closed = True

    monkeypatch.setattr(runner, "INACTIVITY_TIMEOUT_S", 0.1)
    monkeypatch.setattr(runner, "WALL_TIMEOUT_S", 0.5)
    events: list[dict[str, Any]] = []
    result = await asyncio.wait_for(
        runner.run(config(), build_agent=lambda *_: Agent(), emit=events.append), 1,
    )
    assert closed
    assert close_errors == []
    assert result == 0
    assert [event["kind"] for event in events if event["type"] == "error"] == (
        ["tool_step_budget"] if stop == "tool_step_budget" else []
    )


async def test_caller_cancellation_still_closes_the_active_stream(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started = asyncio.Event()
    closed = False

    class Agent:
        async def astream(self, *_args: object, **_kwargs: object):
            nonlocal closed
            try:
                async with anyio.create_task_group():
                    started.set()
                    await asyncio.Event().wait()
                    yield {}
            finally:
                closed = True

    monkeypatch.setattr(runner, "INACTIVITY_TIMEOUT_S", 0.5)
    events: list[dict[str, Any]] = []
    task = asyncio.create_task(
        runner.run(config(), build_agent=lambda *_: Agent(), emit=events.append),
    )
    await asyncio.wait_for(started.wait(), 1)
    task.cancel()
    assert await asyncio.wait_for(task, 1) == 1
    assert closed
    assert [(event["kind"], event["message"]) for event in events if event["type"] == "error"] == [
        ("exception", "terminated"),
    ]


async def test_stalled_cleanup_keeps_its_deadline_and_completed_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cleanup_cancelled = False

    class Stack:
        async def aclose(self):
            nonlocal cleanup_cancelled
            try:
                await asyncio.Event().wait()
            finally:
                cleanup_cancelled = True

    class Agent:
        async def astream(self, *_args: object, **_kwargs: object):
            yield {"agent": {"messages": [AIMessage(content="complete")]}}

    monkeypatch.setattr(runner, "AsyncExitStack", Stack)
    monkeypatch.setattr(runner, "CLEANUP_TIMEOUT_S", 0.02)
    events: list[dict[str, Any]] = []
    result = await asyncio.wait_for(
        runner.run(config(), build_agent=lambda *_: Agent(), emit=events.append), 1,
    )
    assert result == 0
    assert cleanup_cancelled
    assert not [event for event in events if event["type"] == "error"]
