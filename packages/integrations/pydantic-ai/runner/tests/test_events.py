from pathlib import Path
from typing import Any

from pydantic_ai import Agent, BinaryContent, FunctionToolResultEvent
from pydantic_ai.messages import RetryPromptPart, ToolReturnPart
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage
from run_eval import EvalResult, RunnerConfig, _map_event, aggregate_usage, run


def test_failed_and_retry_results_are_not_successful() -> None:
    for part in [
        ToolReturnPart("stagehand_run", "failed", tool_call_id="1", outcome="failed"),
        RetryPromptPart("invalid arguments", tool_name="stagehand_run", tool_call_id="1"),
    ]:
        event = _map_event(FunctionToolResultEvent(part), {"stagehand_run": "stagehand"})[0]
        assert event["ok"] is False
        assert event["name"] == "run"
        assert event["server"] == "stagehand"


def test_result_preserves_structured_content_and_model_images() -> None:
    event = FunctionToolResultEvent(
        ToolReturnPart("screenshot", {"url": "https://example.com"}, tool_call_id="1"),
        content=[BinaryContent(data=b"abc", media_type="image/png")],
    )
    mapped = _map_event(event, {})[0]
    assert mapped["structured"] == {"url": "https://example.com"}
    assert mapped["images"] == [{"data": "YWJj", "mime_type": "image/png"}]


def test_cache_usage_is_not_double_counted() -> None:
    usage = RunUsage(
        input_tokens=100,
        output_tokens=10,
        cache_read_tokens=80,
        details={"cache_read_tokens": 80, "reasoning_tokens": 5},
    )
    assert aggregate_usage(usage)["cache_read_input_tokens"] == 80
    assert aggregate_usage(usage)["reasoning_output_tokens"] == 5


async def test_tool_budget_preserves_usage() -> None:
    def snapshot() -> str:
        """Inspect the browser."""
        return "page"

    def build(_config: RunnerConfig, _toolsets: list[object]) -> Agent[None, EvalResult]:
        return Agent(TestModel(), output_type=EvalResult, tools=[snapshot])

    events: list[dict[str, Any]] = []
    config = RunnerConfig("inspect", "sys", "test", {}, 10, 1)
    await run(config, build_agent=build, emit=events.append)
    assert any(event.get("kind") == "tool_step_budget" for event in events)
    usage = next(event for event in events if event["type"] == "usage")
    assert usage["reported"] is True
    assert usage["input_tokens"] > 0


async def test_stdio_servers_with_overlapping_tools(
    tmp_path: Path,
) -> None:
    import sys

    from run_eval import McpServerConfig, _default_build_agent

    server = tmp_path / "server.py"
    server.write_text(
        "from mcp.server.mcpserver import MCPServer\n"
        'mcp = MCPServer("browser")\n'
        "@mcp.tool()\n"
        "def snapshot() -> str:\n"
        '    return "page snapshot"\n'
        "mcp.run()\n"
    )
    servers = {name: McpServerConfig(sys.executable, [str(server)]) for name in ["first", "second"]}

    def build(config: RunnerConfig, toolsets: list[object]) -> Agent[None, EvalResult]:
        return _default_build_agent(config, toolsets, model=TestModel())

    events: list[dict[str, Any]] = []
    code = await run(
        RunnerConfig("inspect", "sys", "test", servers, 10, 5),
        build_agent=build,
        emit=events.append,
    )
    assert code == 0
    assert not any(event["type"] == "error" for event in events)
    calls = [event for event in events if event["type"] == "tool_call"]
    assert {(event["server"], event["name"]) for event in calls} == {
        ("first", "snapshot"),
        ("second", "snapshot"),
    }
