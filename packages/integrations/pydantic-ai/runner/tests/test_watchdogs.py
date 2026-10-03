import asyncio
from typing import Any

import pytest
from run_eval import RunnerConfig, run


class StalledAgent:
    async def run(self, *_args: object, **_kwargs: object) -> object:
        await asyncio.Event().wait()
        raise AssertionError("stalled agent resumed")


def config() -> RunnerConfig:
    return RunnerConfig(
        prompt="inspect",
        system_prompt="sys",
        model="openai:gpt-6-sol",
        mcp_servers={},
        recursion_limit=5,
        max_tool_steps=3,
    )


@pytest.mark.parametrize("inactivity,wall,kind", [(0.02, 0, "inactivity_timeout"), (0, 0.02, "wall_timeout")])
async def test_watchdog_stops_a_run_that_never_returns(
    monkeypatch: pytest.MonkeyPatch, inactivity: float, wall: float, kind: str
) -> None:
    import run_eval as module

    monkeypatch.setattr(module, "INACTIVITY_TIMEOUT_S", inactivity)
    monkeypatch.setattr(module, "WALL_TIMEOUT_S", wall)

    def build(_config: RunnerConfig, _toolsets: list[object], **_kwargs: object) -> StalledAgent:
        return StalledAgent()

    events: list[dict[str, Any]] = []
    exit_code = await run(config(), build_agent=build, emit=events.append)  # type: ignore[arg-type]
    assert exit_code == 0
    kinds = [event.get("kind") for event in events if event.get("type") == "error"]
    assert kind in kinds
