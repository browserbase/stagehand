from __future__ import annotations

import asyncio
import importlib
import inspect
import json
from collections.abc import Awaitable, Callable
from typing import TypeVar, assert_type, cast, overload

import pytest
from pydantic import BaseModel, RootModel, StrictInt

from stagehand import (
    DefaultExtract,
    ExtractResult,
    LLMGenerateInput,
    LLMGenerateOutput,
    LLMImageContent,
    ModelConfig,
    Page,
    Stagehand,
    TelemetryConfig,
)
from stagehand import timeouts as timeout_settings
from stagehand._generated.models import (
    Action,
    ActResult,
    ActResultData,
    BrowserbaseRegion,
    BrowserSessionMetadata,
    CacheMetadata,
    CacheStatus,
    CallbackBatchParams,
    ClientModelReference,
    LLMGenerateParams,
    LLMGenerateResult,
    LLMRole,
    LLMStructuredGenerateParams,
    LLMStructuredGenerateResult,
    LLMTextContent,
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
    StagehandResultUsage,
)
from stagehand._generated.protocol_version import STAGEHAND_PROTOCOL_VERSION
from stagehand.browser import (
    _BROWSER_TOKEN,
    StagehandBrowser,
    _browser_session_metadata,
    _ClaimedBrowser,
    _WorkerInitMetadata,
)
from stagehand.cdp_client import CDPClient, CDPConnectionClosedError
from stagehand.rpc_client import RPCClient, RPCError, _JSONRPCError

from ._support import RecordingRPCClient

stagehand_module = importlib.import_module("stagehand.stagehand")
ResultT = TypeVar("ResultT", bound=BaseModel)
RootResultT = TypeVar("RootResultT")


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
    ) -> RPCClient:
        return cast(RPCClient, recording)

    monkeypatch.setattr(stagehand_module, "RPCClient", build_rpc_client)


def test_stagehand_constructor_is_private() -> None:
    with pytest.raises(TypeError, match="Stagehand.create"):
        Stagehand()


def test_stagehand_does_not_expose_context() -> None:
    assert not hasattr(Stagehand, "context")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("source", "input_value", "timeout", "error_type", "message"),
    [
        (123, None, 30_000, TypeError, "non-empty JavaScript string"),
        ("   ", None, 30_000, TypeError, "non-empty JavaScript string"),
        ("async () => undefined", None, True, ValueError, "positive number"),
        ("async () => undefined", None, 0, ValueError, "positive number"),
        ("async () => undefined", None, 1.5, ValueError, "positive number"),
        ("async () => undefined", None, 2_147_473_648, ValueError, "must not exceed"),
        ("async () => undefined", object(), 30_000, TypeError, "JSON-serializable"),
    ],
)
async def test_experimental_batch_validates_arguments_before_transport(
    monkeypatch: pytest.MonkeyPatch,
    source: object,
    input_value: object,
    timeout: object,
    error_type: type[Exception],
    message: str,
) -> None:
    recording = _recording()
    _install_rpc_client(monkeypatch, recording)
    browser, _ = _browser_handle()
    stagehand = await Stagehand.create(browser=browser)
    try:
        with pytest.raises(error_type, match=message):
            await stagehand.experimental_batch(
                cast(str, source),
                input_value,
                timeout=cast(int, timeout),
            )
    finally:
        await stagehand.close()


@pytest.mark.asyncio
async def test_experimental_batch_uses_registered_rpc_method(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = "async ({ page }, input) => ({ title: await page.title(), input })"
    recording = _recording({
        "stagehand.callback_batch": {
            "value": {"title": "Example", "input": {"id": 7}},
        }
    })
    _install_rpc_client(monkeypatch, recording)
    browser, _ = _browser_handle()
    stagehand = await Stagehand.create(browser=browser)
    try:
        result = await stagehand.experimental_batch(source, {"id": 7}, timeout=2_000)
        assert result == {"title": "Example", "input": {"id": 7}}
        method, params, _ = recording.calls[-1]
        assert method == "stagehand.callback_batch"
        assert isinstance(params, CallbackBatchParams)
        assert params.callback_source == source
        assert params.options.timeout == 2_000
        assert params.options.model_dump(mode="json", exclude_unset=True) == {"timeout": 2_000}
    finally:
        await stagehand.close()


@pytest.mark.asyncio
async def test_experimental_batch_normalizes_json_object_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording = _recording({"stagehand.callback_batch": {}})
    _install_rpc_client(monkeypatch, recording)
    browser, _ = _browser_handle()
    stagehand = await Stagehand.create(browser=browser)
    try:
        await stagehand.experimental_batch("async (_batch, input) => input", {1: "one"})
        _, params, _ = recording.calls[-1]
        assert isinstance(params, CallbackBatchParams)
        assert params.input is not None
        assert params.input.model_dump(mode="json") == {"1": "one"}
    finally:
        await stagehand.close()


@pytest.mark.asyncio
async def test_experimental_batch_distinguishes_omitted_input_from_null(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording = _recording({"stagehand.callback_batch": {}})
    _install_rpc_client(monkeypatch, recording)
    browser, _ = _browser_handle()
    stagehand = await Stagehand.create(browser=browser)
    try:
        await stagehand.experimental_batch("async () => undefined")
        _, omitted_params, _ = recording.calls[-1]
        assert isinstance(omitted_params, CallbackBatchParams)
        assert "input" not in omitted_params.model_fields_set

        await stagehand.experimental_batch("async () => undefined", None)
        _, null_params, _ = recording.calls[-1]
        assert isinstance(null_params, CallbackBatchParams)
        assert "input" in null_params.model_fields_set
        assert null_params.input is not None
        assert null_params.input.root is None
    finally:
        await stagehand.close()


@pytest.mark.asyncio
async def test_experimental_batch_accepts_maximum_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording = _recording({"stagehand.callback_batch": {}})
    _install_rpc_client(monkeypatch, recording)
    browser, _ = _browser_handle()
    stagehand = await Stagehand.create(browser=browser)
    try:
        await stagehand.experimental_batch(
            "async () => undefined",
            timeout=2_147_473_647,
        )
        _, params, _ = recording.calls[-1]
        assert isinstance(params, CallbackBatchParams)
        assert params.options.timeout == 2_147_473_647
    finally:
        await stagehand.close()


@pytest.mark.asyncio
async def test_experimental_batch_includes_an_explicit_page(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording = _recording({"stagehand.callback_batch": {}})
    _install_rpc_client(monkeypatch, recording)
    browser, _ = _browser_handle()
    stagehand = await Stagehand.create(browser=browser)
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))
    try:
        await stagehand.experimental_batch("async () => undefined", page=page)
        method, params, _ = recording.calls[-1]
        assert method == "stagehand.callback_batch"
        assert isinstance(params, CallbackBatchParams)
        assert params.options.model_dump(mode="json", exclude_unset=True) == {
            "page_id": "page-1",
            "timeout": 30_000,
        }
    finally:
        await stagehand.close()


@pytest.mark.asyncio
async def test_experimental_batch_maps_an_omitted_value_to_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording = _recording({"stagehand.callback_batch": {}})
    _install_rpc_client(monkeypatch, recording)
    browser, _ = _browser_handle()
    stagehand = await Stagehand.create(browser=browser)
    try:
        assert await stagehand.experimental_batch("async () => undefined") is None
    finally:
        await stagehand.close()


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
        api_url="https://api.stagehand.dev.browserbase.com",
        model=generate,
        logging={"level": "debug"},
    )

    assert stagehand.browser is browser
    params = cast(StagehandInitParams, recording.calls[0][1])
    assert params.protocol_version == STAGEHAND_PROTOCOL_VERSION
    assert params.client_info.name == "stagehand-sdk-python"
    assert params.client_info.version
    assert params.browser_cdp_url == "ws://browser"
    assert params.log_level == "debug"
    assert params.model == ClientModelReference(source="client")
    assert params.api_key == "worker-key"
    assert str(params.api_url) == "https://api.stagehand.dev.browserbase.com"
    assert params.browser == metadata
    assert "llm.generate" in recording.requests


@pytest.mark.asyncio
async def test_create_omits_unset_browser_region_from_the_wire(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording = _recording()
    _install_rpc_client(monkeypatch, recording)
    browser, _ = _browser_handle(
        api_key="worker-key",
        browser_metadata=_browser_session_metadata("session-1", None),
    )

    await Stagehand.create(browser=browser)

    params = cast(StagehandInitParams, recording.calls[0][1])
    wire = json.loads(params.model_dump_json(by_alias=True, exclude_unset=True, warnings="none"))
    assert wire["browser"] == {"session_id": "session-1"}


@pytest.mark.asyncio
async def test_local_browser_omits_metadata_and_forwards_caller_options(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording = _recording()
    _install_rpc_client(monkeypatch, recording)
    browser, _ = _browser_handle()
    telemetry: TelemetryConfig = {
        "traces": {
            "endpoint": "https://telemetry.example/v1/traces",
            "headers": {"authorization": "secret"},
        }
    }

    await Stagehand.create(
        browser=browser,
        api_key="caller-key",
        model="openai/gpt-5.4-mini",
        model_api_key="model-key",
        telemetry=telemetry,
        system_prompt="Use the test policy",
        self_heal=True,
        dom_settle_timeout_ms=2_500,
        cache={"threshold": 3},
    )

    params = cast(StagehandInitParams, recording.calls[0][1])
    assert params.api_key == "caller-key"
    assert "browser" not in params.model_fields_set
    assert params.telemetry is not None
    assert params.telemetry.model_dump(mode="json") == telemetry
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
        await Stagehand.create(browser=browser, model=generate, model_api_key="key")


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
    failed = _recording({
        "stagehand.init": RPCError(_JSONRPCError(code=-32603, message="init failed"))
    })
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
async def test_context_close_is_an_alias_for_browser_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording = _recording()
    _install_rpc_client(monkeypatch, recording)
    browser, transport = _browser_handle()
    stagehand = await Stagehand.create(browser=browser)
    try:
        context = browser.context

        await asyncio.gather(context.close(), browser.close(), context.close())

        assert browser.closed is True
        assert transport.close_calls == 1
        assert all(method != "context.close" for method, _params, _result in recording.calls)
    finally:
        await stagehand.close()


@pytest.mark.asyncio
async def test_invalid_success_response_fails_closed_because_initialization_is_ambiguous(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failed = _recording({"stagehand.init": ValueError("invalid init result")})
    _install_rpc_client(monkeypatch, failed)
    browser, transport = _browser_handle()

    with pytest.raises(ValueError, match="invalid init result"):
        await Stagehand.create(browser=browser)

    assert failed.closed is True
    assert failed.close_transport_flags == [False]
    assert browser.closed is True
    assert transport.close_calls == 1
    with pytest.raises(RuntimeError, match="Cannot attach Stagehand to a closed browser"):
        await Stagehand.create(browser=browser)


@pytest.mark.asyncio
async def test_ambiguous_initialization_uses_browser_invalidation_not_public_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failed = _recording({"stagehand.init": ValueError("invalid init result")})
    _install_rpc_client(monkeypatch, failed)
    transport = _Transport()
    close_calls = 0
    invalidation_calls = 0

    async def close() -> None:
        nonlocal close_calls
        close_calls += 1

    async def invalidate() -> None:
        nonlocal invalidation_calls
        invalidation_calls += 1
        await transport.close()

    browser = StagehandBrowser(
        "local",
        "connected",
        _ClaimedBrowser(
            cdp_client=cast(CDPClient, transport),
            worker_init_metadata=_WorkerInitMetadata(api_key=None, browser=None),
        ),
        close,
        invalidate=invalidate,
        _token=_BROWSER_TOKEN,
    )

    with pytest.raises(ValueError, match="invalid init result"):
        await Stagehand.create(browser=browser)

    assert close_calls == 0
    assert invalidation_calls == 1
    assert transport.close_calls == 1


@pytest.mark.asyncio
async def test_cancelled_create_fails_closed_and_prevents_same_browser_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started = asyncio.Event()
    blocker = asyncio.Event()

    class BlockingInitRPCClient(RecordingRPCClient):
        @overload
        async def send(
            self,
            method: str,
            params: BaseModel,
            result_model: type[RootModel[RootResultT]],
        ) -> RootResultT: ...

        @overload
        async def send(
            self,
            method: str,
            params: BaseModel,
            result_model: type[ResultT],
        ) -> ResultT: ...

        async def send(
            self,
            method: str,
            params: BaseModel,
            result_model: type[BaseModel],
        ) -> object:
            if method == "stagehand.init":
                started.set()
                await blocker.wait()
            return await super().send(method, params, result_model)

    blocking = BlockingInitRPCClient()
    _install_rpc_client(monkeypatch, blocking)
    browser, transport = _browser_handle()
    create_task = asyncio.create_task(Stagehand.create(browser=browser))

    await asyncio.wait_for(started.wait(), timeout=1)
    create_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await create_task

    assert blocking.closed is True
    assert blocking.close_transport_flags == [False]
    assert browser.closed is True
    assert transport.close_calls == 1

    with pytest.raises(RuntimeError, match="Cannot attach Stagehand to a closed browser"):
        await Stagehand.create(browser=browser)


@pytest.mark.asyncio
async def test_create_deadline_fails_closed_without_a_flaky_five_millisecond_timer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert timeout_settings.STAGEHAND_INIT_TIMEOUT_MS == 60_000
    monkeypatch.setattr(timeout_settings, "STAGEHAND_INIT_TIMEOUT_MS", 50)
    started = asyncio.Event()

    class BlockingInitRPCClient(RecordingRPCClient):
        @overload
        async def send(
            self,
            method: str,
            params: BaseModel,
            result_model: type[RootModel[RootResultT]],
        ) -> RootResultT: ...

        @overload
        async def send(
            self,
            method: str,
            params: BaseModel,
            result_model: type[ResultT],
        ) -> ResultT: ...

        async def send(
            self,
            method: str,
            params: BaseModel,
            result_model: type[BaseModel],
        ) -> object:
            if method == "stagehand.init":
                started.set()
                await asyncio.Event().wait()
            return await super().send(method, params, result_model)

    blocking = BlockingInitRPCClient()
    _install_rpc_client(monkeypatch, blocking)
    browser, transport = _browser_handle()
    creating = asyncio.create_task(Stagehand.create(browser=browser))
    await asyncio.wait_for(started.wait(), timeout=1)

    with pytest.raises(TimeoutError, match="Stagehand initialization timed out after 50ms"):
        await creating

    assert blocking.closed is True
    assert blocking.close_transport_flags == [False]
    assert browser.closed is True
    assert transport.close_calls == 1
    with pytest.raises(RuntimeError, match="Cannot attach Stagehand to a closed browser"):
        await Stagehand.create(browser=browser)


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
    with pytest.raises(RuntimeError, match="Browser context is unavailable.*Stagehand.create"):
        _ = stagehand.browser.context
    with pytest.raises(RuntimeError, match="Stagehand is unavailable.*Stagehand.create"):
        await stagehand.metrics()

    next_recording = _recording()
    _install_rpc_client(monkeypatch, next_recording)
    next_stagehand = await Stagehand.create(browser=browser)
    assert next_stagehand.initialized is True
    assert next_stagehand.browser is browser

    await next_stagehand.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    getattr(asyncio, "eager_task_factory", None) is None,
    reason="asyncio.eager_task_factory requires Python 3.12+",
)
async def test_close_works_with_eager_task_factory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loop = asyncio.get_running_loop()
    original_task_factory = loop.get_task_factory()
    loop.set_task_factory(getattr(asyncio, "eager_task_factory"))
    try:
        recording = _recording()
        _install_rpc_client(monkeypatch, recording)
        browser, _ = _browser_handle()
        stagehand = await Stagehand.create(browser=browser)

        await stagehand.close()
        await stagehand.close()
    finally:
        loop.set_task_factory(original_task_factory)

    assert [call[0] for call in recording.calls].count("stagehand.close") == 1
    assert recording.close_transport_flags == [False]
    assert stagehand.initialized is False


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

    reattached_recording = _recording()
    _install_rpc_client(monkeypatch, reattached_recording)
    reattached = await Stagehand.create(browser=browser)
    await reattached.close()


@pytest.mark.asyncio
async def test_close_failure_retains_browser_claim(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording = _recording({"stagehand.close": RuntimeError("worker close failed")})
    _install_rpc_client(monkeypatch, recording)
    browser, _ = _browser_handle()
    stagehand = await Stagehand.create(browser=browser)

    with pytest.raises(RuntimeError, match="worker close failed"):
        await stagehand.close()
    with pytest.raises(RuntimeError, match="already attached"):
        await Stagehand.create(browser=browser)

    assert [call[0] for call in recording.calls].count("stagehand.init") == 1
    await browser.close()


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
        logging={"level": "info", "on_log": on_log},
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
    usage = StagehandResultUsage(input_tokens=11, output_tokens=7, reasoning_tokens=3)
    recording = _recording({
        "context.active_page": PageRef(page_id="active-page"),
        "stagehand.metrics": metrics,
        "stagehand.act": ActResult.model_validate({
            "data": act_data,
            "metadata": {"cache": {"status": "HIT"}, "usage": usage},
        }),
        "stagehand.observe": ObserveResult.model_validate({
            "data": [action],
            "metadata": {"cache": {"status": "MISS"}, "usage": usage},
        }),
        "stagehand.extract": {
            "data": {"heading": "Example Domain", "count": 1},
            "metadata": StagehandResultMetadata(
                cache=CacheMetadata(status=CacheStatus.hit), usage=usage
            ),
        },
    })
    _install_rpc_client(monkeypatch, recording)
    browser, _ = _browser_handle()
    stagehand = await Stagehand.create(browser=browser)
    page = Page(cast(RPCClient, recording), PageRef(page_id="explicit-page"))
    model: ModelConfig = {"model_name": "openai/gpt-4.1-mini"}
    act_locator = page.locator("main").nth(2)
    act_ignored_locator = page.locator(".promo")
    locator = page.locator("main").nth(1)
    ignored_locator = page.locator("nav")

    assert await stagehand.metrics() == metrics
    act_result = await stagehand.act(
        "Click the link",
        page=page,
        model=model,
        timeout=30_000,
        locator=act_locator,
        ignore_locators=[act_ignored_locator],
        cache={"threshold": 1},
    )
    observed = await stagehand.observe(
        "Find the link",
        page=page,
        model=model,
        locator=locator,
        ignore_locators=[ignored_locator],
    )
    extracted = await stagehand.extract(
        "Extract the heading",
        PageInfo,
        page=page,
        model=model,
        screenshot=True,
        locator=locator,
        ignore_locators=[ignored_locator],
    )

    assert act_result.data == act_data
    assert act_result.metadata.cache.status is CacheStatus.hit
    assert act_result.metadata.usage == usage
    assert observed.data == [action]
    assert observed.metadata.cache.status is CacheStatus.miss
    assert observed.metadata.usage == usage
    assert extracted.data == PageInfo(heading="Example Domain", count=1)
    assert extracted.metadata.cache.status is CacheStatus.hit
    assert extracted.metadata.usage == usage
    act_params = next(
        cast(StagehandActParams, params)
        for method, params, _ in recording.calls
        if method == "stagehand.act"
    )
    assert act_params.options is not None
    assert act_params.options.locator is not None
    assert act_params.options.locator.selector == "main"
    assert act_params.options.locator.nth == 2
    assert act_params.options.ignore_locators is not None
    assert [locator.selector for locator in act_params.options.ignore_locators] == [".promo"]
    assert act_params.options.cache is not None
    observe_params = next(
        cast(StagehandObserveParams, params)
        for method, params, _ in recording.calls
        if method == "stagehand.observe"
    )
    assert observe_params.page_id == "explicit-page"
    assert observe_params.options is not None
    assert observe_params.options.locator is not None
    assert observe_params.options.locator.selector == "main"
    assert observe_params.options.locator.nth == 1
    assert observe_params.options.ignore_locators is not None
    assert [locator.selector for locator in observe_params.options.ignore_locators] == ["nav"]
    extract_params = next(
        cast(StagehandExtractParams, params)
        for method, params, _ in recording.calls
        if method == "stagehand.extract"
    )
    assert extract_params.page_id == "explicit-page"
    assert extract_params.options is not None
    assert extract_params.options.locator is not None
    assert extract_params.options.locator.selector == "main"
    assert extract_params.options.locator.nth == 1
    assert extract_params.options.ignore_locators is not None
    assert [locator.selector for locator in extract_params.options.ignore_locators] == ["nav"]


@pytest.mark.asyncio
async def test_stagehand_observe_and_extract_serialize_active_page_locators(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    action = Action(selector="button.submit", description="Submit")
    usage = StagehandResultUsage(input_tokens=1, output_tokens=2, reasoning_tokens=0)
    recording = _recording({
        "context.active_page": PageRef(page_id="active-page"),
        "stagehand.observe": ObserveResult.model_validate({
            "data": [action],
            "metadata": {"cache": {"status": "DISABLED"}, "usage": usage},
        }),
        "stagehand.extract": {
            "data": {"heading": "Example Domain", "count": 1},
            "metadata": StagehandResultMetadata(
                cache=CacheMetadata(status=CacheStatus.disabled), usage=usage
            ),
        },
    })
    _install_rpc_client(monkeypatch, recording)
    browser, _ = _browser_handle()
    stagehand = await Stagehand.create(browser=browser)
    active_page = Page(cast(RPCClient, recording), PageRef(page_id="active-page"))

    await stagehand.observe(
        "Find the submit button",
        locator=active_page.locator("main").nth(2),
        ignore_locators=[active_page.locator("nav").nth(1)],
    )
    await stagehand.extract(
        "Extract the heading",
        PageInfo,
        locator=active_page.locator("section.content").nth(3),
        ignore_locators=[active_page.locator("aside.ads").nth(0)],
    )

    assert [method for method, _, _ in recording.calls].count("context.active_page") == 2

    observe_params = next(
        cast(StagehandObserveParams, params)
        for method, params, _ in recording.calls
        if method == "stagehand.observe"
    )
    assert observe_params.page_id == "active-page"
    assert observe_params.options is not None
    assert observe_params.options.locator is not None
    assert observe_params.options.locator.selector == "main"
    assert observe_params.options.locator.nth == 2
    assert observe_params.options.ignore_locators is not None
    assert [
        (locator.selector, locator.nth) for locator in observe_params.options.ignore_locators
    ] == [("nav", 1)]

    extract_params = next(
        cast(StagehandExtractParams, params)
        for method, params, _ in recording.calls
        if method == "stagehand.extract"
    )
    assert extract_params.page_id == "active-page"
    assert extract_params.options is not None
    assert extract_params.options.locator is not None
    assert extract_params.options.locator.selector == "section.content"
    assert extract_params.options.locator.nth == 3
    assert extract_params.options.ignore_locators is not None
    assert [
        (locator.selector, locator.nth) for locator in extract_params.options.ignore_locators
    ] == [("aside.ads", 0)]


@pytest.mark.asyncio
async def test_stagehand_act_observe_and_extract_reject_cross_page_locators(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording = _recording()
    _install_rpc_client(monkeypatch, recording)
    browser, _ = _browser_handle()
    stagehand = await Stagehand.create(browser=browser)
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))
    other_page = Page(cast(RPCClient, recording), PageRef(page_id="page-2"))

    with pytest.raises(TypeError, match=r"act\(\) locator must belong to the target page"):
        await stagehand.act("Click the link", page=page, locator=other_page.locator("a"))

    with pytest.raises(TypeError, match=r"observe\(\) locator must belong to the target page"):
        await stagehand.observe("Find the link", page=page, locator=other_page.locator("a"))

    with pytest.raises(TypeError, match=r"extract\(\) locator must belong to the target page"):
        await stagehand.extract(
            "Extract the page text",
            page=page,
            ignore_locators=[other_page.locator("nav")],
        )


@pytest.mark.asyncio
async def test_stagehand_extract_uses_default_schema(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording = _recording({
        "stagehand.extract": {
            "data": {"extraction": "Example Domain"},
            "metadata": StagehandResultMetadata(
                cache=CacheMetadata(status=CacheStatus.disabled),
                usage=StagehandResultUsage(
                    input_tokens=0,
                    output_tokens=0,
                    reasoning_tokens=0,
                ),
            ),
        },
    })
    _install_rpc_client(monkeypatch, recording)
    browser, _ = _browser_handle()
    stagehand = await Stagehand.create(browser=browser)
    page = Page(cast(RPCClient, recording), PageRef(page_id="explicit-page"))

    try:
        extracted = await stagehand.extract(instruction="Extract the page text", page=page)

        assert_type(extracted, ExtractResult[DefaultExtract])
        assert extracted.data.extraction == "Example Domain"
        extract_params = next(
            cast(StagehandExtractParams, params)
            for method, params, _ in recording.calls
            if method == "stagehand.extract"
        )
        assert extract_params.schema_ is not None
        schema = extract_params.schema_.model_dump()
        assert schema["type"] == "object"
        assert schema["properties"] == {"extraction": {"type": "string"}}
        assert schema["required"] == ["extraction"]
        assert schema["additionalProperties"] is False
    finally:
        try:
            await stagehand.close()
        finally:
            await browser.close()


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


@pytest.mark.parametrize(
    ("method", "positional"),
    [
        ("act", ["instruction"]),
        ("observe", ["instruction"]),
        ("extract", ["instruction", "schema"]),
    ],
)
def test_semantic_arguments_stay_positional(method: str, positional: list[str]) -> None:
    """TS and Go take these positionally; Python must match, with options keyword-only."""
    parameters = list(inspect.signature(getattr(Stagehand, method)).parameters.values())
    assert [
        parameter.name
        for parameter in parameters[1:]
        if parameter.kind is inspect.Parameter.POSITIONAL_OR_KEYWORD
    ] == positional
    assert all(
        parameter.kind is inspect.Parameter.KEYWORD_ONLY
        for parameter in parameters[1 + len(positional) :]
    )
