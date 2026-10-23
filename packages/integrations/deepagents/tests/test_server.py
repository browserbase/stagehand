from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from stagehand_middleware.facade import facade_instructions, facade_tools

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


async def test_server_advertises_the_facade_contract() -> None:
    server = StdioServer()
    response = await server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert response is not None
    assert response["result"]["tools"] == facade_tools()


def test_managed_example_instructions_match_the_facade_contract() -> None:
    instructions = Path(__file__).parents[1] / "examples" / "managed" / "instructions.md"
    expected = f"# Stagehand browser agent\n\n{facade_instructions().rstrip()}\n"
    assert instructions.read_text(encoding="utf-8") == expected


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


def test_runtime_config_defaults_local_browser_to_headed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("STAGEHAND_HEADLESS", raising=False)
    assert RuntimeConfig().headless is False
    assert RuntimeConfig.from_env().headless is False


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


def test_runtime_config_reads_facade_options(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("STAGEHAND_FACADE_QUIET_WAIT", raising=False)
    monkeypatch.delenv("STAGEHAND_ARTIFACT_ROOT", raising=False)
    assert RuntimeConfig.from_env().quiet_wait is False
    assert RuntimeConfig.from_env().artifact_root is None
    monkeypatch.setenv("STAGEHAND_FACADE_QUIET_WAIT", "1")
    monkeypatch.setenv("STAGEHAND_ARTIFACT_ROOT", "/tmp/artifacts")
    config = RuntimeConfig.from_env()
    assert config.quiet_wait is True
    assert config.artifact_root == "/tmp/artifacts"


async def test_browser_tools_pass_options_to_the_facade(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created: dict[str, object] = {}

    class FakeFacade:
        def __init__(self, stagehand: object, **options: object) -> None:
            created.update(options)
            self.run = AsyncMock(return_value={"completed": 1, "url": "https://example.com/"})

    monkeypatch.setattr(runtime_module, "StagehandFacadeTools", FakeFacade)
    tools = BrowserTools(
        stagehand=AsyncMock(),
        browser=AsyncMock(),
        config=RuntimeConfig(quiet_wait=True, artifact_root="out"),
    )
    actions = [{"op": "click", "id": "1-2"}]
    assert await tools.run(actions=actions) == {"completed": 1, "url": "https://example.com/"}
    tools._facade.run.assert_awaited_once_with(code=None, actions=actions)
    assert created["quiet_wait"] is True
    assert created["artifact_root"] == "out"
    assert callable(created["on_close_requested"])


async def test_close_shuts_down_stagehand_then_browser_once() -> None:
    calls: list[str] = []
    stagehand = AsyncMock()
    browser = AsyncMock()
    stagehand.close.side_effect = lambda: calls.append("stagehand")
    browser.close.side_effect = lambda: calls.append("browser")
    tools = BrowserTools(stagehand=stagehand, browser=browser, config=RuntimeConfig())
    await tools.close()
    await tools.close()
    assert calls == ["stagehand", "browser"]
