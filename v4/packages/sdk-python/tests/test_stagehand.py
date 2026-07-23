from __future__ import annotations

import asyncio
import importlib
from collections.abc import Awaitable, Callable
from typing import TypeVar, cast

import pytest
from pydantic import BaseModel

from stagehand import LLMGenerateInput, LLMGenerateOutput, Page, ProtocolLocator, Stagehand
from stagehand._generated.models import (
    Action,
    ActResult,
    ActResultData,
    BrowserGetVersionResult,
    ClientModelReference,
    ExtractResult,
    KnownModelConfig,
    LLMGenerateParams,
    LLMGenerateResult,
    LLMRole,
    LLMStructuredGenerateParams,
    LLMStructuredGenerateResult,
    LLMTextContent,
    ModelConfig,
    ObserveResult,
    PageRef,
    RuntimeLoopbackStatusResult,
    StagehandActParams,
    StagehandCloseResult,
    StagehandExtractParams,
    StagehandInitParams,
    StagehandInitResult,
    StagehandMetrics,
    StagehandObserveParams,
    StagehandPingResult,
)
from stagehand.browser_source import ResolvedBrowserSource
from stagehand.cdp_client import CDPConnectionClosedError
from stagehand.client_models import (
    CacheOptions,
    CdpBrowserSource,
    LocalBrowserSource,
    StagehandClientInitParams,
)
from stagehand.rpc_client import RPCClient

from ._support import RecordingRPCClient

stagehand_module = importlib.import_module("stagehand.stagehand")
BlockingResultT = TypeVar("BlockingResultT", bound=BaseModel)


class PageInfo(BaseModel):
    heading: str


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
async def test_stagehand_ai_methods_resolve_pages_and_validate_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    action = Action(selector="a", description="More information")
    act_result = ActResultData(
        success=True,
        message="Clicked the link",
        action_description="Clicked the more information link",
        actions=[action],
    )
    recording = RecordingRPCClient({
        "stagehand.init": StagehandInitResult(initialized=True, pages=[]),
        "context.active_page": PageRef(page_id="active-page"),
        "stagehand.act": ActResult(result=act_result),
        "stagehand.observe": ObserveResult(result=[action]),
        "stagehand.extract": ExtractResult(result={"heading": "Example Domain"}),
    })
    model = ModelConfig.model_validate({"model_name": "openai/gpt-4.1-mini"})
    locator = ProtocolLocator(css="main")

    async def resolve(_: StagehandClientInitParams) -> ResolvedBrowserSource:
        return ResolvedBrowserSource(cdp_url="test://browser", keep_alive=True)

    async def connect(**_: object) -> RPCClient:
        return cast(RPCClient, recording)

    monkeypatch.setattr(stagehand_module, "resolve_browser_source", resolve)
    monkeypatch.setattr(stagehand_module, "connect_rpc_client", connect)
    stagehand = Stagehand(browser="cdp", cdp_url="test://browser")
    await stagehand.init()
    page = Page(cast(RPCClient, recording), PageRef(page_id="explicit-page"))

    action_result = await stagehand.act(
        "Click the link",
        page=page,
        model=model,
        timeout=30_000,
        locator=locator,
        cache=CacheOptions(threshold=1),
    )
    actions = await stagehand.observe(instruction="Find the link", model=model, locator=locator)
    page_info = await stagehand.extract(
        instruction="Extract the heading",
        schema=PageInfo,
        page=page,
        model=model,
        locator=locator,
    )

    assert action_result == act_result
    assert actions == [action]
    assert page_info == PageInfo(heading="Example Domain")
    assert [call[0] for call in recording.calls] == [
        "stagehand.init",
        "stagehand.act",
        "context.active_page",
        "stagehand.observe",
        "stagehand.extract",
    ]
    act_params = recording.calls[1][1]
    assert isinstance(act_params, StagehandActParams)
    assert act_params.page_id == "explicit-page"
    assert act_params.options is not None
    assert act_params.options.model == model
    assert act_params.options.timeout == 30_000
    assert act_params.options.locator == locator
    assert act_params.options.cache is not None
    assert act_params.options.cache.model_dump() == {"threshold": 1}
    observe_params = recording.calls[3][1]
    assert isinstance(observe_params, StagehandObserveParams)
    assert observe_params.page_id == "active-page"
    assert observe_params.instruction == "Find the link"
    assert observe_params.options is not None
    assert observe_params.options.model == model
    assert observe_params.options.locator == locator
    extract_params = recording.calls[4][1]
    assert isinstance(extract_params, StagehandExtractParams)
    assert extract_params.page_id == "explicit-page"
    assert extract_params.options is not None
    assert extract_params.options.model == model
    assert extract_params.options.locator == locator
    assert extract_params.schema_ is not None
    schema = extract_params.schema_.model_dump()
    assert isinstance(schema, dict)
    properties = schema["properties"]
    assert isinstance(properties, dict)
    heading = properties["heading"]
    assert isinstance(heading, dict)
    assert heading["type"] == "string"


@pytest.mark.asyncio
async def test_stagehand_ai_methods_require_an_active_page(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording = RecordingRPCClient({
        "stagehand.init": StagehandInitResult(initialized=True, pages=[]),
        "context.active_page": None,
    })

    async def resolve(_: StagehandClientInitParams) -> ResolvedBrowserSource:
        return ResolvedBrowserSource(cdp_url="test://browser", keep_alive=True)

    async def connect(**_: object) -> RPCClient:
        return cast(RPCClient, recording)

    monkeypatch.setattr(stagehand_module, "resolve_browser_source", resolve)
    monkeypatch.setattr(stagehand_module, "connect_rpc_client", connect)
    stagehand = Stagehand(browser="cdp", cdp_url="test://browser")
    await stagehand.init()

    with pytest.raises(RuntimeError, match="no active page"):
        await stagehand.act("Click the link")

    assert [call[0] for call in recording.calls] == [
        "stagehand.init",
        "context.active_page",
    ]


@pytest.mark.asyncio
async def test_stagehand_serializes_lifecycle_and_treats_close_disconnect_as_successful(
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
        "stagehand.close": CDPConnectionClosedError(),
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

    await asyncio.gather(stagehand.close(), stagehand.close())

    assert stagehand.initialized is False
    assert [method for method, _, _ in recording.calls].count("stagehand.close") == 1
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
