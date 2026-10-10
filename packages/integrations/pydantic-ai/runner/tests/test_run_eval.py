import json
from collections.abc import Callable
from typing import Any

import pytest
from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel
from run_eval import (
    EvalResult,
    RunnerConfig,
    aggregate_usage,
    extract_images,
    flatten_text,
    parse_config,
    run,
    sanitize_error,
    thinking_text,
)


def config(*, recursion_limit: int = 20, max_tool_steps: int = 5) -> RunnerConfig:
    return RunnerConfig(
        prompt="inspect",
        system_prompt="Use the browser tools.",
        model="openai:gpt-6-sol",
        mcp_servers={},
        recursion_limit=recursion_limit,
        max_tool_steps=max_tool_steps,
    )


def test_parse_config_accepts_stdio_servers() -> None:
    parsed = parse_config(
        {
            "prompt": "task",
            "system_prompt": "sys",
            "model": "openai:gpt-6-sol",
            "mcp_servers": {
                "stagehand": {
                    "command": "node",
                    "args": ["server.js"],
                    "env": {"TOKEN": "x"},
                    "cwd": "/tmp",
                }
            },
            "recursion_limit": 10,
            "max_tool_steps": 4,
        }
    )
    assert parsed.mcp_servers["stagehand"].command == "node"
    assert parsed.mcp_servers["stagehand"].args == ["server.js"]
    assert parsed.mcp_servers["stagehand"].env == {"TOKEN": "x"}


def test_parse_config_requires_system_prompt() -> None:
    with pytest.raises(ValueError, match="system_prompt"):
        parse_config({"prompt": "task", "model": "m", "mcp_servers": {}, "recursion_limit": 1, "max_tool_steps": 1})


def snapshot(url: str) -> str:
    """Take a browser snapshot."""
    return f"snapshot of {url}"


def fake_builder() -> Callable[..., Agent[None, EvalResult]]:
    def build(_config: RunnerConfig, _toolsets: list[object], **_kwargs: object) -> Agent[None, EvalResult]:
        return Agent(
            TestModel(),
            name="stagehand_pydantic_ai_eval_agent",
            instructions=_config.system_prompt or "",
            output_type=EvalResult,
            tools=[snapshot],
        )

    return build


@pytest.mark.asyncio
async def test_streams_tool_sequence_and_structured_result() -> None:
    events: list[dict[str, Any]] = []
    exit_code = await run(config(), build_agent=fake_builder(), emit=events.append)
    assert exit_code == 0
    types = [event["type"] for event in events]
    assert "final" in types
    assert "usage" in types
    final = next(event for event in reversed(events) if event["type"] == "final")
    parsed = json.loads(final["text"])
    assert parsed["success"] in {True, False}
    assert "summary" in parsed
    assert "finalAnswer" in parsed


def test_flatten_and_images() -> None:
    assert flatten_text("hello") == "hello"
    assert flatten_text([{"type": "text", "text": "a"}, {"type": "image", "data": "YWJj", "mime_type": "image/png"}]) == "a"
    assert extract_images(
        [{"type": "image", "data": "YWJj", "mime_type": "image/png"}]
    ) == [{"data": "YWJj", "mime_type": "image/png"}]


def test_sanitize_error_redacts_keys() -> None:
    assert "sk-abcdef" in sanitize_error("failed with sk-abcdef1234567890")
    assert "1234567890" not in sanitize_error("failed with sk-abcdef1234567890")


def test_aggregate_usage_without_telemetry() -> None:
    assert aggregate_usage(None)["reported"] is False


def test_parse_config_accepts_reasoning_summary() -> None:
    parsed = parse_config(
        {
            "prompt": "task",
            "system_prompt": "sys",
            "model": "openai:gpt-6-sol",
            "mcp_servers": {},
            "recursion_limit": 10,
            "max_tool_steps": 4,
            "reasoning_summary": "detailed",
        }
    )
    assert parsed.reasoning_summary == "detailed"


def test_parse_config_rejects_invalid_reasoning_summary() -> None:
    with pytest.raises(ValueError, match="reasoning_summary"):
        parse_config(
            {
                "prompt": "task",
                "system_prompt": "sys",
                "model": "openai:gpt-6-sol",
                "mcp_servers": {},
                "recursion_limit": 10,
                "max_tool_steps": 4,
                "reasoning_summary": "loud",
            }
        )


def test_thinking_text_prefers_visible_content() -> None:
    class Part:
        content = "visible"
        provider_details = {"raw_content": "hidden"}

    assert thinking_text(Part()) == "visible"


def test_thinking_text_falls_back_to_raw_provider_content() -> None:
    class Part:
        content = ""
        provider_details = {"raw_content": "hidden-chain"}

    assert thinking_text(Part()) == "hidden-chain"
