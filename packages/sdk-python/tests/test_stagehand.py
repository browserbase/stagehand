from __future__ import annotations

import asyncio
import importlib
from collections.abc import Awaitable, Callable
from typing import cast

import pytest
from pydantic import BaseModel, StrictInt

from stagehand import (
    LLMGenerateInput,
    LLMGenerateOutput,
    LLMImageContent,
    Page,
    ProtocolLocator,
    Stagehand,
)
from stagehand._generated.models import (
    Action,
    ActResult,
    ActResultData,
    BrowserbaseRegion,
    BrowserSessionMetadata,
    CacheStatus,
    ClientModelReference,
    LLMGenerateParams,
    LLMGenerateResult,
    LLMRole,
    LLMStructuredGenerateParams,
    LLMStructuredGenerateResult,
    LLMTextContent,
    ModelConfig,
    ObserveResult,
    PageRef,
    StagehandActParams,
    StagehandCloseResult,
    StagehandExtractParams,
    StagehandInitParams,
    StagehandInitResult,
    StagehandLog,
    StagehandMetrics,
    StagehandObserveParams,
    StagehandResultMetadata,
    TelemetryConfig,
)
from stagehand.browser import (
    _BROWSER_TOKEN,
    StagehandBrowser,
    _ClaimedBrowser,
    _WorkerInitMetadata,
)
from stagehand.cdp_client import CDPClient, CDPConnectionClosedError
from stagehand.client_models import CacheOptions, StagehandClientLoggingConfig
from stagehand.rpc_client import RPCClient

from ._support import RecordingRPCClient

stagehand_module = importlib.import_module("stagehand.stagehand")


class PageInfo(BaseModel):
    heading: str
    count: StrictInt


class _Transport:
    def __init__(self, web_socket_debugger_url: str | None = "ws://browser") -> None:
        self.web_socket_debugger_url = web_socket_debugger_url
        self.close_calls = 0

    async def close(self) -> None:
        self.close_calls += 1


def _browser_handle(
    *,
    api_key: str | None = None,
    browser_metadata: BrowserSessionMetadata | None = None,
    web_socket_debugger_url: str | None = "ws://browser",
) -> tuple[StagehandBrowser, _Transport]:
    transport = _Transport(web_socket_debugger_url)
    return (
        StagehandBrowser(
            "local",
            "connected",
            _ClaimedBrowser(
                cdp_client=cast(CDPClient, transport),
                worker_init_metadata=_WorkerInitMetadata(
                    api_key=api_key,
                    browser=browser_metadata,
                ),
            ),
            transport.close,
            _token=_BROWSER_TOKEN,
        ),
        transport,
    )


def _recording(
    responses: dict[str, object] | None = None,
) -> RecordingRPCClient:
    defaults: dict[str, object] = {
        "stagehand.init": StagehandInitResult(initialized=True, pages=[]),
        "stagehand.close": StagehandCloseResult(closed=True),
    }
    defaults.update(responses or {})
    return RecordingRPCClient(defaults)


def _install_rpc_client(
    monkeypatch: pytest.MonkeyPatch,
    recording: RecordingRPCClient,
) -> None:
    def build_rpc_client(
        _transport: object,
        *,
        request_timeout_ms: int,
    ) -> RPCClient:
        assert request_timeout_ms == 10_000
        return cast(RPCClient, recording)

    monkeypatch.setattr(stagehand_module, "RPCClient", build_rpc_client)


def test_stagehand_constructor_is_private() -> None:
    with pytest.raises(TypeError, match="Stagehand.create"):
        Stagehand()


@pytest.mark.asyncio
async def test_create_requires_a_factory_browser_before_validating_config() -> None:
    with pytest.raises(TypeError, match="browser must be created by local_browser or browserbase"):
        await Stagehand.create(
            browser=object(),  # ty: ignore[invalid-argument-type]
            model_api_key="unused",
        )


@pytest.mark.asyncio
async def test_create_builds_wire_params_and_worker_metadata_wins(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording = _recording()
    _install_rpc_client(monkeypatch, recording)
    metadata = BrowserSessionMetadata(
        session_id="session-1",
        region=BrowserbaseRegion.us_west_2,
    )
    browser, _ = _browser_handle(
        api_key="worker-key",
        browser_metadata=metadata,
    )

    async def generate(_: LLMGenerateInput) -> LLMGenerateOutput:
        return LLMStructuredGenerateResult.model_validate({
            "role": "assistant",
            "content": {"type": "text", "text": "{}"},
            "output_format": "json_schema",
            "structured_content": {},
        })

    stagehand = await Stagehand.create(
        browser=browser,
        api_key="caller-key",
        model=generate,
        logging=StagehandClientLoggingConfig(level="debug"),
    )

    assert stagehand.browser is browser
    params = cast(StagehandInitParams, recording.calls[0][1])
    assert params.protocol_version == 1
    assert params.client_info.name == "stagehand-sdk-python"
    assert params.client_info.version
    assert params.browser_cdp_url == "ws://browser"
    assert params.log_level == "debug"
    assert params.model == ClientModelReference(source="client")
    assert params.api_key == "worker-key"
    assert params.browser == metadata
    assert "llm.generate" in recording.requests


@pytest.mark.asyncio
async def test_local_browser_omits_metadata_and_forwards_caller_options(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording = _recording()
    _install_rpc_client(monkeypatch, recording)
    browser, _ = _browser_handle()
    telemetry = TelemetryConfig.model_validate({
        "traces": {
            "endpoint": "https://telemetry.example/v1/traces",
            "headers": {"authorization": "secret"},
        }
    })

    await Stagehand.create(
        browser=browser,
        api_key="caller-key",
        model="openai/gpt-5.4-mini",
        model_api_key="model-key",
        telemetry=telemetry,
        system_prompt="Use the test policy",
        self_heal=True,
        dom_settle_timeout_ms=2_500,
        cache=CacheOptions(threshold=3),
    )

    params = cast(StagehandInitParams, recording.calls[0][1])
    assert params.api_key == "caller-key"
    assert "browser" not in params.model_fields_set
    assert params.telemetry == telemetry
    assert params.system_prompt == "Use the test policy"
    assert params.self_heal is True
    assert params.dom_settle_timeout_ms == 2_500
    assert params.cache is not None
    assert params.cache.model_dump() == {"threshold": 3}


@pytest.mark.asyncio
async def test_create_rejects_model_connection_options_for_missing_or_callback_models(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def generate(_: LLMGenerateInput) -> LLMGenerateOutput:
        raise AssertionError

    browser, _ = _browser_handle()
    with pytest.raises(TypeError, match="require a model name"):
        await Stagehand.create(browser=browser, model_api_key="key")
    with pytest.raises(TypeError, match="cannot be used with an LLM callback"):
        await Stagehand.create(browser=browser, model=generate, model_base_url="https://llm")


@pytest.mark.asyncio
async def test_create_claim_errors_for_closed_and_attached_handles(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording = _recording()
    _install_rpc_client(monkeypatch, recording)
    closed, _ = _browser_handle()
    await closed.close()
    with pytest.raises(RuntimeError, match="Cannot attach Stagehand to a closed browser"):
        await Stagehand.create(browser=closed)

    attached, _ = _browser_handle()
    stagehand = await Stagehand.create(browser=attached)
    with pytest.raises(RuntimeError, match="already attached"):
        await Stagehand.create(browser=attached)
    await stagehand.close()


@pytest.mark.asyncio
async def test_failed_create_releases_claim_and_keeps_browser_open_for_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failed = _recording({"stagehand.init": RuntimeError("init failed")})
    _install_rpc_client(monkeypatch, failed)
    browser, transport = _browser_handle()

    with pytest.raises(RuntimeError, match="init failed"):
        await Stagehand.create(browser=browser)

    assert failed.closed is True
    assert failed.close_transport_flags == [False]
    assert failed.notifications == {}
    assert failed.requests == {}
    assert browser.closed is False
    assert transport.close_calls == 0

    successful = _recording()
    _install_rpc_client(monkeypatch, successful)
    stagehand = await Stagehand.create(browser=browser)
    assert stagehand.initialized is True


@pytest.mark.asyncio
async def test_failed_create_for_missing_cdp_url_can_retry_same_handle(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failed = _recording()
    _install_rpc_client(monkeypatch, failed)
    browser, transport = _browser_handle(web_socket_debugger_url=None)

    with pytest.raises(RuntimeError, match="The browser CDP WebSocket URL is unavailable"):
        await Stagehand.create(browser=browser)

    transport.web_socket_debugger_url = "ws://recovered"
    successful = _recording()
    _install_rpc_client(monkeypatch, successful)
    stagehand = await Stagehand.create(browser=browser)
    assert stagehand.initialized is True


@pytest.mark.asyncio
async def test_close_is_memoized_and_never_closes_browser_or_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording = _recording()
    _install_rpc_client(monkeypatch, recording)
    browser, transport = _browser_handle()
    stagehand = await Stagehand.create(browser=browser)

    await asyncio.gather(stagehand.close(), stagehand.close(), stagehand.close())
    await stagehand.close()

    assert stagehand.initialized is False
    assert [call[0] for call in recording.calls].count("stagehand.close") == 1
    assert recording.close_transport_flags == [False]
    assert browser.closed is False
    assert transport.close_calls == 0
    with pytest.raises(RuntimeError, match="Stagehand is unavailable.*Stagehand.create"):
        _ = stagehand.context
    with pytest.raises(RuntimeError, match="Stagehand is unavailable.*Stagehand.create"):
        await stagehand.metrics()


@pytest.mark.asyncio
async def test_close_swallows_cdp_connection_closed_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording = _recording({"stagehand.close": CDPConnectionClosedError()})
    _install_rpc_client(monkeypatch, recording)
    browser, _ = _browser_handle()
    stagehand = await Stagehand.create(browser=browser)

    await stagehand.close()

    assert recording.closed is True
    assert recording.close_transport_flags == [False]


@pytest.mark.asyncio
async def test_stagehand_prints_logs_and_calls_structured_callback(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    recording = _recording()
    _install_rpc_client(monkeypatch, recording)
    browser, _ = _browser_handle()
    received: list[StagehandLog] = []

    async def on_log(log: StagehandLog) -> None:
        received.append(log)

    await Stagehand.create(
        browser=browser,
        logging=StagehandClientLoggingConfig(level="info", on_log=on_log),
    )
    _, listener = recording.notifications["stagehand.log"]
    notification_listener = cast(Callable[[StagehandLog], Awaitable[None]], listener)
    debug = StagehandLog.model_validate({
        "level": "debug",
        "message": "hidden",
        "data": {},
    })
    info = StagehandLog.model_validate({
        "level": "info",
        "message": "Page opened",
        "data": {"pageId": "page-1"},
    })

    await notification_listener(debug)
    await notification_listener(info)

    assert capsys.readouterr().err == '[stagehand] INFO Page opened {"pageId":"page-1"}\n'
    assert received == [info]


@pytest.mark.asyncio
async def test_callback_llm_handler_preserves_structured_and_image_content(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording = _recording()
    _install_rpc_client(monkeypatch, recording)
    browser, _ = _browser_handle()
    callback_params: list[LLMGenerateInput] = []

    async def generate(params: LLMGenerateInput) -> LLMGenerateOutput:
        callback_params.append(params)
        return LLMStructuredGenerateResult.model_validate({
            "role": LLMRole.assistant,
            "content": LLMTextContent(type="text", text='{"answer":true}'),
            "output_format": "json_schema",
            "structured_content": {"answer": True},
        })

    await Stagehand.create(browser=browser, model=generate)
    handler = cast(
        Callable[[LLMGenerateParams], Awaitable[LLMGenerateResult]],
        recording.requests["llm.generate"][2],
    )
    result = await handler(
        LLMGenerateParams.model_validate({
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Answer"},
                        {"type": "image", "data": "iVBORw0KGgo=", "mime_type": "image/png"},
                    ],
                }
            ],
            "response_format": {
                "type": "json_schema",
                "name": "answer",
                "schema": {"type": "object"},
            },
        })
    )

    assert isinstance(callback_params[0], LLMStructuredGenerateParams)
    content = callback_params[0].messages[0].content
    assert isinstance(content, list)
    assert isinstance(content[1].root, LLMImageContent)
    assert isinstance(result.root, LLMStructuredGenerateResult)


@pytest.mark.asyncio
async def test_stagehand_routes_metrics_and_ai_methods(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    action = Action(selector="a", description="More information")
    act_data = ActResultData(
        success=True,
        message="Clicked the link",
        action_description="Clicked the more information link",
        actions=[action],
    )
    metrics = StagehandMetrics.model_validate({
        field: float(index) for index, field in enumerate(StagehandMetrics.model_fields, start=1)
    })
    recording = _recording({
        "context.active_page": PageRef(page_id="active-page"),
        "stagehand.metrics": metrics,
        "stagehand.act": ActResult.model_validate({
            "data": act_data,
            "metadata": {"cache_status": "HIT"},
        }),
        "stagehand.observe": ObserveResult.model_validate({
            "data": [action],
            "metadata": {"cache_status": "MISS"},
        }),
        "stagehand.extract": {
            "data": {"heading": "Example Domain", "count": 1},
            "metadata": StagehandResultMetadata(cache_status=CacheStatus.hit),
        },
    })
    _install_rpc_client(monkeypatch, recording)
    browser, _ = _browser_handle()
    stagehand = await Stagehand.create(browser=browser)
    page = Page(cast(RPCClient, recording), PageRef(page_id="explicit-page"))
    model = ModelConfig.model_validate({"model_name": "openai/gpt-4.1-mini"})
    locator = ProtocolLocator(selector="main")

    assert await stagehand.metrics() == metrics
    act_result = await stagehand.act(
        "Click the link",
        page=page,
        model=model,
        timeout=30_000,
        locator=locator,
        cache=CacheOptions(threshold=1),
    )
    observed = await stagehand.observe(instruction="Find the link", model=model, locator=locator)
    extracted = await stagehand.extract(
        instruction="Extract the heading",
        schema=PageInfo,
        page=page,
        model=model,
        screenshot=True,
        locator=locator,
    )

    assert act_result.data == act_data
    assert observed.data == [action]
    assert extracted.data == PageInfo(heading="Example Domain", count=1)
    act_params = next(
        cast(StagehandActParams, params)
        for method, params, _ in recording.calls
        if method == "stagehand.act"
    )
    assert act_params.options is not None
    assert act_params.options.cache is not None
    observe_params = next(
        cast(StagehandObserveParams, params)
        for method, params, _ in recording.calls
        if method == "stagehand.observe"
    )
    assert observe_params.page_id == "active-page"
    extract_params = next(
        cast(StagehandExtractParams, params)
        for method, params, _ in recording.calls
        if method == "stagehand.extract"
    )
    assert extract_params.page_id == "explicit-page"


@pytest.mark.asyncio
async def test_stagehand_ai_methods_require_an_active_page(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording = _recording({"context.active_page": None})
    _install_rpc_client(monkeypatch, recording)
    browser, _ = _browser_handle()
    stagehand = await Stagehand.create(browser=browser)

    with pytest.raises(RuntimeError, match="no active page"):
        await stagehand.act("Click the link")
