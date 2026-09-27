import pytest
from pydantic_ai.models.test import TestModel

from agent import build_agent, facade_toolset, resolve_server_path


@pytest.mark.asyncio
async def test_code_mode_wraps_facade_mcp_tools() -> None:
    pytest.importorskip("pydantic_ai_harness")
    try:
        resolve_server_path()
    except FileNotFoundError:
        pytest.skip("Build the Stagehand integrations package to test its MCP tool contract")

    toolset = facade_toolset()
    model = TestModel(call_tools=[])
    agent = build_agent(structured=False, code_mode=True, model="test")

    async with toolset:
        with agent.override(model=model):
            await agent.run("Inspect the page", toolsets=[toolset])

    names = {tool.name for tool in model.last_model_request_parameters.function_tools}
    assert "run_code" in names
    assert "run" not in names
    assert "snapshot" not in names
    assert "screenshot" not in names
