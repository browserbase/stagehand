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
