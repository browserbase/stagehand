from __future__ import annotations

import sys
from collections.abc import AsyncIterator, Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from deepagents import create_deep_agent
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.errors import GraphRecursionError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from run_eval import (  # noqa: E402
    RunnerConfig,
    _default_build_agent,
    aggregate_usage,
    extract_images,
    flatten_text,
    run,
    sanitize_error,
)


class ToolFakeChatModel(GenericFakeChatModel):
    model_name: str = "eval-model"

    @property
    def _llm_type(self) -> str:
        return "tool-fake-chat-model"

    def bind_tools(self, tools: object, **kwargs: object) -> ToolFakeChatModel:
        return self

    def _get_ls_params(self, **kwargs: object) -> dict[str, str]:
        return {"ls_provider": "fake", "ls_model_name": self.model_name}


@tool
def snapshot(url: str) -> str:
    """Take a browser snapshot."""
    return f"snapshot of {url}"


def config(*, recursion_limit: int = 20, max_tool_steps: int = 5) -> RunnerConfig:
    return RunnerConfig(
        prompt="inspect",
        system_prompt=None,
        model="fake:model",
        mcp_servers={},
        recursion_limit=recursion_limit,
        max_tool_steps=max_tool_steps,
    )


def fake_builder(
    messages: Iterator[AIMessage],
) -> Callable[[RunnerConfig, list[object]], object]:
    def build(_config: RunnerConfig, _tools: list[object]) -> object:
        model = ToolFakeChatModel(messages=messages)
        return create_deep_agent(model=model, tools=[snapshot])

    return build


def usage(input_tokens: int, output_tokens: int, cache: int, reasoning: int) -> dict[str, Any]:
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
        "input_token_details": {"cache_read": cache},
        "output_token_details": {"reasoning": reasoning},
    }


@pytest.mark.asyncio
async def test_streams_tool_sequence_and_sums_usage() -> None:
    messages = iter(
        [
            AIMessage(
                content="checking",
                tool_calls=[
                    {
                        "name": "snapshot",
                        "args": {"url": "https://example.com"},
                        "id": "call-1",
                        "type": "tool_call",
                    }
                ],
                usage_metadata=usage(10, 2, 3, 1),
            ),
            AIMessage(content="done", usage_metadata=usage(5, 4, 2, 2)),
        ]
    )
    events: list[dict[str, Any]] = []

    exit_code = await run(config(), build_agent=fake_builder(messages), emit=events.append)

    assert exit_code == 0
    assert [event["type"] for event in events] == [
        "assistant",
        "tool_call",
        "tool_result",
        "assistant",
        "final",
        "usage",
    ]
    assert events[2]["text"] == "snapshot of https://example.com"
    assert events[-2]["text"] == "done"
    assert events[-1] == {
        "type": "usage",
        "input_tokens": 15,
        "output_tokens": 6,
        "cache_read_input_tokens": 5,
        "reasoning_output_tokens": 3,
        "total_tokens": 21,
        "ts": events[-1]["ts"],
    }


class RecursingAgent:
    async def astream(self, *_args: object, **_kwargs: object) -> AsyncIterator[object]:
        if False:
            yield None
        raise GraphRecursionError("recursion exhausted")


class ReEmittingAgent:
    def __init__(self, first: AIMessage, tool_result: ToolMessage, final: AIMessage) -> None:
        self.first = first
        self.tool_result = tool_result
        self.final = final

    async def astream(self, *_args: object, **_kwargs: object) -> AsyncIterator[object]:
        yield {"model": {"messages": [self.first, self.tool_result]}}
        yield {"summarization": {"messages": [self.first, self.tool_result, self.final]}}


class FailedToolAgent:
    async def astream(self, *_args: object, **_kwargs: object) -> AsyncIterator[object]:
        yield {
            "tools": {
                "messages": [
                    ToolMessage(
                        content="failed with bb_test_abcd1234567890",
                        name="snapshot",
                        tool_call_id="call-1",
                        status="error",
                    )
                ]
            }
        }


class ParallelToolResultsAgent:
    async def astream(self, *_args: object, **_kwargs: object) -> AsyncIterator[object]:
        yield {
            "tools": {
                "messages": [
                    ToolMessage(
                        content="first",
                        name="snapshot",
                        tool_call_id="call-1",
                        id="tool-1",
                    ),
                    ToolMessage(
                        content="second",
                        name="snapshot",
                        tool_call_id="call-2",
                        id="tool-2",
                    ),
                ]
            }
        }


class FailingAfterAssistantAgent:
    async def astream(self, *_args: object, **_kwargs: object) -> AsyncIterator[object]:
        yield {
            "model": {
                "messages": [AIMessage(content="answer with Bearer abcdefghijklmnop")]
            }
        }
        raise RuntimeError("failed with sk-abcdef1234567890")


@pytest.mark.asyncio
async def test_deduplicates_messages_reemitted_after_summarization() -> None:
    first = AIMessage(
        id="assistant-1",
        content="checking",
        tool_calls=[
            {
                "name": "snapshot",
                "args": {"url": "https://example.com"},
                "id": "call-1",
                "type": "tool_call",
            }
        ],
        usage_metadata=usage(10, 2, 3, 1),
    )
    tool_result = ToolMessage(
        id="tool-1",
        content="snapshot result",
        name="snapshot",
        tool_call_id="call-1",
    )
    final = AIMessage(
        id="assistant-2",
        content="done",
        usage_metadata=usage(5, 4, 2, 2),
    )
    events: list[dict[str, Any]] = []

    await run(
        config(),
        build_agent=lambda _config, _tools: ReEmittingAgent(first, tool_result, final),
        emit=events.append,
    )

    assert [event["type"] for event in events] == [
        "assistant",
        "tool_call",
        "tool_result",
        "assistant",
        "final",
        "usage",
    ]
    assert events[-1]["input_tokens"] == 15
    assert events[-1]["output_tokens"] == 6


def test_default_build_disables_summarization_and_general_purpose_subagent() -> None:
    model = ToolFakeChatModel(messages=iter([AIMessage(content="done")]))
    agent = _default_build_agent(config(), [snapshot], model=model)

    assert not any("SummarizationMiddleware" in name for name in agent.nodes)
    tools_node = agent.nodes["tools"]
    tool_names = set(tools_node.bound.tools_by_name)
    assert "snapshot" in tool_names
    assert "task" not in tool_names


@pytest.mark.asyncio
async def test_recursion_limit_is_a_normal_runner_result() -> None:
    events: list[dict[str, Any]] = []
    exit_code = await run(
        config(recursion_limit=1),
        build_agent=lambda _config, _tools: RecursingAgent(),
        emit=events.append,
    )

    assert exit_code == 0
    assert [event["type"] for event in events] == ["error", "final", "usage"]
    assert events[0]["kind"] == "recursion_limit"


@pytest.mark.asyncio
async def test_tool_step_budget_stops_after_result() -> None:
    messages = iter(
        [
            AIMessage(
                content="checking",
                tool_calls=[
                    {
                        "name": "snapshot",
                        "args": {"url": "https://example.com"},
                        "id": "call-1",
                        "type": "tool_call",
                    }
                ],
            ),
            AIMessage(content="should not be reached"),
        ]
    )
    events: list[dict[str, Any]] = []
    await run(
        config(max_tool_steps=1),
        build_agent=fake_builder(messages),
        emit=events.append,
    )

    assert [event["type"] for event in events] == [
        "assistant",
        "tool_call",
        "tool_result",
        "error",
        "final",
        "usage",
    ]
    assert events[3]["kind"] == "tool_step_budget"


@pytest.mark.asyncio
async def test_tool_step_budget_records_the_complete_parallel_result_batch() -> None:
    events: list[dict[str, Any]] = []

    await run(
        config(max_tool_steps=1),
        build_agent=lambda _config, _tools: ParallelToolResultsAgent(),
        emit=events.append,
    )

    assert [event["type"] for event in events] == [
        "tool_result",
        "tool_result",
        "error",
        "final",
        "usage",
    ]
    assert [event["text"] for event in events[:2]] == ["first", "second"]


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("https://example.com?apiKey=supersecret&ok=1", "?apiKey=[redacted]&ok=1"),
        ("sk-abcdef1234567890", "sk-abcdef[redacted]"),
        ("bb_live_abcd1234567890", "bb_live_abcd[redacted]"),
        (f"AIza{'A' * 30}", "AIza[redacted]"),
        ("Bearer abcdefghijklmnop", "Bearer [redacted]"),
        ("wss://user:password@connect.example.com/devtools", "wss://[redacted]@"),
        ("https://example.com?client_secret=supersecret", "?client_secret=[redacted]"),
        ("ghp_abcdefghijklmno", "ghp_abcd[redacted]"),
    ],
)
def test_sanitize_error_ports_all_harness_patterns(message: str, expected: str) -> None:
    sanitized = sanitize_error(message)

    assert expected in sanitized
    assert message not in sanitized


def test_sanitize_error_redacts_sensitive_environment_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CUSTOM_PROVIDER_SECRET", "environment-secret-value")

    sanitized = sanitize_error("provider failed: environment-secret-value")

    assert sanitized == "provider failed: [redacted]"


@pytest.mark.asyncio
async def test_redacts_failed_tool_payloads_and_final_with_error() -> None:
    events: list[dict[str, Any]] = []

    await run(
        config(),
        build_agent=lambda _config, _tools: FailedToolAgent(),
        emit=events.append,
    )

    failed_tool = next(event for event in events if event["type"] == "tool_result")
    assert failed_tool["text"] == "failed with bb_test_abcd[redacted]"
    assert "bb_test_abcd1234567890" not in str(events)

    events.clear()
    exit_code = await run(
        config(),
        build_agent=lambda _config, _tools: FailingAfterAssistantAgent(),
        emit=events.append,
    )

    assert exit_code == 1
    error = next(event for event in events if event["type"] == "error")
    final = next(event for event in events if event["type"] == "final")
    assert error["message"] == "failed with sk-abcdef[redacted]"
    assert final["text"] == "answer with Bearer [redacted]"


def test_content_blocks_and_usage_helpers() -> None:
    content = [
        {"type": "text", "text": "first"},
        {"type": "image", "base64": "YWJj", "mime_type": "image/png"},
        {"type": "other", "value": 3},
        {"type": "image", "data": "ZGVm", "mimeType": "image/jpeg"},
    ]
    assert flatten_text(content) == 'first\n{"type":"other","value":3}'
    assert extract_images(content) == [
        {"data": "YWJj", "mime_type": "image/png"},
        {"data": "ZGVm", "mime_type": "image/jpeg"},
    ]
    assert aggregate_usage([usage(2, 3, 1, 2), usage(4, 5, 2, 3)]) == {
        "input_tokens": 6,
        "output_tokens": 8,
        "cache_read_input_tokens": 3,
        "reasoning_output_tokens": 5,
        "total_tokens": 14,
    }


async def test_flaky_teardown_after_completion_keeps_exit_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A raising exit-stack close after the stream finished must stay exit 0
    and must not emit an error event that overwrites the stop classification."""
    import run_eval as run_eval_module

    class FlakyExitStack:
        async def enter_async_context(self, _cm: Any) -> Any:  # pragma: no cover
            raise AssertionError("no MCP contexts expected in this test")

        async def aclose(self) -> None:
            raise RuntimeError("stdio server already exited")

    monkeypatch.setattr(run_eval_module, "AsyncExitStack", FlakyExitStack)
    messages = iter([AIMessage(content="done", usage_metadata=usage(5, 4, 2, 2))])
    events: list[dict[str, Any]] = []

    exit_code = await run(config(), build_agent=fake_builder(messages), emit=events.append)

    assert exit_code == 0
    assert all(event["type"] != "error" for event in events)
