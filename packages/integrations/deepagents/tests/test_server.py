from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from stagehand_deepagents import runtime as runtime_module
from stagehand_deepagents.runtime import BrowserTools, RuntimeConfig
from stagehand_deepagents.server import StdioServer, _sanitize_error


async def test_server_lists_exact_browser_tool_surface() -> None:
    server = StdioServer()
    response = await server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert response is not None
    assert [tool["name"] for tool in response["result"]["tools"]] == [
        "run",
        "snapshot",
        "screenshot",
    ]


async def test_initialize_does_not_launch_browser() -> None:
    server = StdioServer()
    response = await server.handle(
        {
            "jsonrpc": "2.0",
            "id": "init",
            "method": "initialize",
            "params": {"protocolVersion": "2025-06-18"},
        }
    )
    assert response is not None
    assert response["result"]["serverInfo"]["name"] == "stagehand_browser"
    assert server._tools is None


def test_sanitize_error_redacts_browserbase_credentials() -> None:
    error = "wss://example.test?apiKey=secret-value&token=another-value sk-abcdef123456"
    sanitized = _sanitize_error(error)
    assert "secret-value" not in sanitized
    assert "another-value" not in sanitized
    assert "123456" not in sanitized


def test_runtime_config_accepts_stagehand_byok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STAGEHAND_MODEL", "openai/gpt-5.4-mini")
    monkeypatch.setenv("STAGEHAND_MODEL_API_KEY", "provider-key")
    config = RuntimeConfig.from_env()
    assert config.stagehand_model == "openai/gpt-5.4-mini"
    assert config.stagehand_model_api_key == "provider-key"


def test_runtime_config_rejects_model_key_without_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("STAGEHAND_MODEL", raising=False)
    monkeypatch.setenv("STAGEHAND_MODEL_API_KEY", "provider-key")
    with pytest.raises(ValueError, match="requires STAGEHAND_MODEL"):
        RuntimeConfig.from_env()


async def test_browserbase_uses_1280_by_720_viewport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    browser = AsyncMock()
    stagehand = AsyncMock()
    launch = AsyncMock(return_value=browser)
    create = AsyncMock(return_value=stagehand)
    monkeypatch.setattr(runtime_module, "browserbase", SimpleNamespace(launch=launch))
    monkeypatch.setattr(runtime_module.Stagehand, "create", create)

    tools = await BrowserTools.start(
        RuntimeConfig(provider="browserbase", browserbase_api_key="browserbase-key")
    )
    await tools.close()

    launch.assert_awaited_once_with(
        api_key="browserbase-key",
        browser_settings={"viewport": {"width": 1280.0, "height": 720.0}},
    )
