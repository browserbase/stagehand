from __future__ import annotations

import asyncio
import importlib
from collections.abc import Awaitable, Callable
from typing import TypeVar, cast

import pytest
from pydantic import BaseModel

from stagehand import LLMGenerateInput, LLMGenerateOutput, Stagehand
from stagehand._generated.models import (
    BrowserGetVersionResult,
    ClientModelReference,
    KnownModelConfig,
    LLMGenerateParams,
    LLMGenerateResult,
    LLMRole,
    LLMStructuredGenerateParams,
    LLMStructuredGenerateResult,
    LLMTextContent,
    ModelConfig,
    RuntimeLoopbackStatusResult,
    StagehandCloseResult,
    StagehandInitParams,
    StagehandInitResult,
    StagehandMetrics,
    StagehandPingResult,
)
from stagehand.browser_source import ResolvedBrowserSource
from stagehand.client_models import CdpBrowserSource, LocalBrowserSource, StagehandClientInitParams
from stagehand.rpc_client import RPCClient

from ._support import RecordingRPCClient

stagehand_module = importlib.import_module("stagehand.stagehand")
BlockingResultT = TypeVar("BlockingResultT", bound=BaseModel)


def test_stagehand_constructor_builds_private_browser_and_model_models() -> None:
    local = Stagehand(
        browser="local",
        headless=True,
        viewport_width=1280,
        viewport_height=800,
        model="openai/gpt-5.4-mini",
        model_api_key="model-key",
        cache=True,
    )
    cdp = Stagehand(
        browser="cdp",
        cdp_url="http://localhost:9222",
        headers={"authorization": "secret"},
    )
    browserbase = Stagehand(api_key="browserbase-key")

    assert isinstance(local.init_params.browser, LocalBrowserSource)
    assert local.init_params.browser.headless is True
    assert local.init_params.browser.viewport is not None
    assert local.init_params.browser.viewport.width == 1280
    assert isinstance(local.init_params.model, ModelConfig)
    assert isinstance(local.init_params.model.root, KnownModelConfig)
    assert local.init_params.cache is not None
    assert local.init_params.cache.root is True
    assert local.init_params.model.root.model_name.model_dump() == "openai/gpt-5.4-mini"
    assert local.init_params.model.root.api_key == "model-key"
    assert isinstance(cdp.init_params.browser, CdpBrowserSource)
    assert cdp.init_params.browser.headers == {"authorization": "secret"}
    assert browserbase.init_params.browser.type == "browserbase"


def test_stagehand_constructor_rejects_incomplete_flattened_options() -> None:
    with pytest.raises(TypeError, match="viewport_width and viewport_height"):
        Stagehand(browser="local", viewport_width=1280)
    with pytest.raises(TypeError, match="proxy_server"):
        Stagehand(browser="local", proxy_username="user")
    with pytest.raises(TypeError, match="model connection options"):
        Stagehand(browser="local", model_api_key="model-key")


@pytest.mark.asyncio
async def test_stagehand_routes_public_runtime_status_and_metrics_methods(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    metrics = StagehandMetrics.model_validate({
        field: float(index) for index, field in enumerate(StagehandMetrics.model_fields, start=1)
    })
    recording = RecordingRPCClient({
        "ping": StagehandPingResult(ok=True, runtime="service_worker"),
        "runtime.loopback_status": RuntimeLoopbackStatusResult(
            configured=True,
            connected=True,
        ),
        "browser.get_version": BrowserGetVersionResult(
            protocol_version="1.3",
            product="Chrome/1",
        ),
        "stagehand.metrics": metrics,
    })
    recording.responses["stagehand.init"] = StagehandInitResult(initialized=True, pages=[])

    async def resolve(_: StagehandClientInitParams) -> ResolvedBrowserSource:
        return ResolvedBrowserSource(cdp_url="test://browser", keep_alive=True)

    async def connect(**_: object) -> RPCClient:
        return cast(RPCClient, recording)

    monkeypatch.setattr(stagehand_module, "resolve_browser_source", resolve)
    monkeypatch.setattr(stagehand_module, "connect_rpc_client", connect)
    stagehand = Stagehand(browser="cdp", cdp_url="test://browser")
    await stagehand.init()

    assert await stagehand.ping() == StagehandPingResult(ok=True, runtime="service_worker")
    assert await stagehand.runtime_loopback_status() == RuntimeLoopbackStatusResult(
        configured=True,
        connected=True,
    )
    assert await stagehand.browser_get_version() == BrowserGetVersionResult(
        protocol_version="1.3",
        product="Chrome/1",
    )
    assert await stagehand.metrics() == metrics
    assert [method for method, _, _ in recording.calls[1:]] == [
        "ping",
        "runtime.loopback_status",
        "browser.get_version",
        "stagehand.metrics",
    ]


@pytest.mark.asyncio
async def test_stagehand_serializes_initialization_and_closes_every_owned_resource(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    browser_closes = 0

    async def close_browser() -> None:
        nonlocal browser_closes
        browser_closes += 1

    browser = ResolvedBrowserSource(
        cdp_url="test://browser",
        keep_alive=False,
        _close_callback=close_browser,
    )
    recording = RecordingRPCClient({
        "stagehand.init": StagehandInitResult(initialized=True, pages=[]),
        "stagehand.close": StagehandCloseResult(closed=True),
    })

    async def resolve(_: StagehandClientInitParams) -> ResolvedBrowserSource:
        return browser

    async def connect(**_: object) -> RPCClient:
        return cast(RPCClient, recording)

    callback_params: list[LLMGenerateInput] = []

    async def generate(params: LLMGenerateInput) -> LLMGenerateOutput:
        callback_params.append(params)
        return LLMStructuredGenerateResult.model_validate({
            "role": LLMRole.assistant,
            "content": LLMTextContent(type="text", text='{"answer":true}'),
            "output_format": "json_schema",
            "structured_content": {"answer": True},
        })

    monkeypatch.setattr(stagehand_module, "resolve_browser_source", resolve)
    monkeypatch.setattr(stagehand_module, "connect_rpc_client", connect)
    stagehand = Stagehand(
        browser="cdp",
        cdp_url="test://browser",
        model=generate,
    )

    await asyncio.gather(stagehand.init(), stagehand.init())

    assert stagehand.initialized is True
    assert stagehand.context is not None
    assert [call[0] for call in recording.calls] == ["stagehand.init"]
    params_schema, result_schema, _ = recording.requests["llm.generate"]
    assert params_schema is LLMGenerateParams
    assert result_schema is LLMGenerateResult
    handler = cast(
        Callable[[LLMGenerateParams], Awaitable[LLMGenerateResult]],
        recording.requests["llm.generate"][2],
    )
    callback_result = await handler(
        LLMGenerateParams.model_validate({
            "messages": [{"role": "user", "content": {"type": "text", "text": "Answer"}}],
            "response_format": {
                "type": "json_schema",
                "name": "answer",
                "schema": {"type": "object"},
            },
        })
    )
    assert len(callback_params) == 1
    assert isinstance(callback_params[0], LLMStructuredGenerateParams)
    assert isinstance(callback_result.root, LLMStructuredGenerateResult)
    init_params = recording.calls[0][1]
    assert isinstance(init_params, StagehandInitParams)
    assert "browser" not in init_params.model_fields_set
    assert init_params.model == ClientModelReference(source="client")

    await stagehand.close()

    assert stagehand.initialized is False
    assert recording.closed is True
    assert browser_closes == 1
    with pytest.raises(RuntimeError, match="not initialized"):
        _ = stagehand.context


@pytest.mark.asyncio
async def test_stagehand_closes_the_browser_when_rpc_cleanup_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    browser_closed = False

    async def close_browser() -> None:
        nonlocal browser_closed
        browser_closed = True

    class FailingCloseRPCClient(RecordingRPCClient):
        async def close(self, reason: BaseException | None = None) -> None:
            await super().close(reason)
            raise RuntimeError("RPC close failed")

    browser = ResolvedBrowserSource(
        cdp_url="test://browser",
        keep_alive=False,
        _close_callback=close_browser,
    )
    recording = FailingCloseRPCClient({
        "stagehand.init": StagehandInitResult(initialized=True, pages=[]),
        "stagehand.close": StagehandCloseResult(closed=True),
    })

    async def resolve(_: StagehandClientInitParams) -> ResolvedBrowserSource:
        return browser

    async def connect(**_: object) -> RPCClient:
        return cast(RPCClient, recording)

    monkeypatch.setattr(stagehand_module, "resolve_browser_source", resolve)
    monkeypatch.setattr(stagehand_module, "connect_rpc_client", connect)
    stagehand = Stagehand(browser="cdp", cdp_url="test://browser")
    await stagehand.init()

    with pytest.raises(RuntimeError, match="RPC close failed"):
        await stagehand.close()

    assert browser_closed is True
    assert stagehand.initialized is False


@pytest.mark.asyncio
async def test_cancelled_initialization_still_releases_the_browser_and_rpc_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    browser_closed = False
    init_started = asyncio.Event()
    never_complete = asyncio.Event()

    async def close_browser() -> None:
        nonlocal browser_closed
        browser_closed = True

    class BlockingRPCClient(RecordingRPCClient):
        async def send(
            self,
            method: str,
            params: BaseModel,
            result_model: type[BlockingResultT],
        ) -> BlockingResultT:
            if method == "stagehand.init":
                init_started.set()
                await never_complete.wait()
            raise AssertionError(f"Unexpected method: {method}")

    browser = ResolvedBrowserSource(
        cdp_url="test://browser",
        keep_alive=False,
        _close_callback=close_browser,
    )
    recording = BlockingRPCClient()

    async def resolve(_: StagehandClientInitParams) -> ResolvedBrowserSource:
        return browser

    async def connect(**_: object) -> RPCClient:
        return cast(RPCClient, recording)

    monkeypatch.setattr(stagehand_module, "resolve_browser_source", resolve)
    monkeypatch.setattr(stagehand_module, "connect_rpc_client", connect)
    stagehand = Stagehand(browser="cdp", cdp_url="test://browser")
    task = asyncio.create_task(stagehand.init())
    await init_started.wait()

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert recording.closed is True
    assert browser_closed is True
    assert stagehand.initialized is False
