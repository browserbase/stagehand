from __future__ import annotations

import asyncio
import errno
import json
from pathlib import Path
from typing import Any, ClassVar, Literal, Self, cast

import pytest
from pydantic import ValidationError

from stagehand import browser
from stagehand import timeouts as timeout_settings
from stagehand._generated.models import (
    BrowserbaseRegion,
    BrowserbaseSessionCreateParams,
)
from stagehand.browser import (
    _DEFAULT_CHROME_FLAGS,
    StagehandBrowser,
    _attach_browser_context,
    _claim_browser,
    _connect_browser,
    _detach_browser_context,
    _invalidate_browser,
    _launch_local_browser,
    _local_browser_flags,
    _release_browser,
    _WorkerInitMetadata,
    browserbase,
    local_browser,
)
from stagehand.browser_context import BrowserContext
from stagehand.cdp_client import CDPConnectionClosedError
from stagehand.client_models import LocalBrowserLaunchOptions, LocalViewport

EXPECTED_DEFAULT_CHROME_FLAGS = tuple(
    json.loads(
        (
            Path(__file__).resolve().parents[3]
            / "tests"
            / "fixtures"
            / "local-browser-default-flags.json"
        ).read_text()
    )
)


class FakeCDPClient:
    connect_arguments: ClassVar[list[dict[str, object]]] = []
    instances: ClassVar[list[FakeCDPClient]] = []
    connect_error: ClassVar[BaseException | None] = None
    close_error: ClassVar[BaseException | None] = None

    def __init__(self) -> None:
        self.close_calls = 0
        self.commands: list[tuple[str, dict[str, object]]] = []
        self.web_socket_debugger_url = "ws://browser"

    @classmethod
    async def connect(cls, **kwargs: object) -> FakeCDPClient:
        cls.connect_arguments.append(kwargs)
        if cls.connect_error is not None:
            raise cls.connect_error
        instance = cls()
        cls.instances.append(instance)
        return instance

    async def close(self) -> None:
        self.close_calls += 1
        if self.close_error is not None:
            raise self.close_error

    async def send_command(
        self,
        method: str,
        params: dict[str, object] | None = None,
    ) -> dict[str, object]:
        self.commands.append((method, params or {}))
        return {}


class FakeSource:
    def __init__(
        self,
        *,
        keep_alive: bool,
        close_error: Exception | None = None,
    ) -> None:
        self.cdp_url = "http://browser"
        self.keep_alive = keep_alive
        self.close_calls = 0
        self.close_error = close_error

    async def close(self) -> None:
        self.close_calls += 1
        if self.close_error is not None:
            raise self.close_error


@pytest.fixture
def fake_cdp(monkeypatch: pytest.MonkeyPatch) -> type[FakeCDPClient]:
    FakeCDPClient.connect_arguments = []
    FakeCDPClient.instances = []
    FakeCDPClient.connect_error = None
    FakeCDPClient.close_error = None
    monkeypatch.setattr(browser, "CDPClient", FakeCDPClient)
    return FakeCDPClient


def _metadata() -> _WorkerInitMetadata:
    return _WorkerInitMetadata(api_key=None, browser=None)


async def _connected_handle(
    source: FakeSource,
    *,
    origin: Literal["launched", "connected"] = "launched",
) -> StagehandBrowser:
    return await _connect_browser(
        provider="local",
        origin=origin,
        source=source,
        extension_dir="/extension",
        worker_init_metadata=_metadata(),
    )


async def test_handle_close_is_memoized_and_marks_closed_when_requested(
    fake_cdp: type[FakeCDPClient],
) -> None:
    source = FakeSource(keep_alive=False)
    handle = await _connected_handle(source)
    cdp = fake_cdp.instances[-1]

    assert handle.closed is False
    pending = handle.close()
    assert handle.closed is True
    with pytest.raises(RuntimeError, match="Cannot attach Stagehand to a closed browser"):
        _claim_browser(handle)
    await asyncio.gather(pending, handle.close(), handle.close())

    assert handle.closed is True
    assert cdp.close_calls == 1
    assert source.close_calls == 1
    await handle.close()
    assert cdp.close_calls == 1


@pytest.mark.parametrize(
    ("provider", "origin", "keep_alive", "expected_source_closes", "expected_commands"),
    [
        ("local", "launched", False, 1, []),
        ("local", "launched", True, 1, []),
        ("local", "connected", True, 0, [("Browser.close", {})]),
        ("browserbase", "launched", False, 1, []),
        ("browserbase", "launched", True, 1, []),
        ("browserbase", "connected", True, 1, []),
    ],
)
async def test_explicit_browser_close_matrix(
    fake_cdp: type[FakeCDPClient],
    provider: Literal["local", "browserbase"],
    origin: Literal["launched", "connected"],
    keep_alive: bool,
    expected_source_closes: int,
    expected_commands: list[tuple[str, dict[str, object]]],
) -> None:
    source = FakeSource(keep_alive=keep_alive)
    handle = await _connect_browser(
        provider=provider,
        origin=origin,
        source=source,
        extension_dir="/extension",
        worker_init_metadata=_metadata(),
    )
    cdp = fake_cdp.instances[-1]

    await handle.close()

    assert source.close_calls == expected_source_closes
    assert cdp.commands == expected_commands
    assert cdp.close_calls == 1


async def test_connected_local_close_accepts_transport_loss_caused_by_command(
    fake_cdp: type[FakeCDPClient],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handle = await _connected_handle(FakeSource(keep_alive=True), origin="connected")
    cdp = fake_cdp.instances[-1]

    async def disconnect(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise CDPConnectionClosedError

    monkeypatch.setattr(cdp, "send_command", disconnect)

    await handle.close()
    assert cdp.close_calls == 1


async def test_connected_local_close_reports_dispatch_failure_and_still_disconnects(
    fake_cdp: type[FakeCDPClient],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handle = await _connected_handle(FakeSource(keep_alive=True), origin="connected")
    cdp = fake_cdp.instances[-1]

    async def fail(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise RuntimeError("dispatch failed")

    monkeypatch.setattr(cdp, "send_command", fail)

    with pytest.raises(RuntimeError, match="dispatch failed"):
        await handle.close()
    assert cdp.close_calls == 1


async def test_explicit_close_aggregates_termination_and_transport_failures(
    fake_cdp: type[FakeCDPClient],
) -> None:
    source = FakeSource(keep_alive=False, close_error=LookupError("termination failed"))
    handle = await _connected_handle(source)
    fake_cdp.close_error = OSError("transport cleanup failed")

    with pytest.raises(BaseExceptionGroup) as raised:
        await handle.close()

    assert [str(error) for error in raised.value.exceptions] == [
        "termination failed",
        "transport cleanup failed",
    ]


@pytest.mark.parametrize(
    ("provider", "origin", "keep_alive", "expected_source_closes"),
    [
        ("local", "launched", False, 1),
        ("local", "launched", True, 0),
        ("local", "connected", True, 0),
        ("browserbase", "launched", False, 1),
        ("browserbase", "launched", True, 0),
        ("browserbase", "connected", True, 0),
    ],
)
async def test_browser_invalidation_obeys_existing_source_ownership(
    fake_cdp: type[FakeCDPClient],
    provider: Literal["local", "browserbase"],
    origin: Literal["launched", "connected"],
    keep_alive: bool,
    expected_source_closes: int,
) -> None:
    source = FakeSource(keep_alive=keep_alive)
    handle = await _connect_browser(
        provider=provider,
        origin=origin,
        source=source,
        extension_dir="/extension",
        worker_init_metadata=_metadata(),
    )

    await _invalidate_browser(handle)

    assert handle.closed is True
    assert fake_cdp.instances[-1].close_calls == 1
    assert source.close_calls == expected_source_closes


async def test_claim_release_reclaim_and_errors(fake_cdp: type[FakeCDPClient]) -> None:
    handle = await _connected_handle(FakeSource(keep_alive=True))

    first = _claim_browser(handle)
    assert first.cdp_client is fake_cdp.instances[-1]
    with pytest.raises(
        RuntimeError,
        match="This browser is already attached to a Stagehand instance",
    ):
        _claim_browser(handle)

    _release_browser(handle)
    assert _claim_browser(handle) is first
    _release_browser(handle)
    await handle.close()
    with pytest.raises(RuntimeError, match="Cannot attach Stagehand to a closed browser"):
        _claim_browser(handle)
    with pytest.raises(TypeError, match="browser must be created by local_browser or browserbase"):
        _claim_browser(object())


async def test_context_requires_stagehand_attachment(fake_cdp: type[FakeCDPClient]) -> None:
    handle = await _connected_handle(FakeSource(keep_alive=True))
    context = cast(BrowserContext, object())
    try:
        with pytest.raises(RuntimeError, match="Browser context is unavailable"):
            _ = handle.context
        with pytest.raises(RuntimeError, match="before Stagehand claims"):
            _attach_browser_context(handle, context)

        _claim_browser(handle)
        _attach_browser_context(handle, context)
        assert handle.context is context

        with pytest.raises(RuntimeError, match="already has a Stagehand context"):
            _attach_browser_context(handle, cast(BrowserContext, object()))

        _detach_browser_context(handle)
        with pytest.raises(RuntimeError, match="Browser context is unavailable"):
            _ = handle.context
    finally:
        _detach_browser_context(handle)
        _release_browser(handle)
        await handle.close()


def test_handle_construction_is_nominal() -> None:
    async def close() -> None:
        return None

    with pytest.raises(TypeError, match="only be created by browser factories"):
        StagehandBrowser(
            "local",
            "launched",
            object(),  # ty: ignore[invalid-argument-type]
            close,
        )


@pytest.mark.parametrize(
    ("origin", "keep_alive", "expected_source_closes"),
    [("launched", False, 1), ("launched", True, 0), ("connected", False, 0)],
)
async def test_connect_failure_obeys_source_ownership(
    fake_cdp: type[FakeCDPClient],
    origin: Literal["launched", "connected"],
    keep_alive: bool,
    expected_source_closes: int,
) -> None:
    fake_cdp.connect_error = RuntimeError("connect failed")
    source = FakeSource(keep_alive=keep_alive)

    with pytest.raises(RuntimeError, match="connect failed"):
        await _connected_handle(source, origin=origin)
    assert source.close_calls == expected_source_closes


async def test_after_connect_failure_closes_cdp_and_owned_source(
    fake_cdp: type[FakeCDPClient],
) -> None:
    source = FakeSource(keep_alive=False)

    async def fail_after_connect(_client: browser.CDPClient) -> None:
        raise RuntimeError("configuration failed")

    with pytest.raises(RuntimeError, match="configuration failed"):
        await _connect_browser(
            provider="local",
            origin="launched",
            source=source,
            extension_dir="/extension",
            after_connect=fail_after_connect,
            worker_init_metadata=_metadata(),
        )

    assert fake_cdp.instances[-1].close_calls == 1
    assert source.close_calls == 1


async def test_connect_and_cleanup_failure_raise_exception_group(
    fake_cdp: type[FakeCDPClient],
) -> None:
    fake_cdp.connect_error = RuntimeError("connect failed")
    source = FakeSource(keep_alive=False, close_error=LookupError("cleanup failed"))

    with pytest.raises(ExceptionGroup) as raised:
        await _connected_handle(source)

    assert str(raised.value).startswith("Browser connection failed and browser cleanup also failed")
    assert [str(error) for error in raised.value.exceptions] == [
        "connect failed",
        "cleanup failed",
    ]


async def test_cdp_cleanup_failure_does_not_skip_owned_source_cleanup(
    fake_cdp: type[FakeCDPClient],
) -> None:
    fake_cdp.close_error = OSError("cdp cleanup failed")
    source = FakeSource(keep_alive=False)

    async def fail_after_connect(_client: browser.CDPClient) -> None:
        raise RuntimeError("configuration failed")

    with pytest.raises(BaseExceptionGroup) as raised:
        await _connect_browser(
            provider="local",
            origin="launched",
            source=source,
            extension_dir="/extension",
            after_connect=fail_after_connect,
            worker_init_metadata=_metadata(),
        )

    assert str(raised.value).startswith("Browser connection failed and browser cleanup also failed")
    assert [str(error) for error in raised.value.exceptions] == [
        "configuration failed",
        "cdp cleanup failed",
    ]
    assert source.close_calls == 1


async def test_connect_cancellation_closes_owned_source(
    fake_cdp: type[FakeCDPClient],
) -> None:
    fake_cdp.connect_error = asyncio.CancelledError()
    source = FakeSource(keep_alive=False)

    with pytest.raises(asyncio.CancelledError):
        await _connected_handle(source)

    assert source.close_calls == 1


async def test_connect_cancellation_propagates_when_owned_source_cleanup_fails(
    fake_cdp: type[FakeCDPClient],
) -> None:
    fake_cdp.connect_error = asyncio.CancelledError()
    source = FakeSource(keep_alive=False, close_error=OSError("cleanup failed"))

    with pytest.raises(asyncio.CancelledError) as raised:
        await _connected_handle(source)

    assert not isinstance(raised.value, BaseExceptionGroup)
    assert source.close_calls == 1


async def test_cdp_cleanup_cancellation_does_not_skip_owned_source_cleanup(
    fake_cdp: type[FakeCDPClient],
) -> None:
    fake_cdp.close_error = asyncio.CancelledError()
    source = FakeSource(keep_alive=False)

    async def fail_after_connect(_client: browser.CDPClient) -> None:
        raise RuntimeError("configuration failed")

    with pytest.raises(asyncio.CancelledError):
        await _connect_browser(
            provider="local",
            origin="launched",
            source=source,
            extension_dir="/extension",
            after_connect=fail_after_connect,
            worker_init_metadata=_metadata(),
        )

    assert fake_cdp.instances[-1].close_calls == 1
    assert source.close_calls == 1


async def test_handle_close_closes_owned_source_when_cdp_close_fails(
    fake_cdp: type[FakeCDPClient],
) -> None:
    source = FakeSource(keep_alive=False)
    handle = await _connected_handle(source)
    fake_cdp.close_error = OSError("cdp close failed")

    with pytest.raises(OSError, match="cdp close failed"):
        await handle.close()

    assert source.close_calls == 1


async def test_launch_configures_downloads_on_the_root_session(
    monkeypatch: pytest.MonkeyPatch,
    fake_cdp: type[FakeCDPClient],
) -> None:
    source = FakeSource(keep_alive=False)
    captured: list[LocalBrowserLaunchOptions] = []

    async def launch(options: LocalBrowserLaunchOptions) -> FakeSource:
        captured.append(options)
        return source

    monkeypatch.setattr(browser, "_launch_local_browser", launch)
    handle = await local_browser.launch(
        downloads_path=Path("/tmp/downloads"),
        accept_downloads=True,
    )

    assert captured[-1].downloads_path == "/tmp/downloads"
    assert fake_cdp.instances[-1].commands == [
        (
            "Browser.setDownloadBehavior",
            {"behavior": "allow", "downloadPath": "/tmp/downloads"},
        )
    ]
    await handle.close()


async def test_launch_download_options_are_optional_and_deny_is_supported(
    monkeypatch: pytest.MonkeyPatch,
    fake_cdp: type[FakeCDPClient],
) -> None:
    async def launch(options: LocalBrowserLaunchOptions) -> FakeSource:
        return FakeSource(keep_alive=options.keep_alive or False)

    monkeypatch.setattr(browser, "_launch_local_browser", launch)
    without_options = await local_browser.launch()
    assert fake_cdp.instances[-1].commands == []
    await without_options.close()

    deny = await local_browser.launch(accept_downloads=False)
    assert fake_cdp.instances[-1].commands == [
        ("Browser.setDownloadBehavior", {"behavior": "deny"})
    ]
    await deny.close()


async def test_launch_validates_downloads_viewport_and_proxy_before_launch() -> None:
    with pytest.raises(
        ValueError,
        match="downloads_path is required when accept_downloads is true",
    ):
        await local_browser.launch(accept_downloads=True)
    with pytest.raises(TypeError, match="viewport_width and viewport_height"):
        await local_browser.launch(viewport_width=800)
    with pytest.raises(NotImplementedError, match="Authenticated local browser proxies"):
        await local_browser.launch(proxy_server="http://proxy", proxy_username="user")


async def test_launch_strictly_validates_nested_viewport_and_proxy_values() -> None:
    with pytest.raises(ValidationError):
        await local_browser.launch(viewport_width=True, viewport_height=False)
    with pytest.raises(ValidationError):
        await local_browser.launch(
            proxy_server=b"http://proxy",  # ty: ignore[invalid-argument-type]
        )


async def test_launch_rejects_scalar_strings_for_argument_lists() -> None:
    with pytest.raises(ValidationError):
        await local_browser.launch(args="--headless")
    with pytest.raises(ValidationError):
        await local_browser.launch(ignore_default_args="--headless")


async def test_launch_converts_argument_tuples_to_flag_lists(
    monkeypatch: pytest.MonkeyPatch,
    fake_cdp: type[FakeCDPClient],
    tmp_path: Path,
) -> None:
    captured_flags: list[str] = []

    async def launch(options: LocalBrowserLaunchOptions) -> FakeSource:
        captured_flags.extend(
            _local_browser_flags(
                options,
                port=9222,
                user_data_dir=tmp_path,
                disable_sandbox=False,
            )
        )
        return FakeSource(keep_alive=False)

    monkeypatch.setattr(browser, "_launch_local_browser", launch)
    handle = await local_browser.launch(
        args=("--custom-one", "--custom-two"),
        ignore_default_args=(_DEFAULT_CHROME_FLAGS[0],),
    )

    assert _DEFAULT_CHROME_FLAGS[0] not in captured_flags
    assert captured_flags[-3:] == ["--custom-one", "--custom-two", "about:blank"]
    await handle.close()


async def test_connect_uses_extension_id_or_packaged_extension_and_never_owns_source(
    fake_cdp: type[FakeCDPClient],
) -> None:
    with_id = await local_browser.connect(cdp_url="http://browser", extension_id="existing")
    assert fake_cdp.connect_arguments[-1]["extension_id"] == "existing"
    assert fake_cdp.connect_arguments[-1]["extension_dir"] is None
    await with_id.close()

    packaged = await local_browser.connect(cdp_url="http://browser")
    arguments = fake_cdp.connect_arguments[-1]
    assert arguments["extension_id"] is None
    assert str(arguments["extension_dir"]).endswith(("stagehand/_extension", "extension/dist"))
    assert arguments["service_worker_url_includes"] == "service-worker.js"
    assert set(arguments) == {
        "cdp_url",
        "extension_dir",
        "extension_id",
        "preloaded_extension",
        "service_worker_url_includes",
    }
    await packaged.close()


async def test_browser_factory_bounds_the_complete_connection_lifecycle(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert timeout_settings.STAGEHAND_INIT_TIMEOUT_MS == 60_000
    monkeypatch.setattr(timeout_settings, "STAGEHAND_INIT_TIMEOUT_MS", 50)
    started = asyncio.Event()

    class BlockingCDPClient:
        @classmethod
        async def connect(cls, **_: object) -> BlockingCDPClient:
            started.set()
            await asyncio.Event().wait()
            raise AssertionError("unreachable")

    monkeypatch.setattr(browser, "CDPClient", BlockingCDPClient)
    connecting = asyncio.ensure_future(local_browser.connect(cdp_url="http://browser"))
    await asyncio.wait_for(started.wait(), timeout=1)

    with pytest.raises(TimeoutError, match="Stagehand initialization timed out after 50ms"):
        await connecting


def test_local_browser_flags_are_unchanged_for_launch_options(tmp_path: Path) -> None:
    options = LocalBrowserLaunchOptions(
        headless=True,
        devtools=True,
        args=["--custom-flag"],
    )
    flags = _local_browser_flags(
        options,
        port=9222,
        user_data_dir=tmp_path,
        disable_sandbox=True,
    )

    assert flags[-5:] == [
        "--headless",
        "--auto-open-devtools-for-tabs",
        "--no-sandbox",
        "--custom-flag",
        "about:blank",
    ]


def test_local_browser_default_flags_match_shared_fixture(tmp_path: Path) -> None:
    assert _DEFAULT_CHROME_FLAGS == EXPECTED_DEFAULT_CHROME_FLAGS
    assert "--disable-extensions" not in _DEFAULT_CHROME_FLAGS
    assert _local_browser_flags(
        LocalBrowserLaunchOptions(),
        port=9222,
        user_data_dir=tmp_path,
        disable_sandbox=False,
    ) == [
        *EXPECTED_DEFAULT_CHROME_FLAGS,
        "--window-size=1280,800",
        "--remote-debugging-port=9222",
        f"--user-data-dir={tmp_path}",
        "about:blank",
    ]


class FakeBrowserbaseSession:
    def __init__(
        self,
        *,
        session_id: str = "session-id",
        cdp_url: str = "wss://browserbase",
        region: BrowserbaseRegion | None = None,
    ) -> None:
        self.session_id = session_id
        self.cdp_url = cdp_url
        self.region = region
        self.close_calls = 0

    async def close(self) -> None:
        self.close_calls += 1


class FakeBrowserbaseClient:
    def __init__(self) -> None:
        self.created = FakeBrowserbaseSession()
        self.connected = FakeBrowserbaseSession(region=BrowserbaseRegion.eu_central_1)
        self.create_calls: list[BrowserbaseSessionCreateParams] = []
        self.connect_calls: list[str] = []

    async def create_session(
        self,
        options: BrowserbaseSessionCreateParams,
    ) -> FakeBrowserbaseSession:
        self.create_calls.append(options)
        return self.created

    async def connect_session(self, session_id: str) -> FakeBrowserbaseSession:
        self.connect_calls.append(session_id)
        return self.connected


def _install_browserbase_client(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[FakeBrowserbaseClient, list[tuple[str, str]]]:
    client = FakeBrowserbaseClient()
    configurations: list[tuple[str, str]] = []

    def factory(api_key: str, base_url: str) -> FakeBrowserbaseClient:
        configurations.append((api_key, base_url))
        return client

    monkeypatch.setattr(browser, "_create_browserbase_session_client", factory)
    return client, configurations


async def test_browserbase_launch_uses_preloaded_extension_and_owns_session(
    monkeypatch: pytest.MonkeyPatch,
    fake_cdp: type[FakeCDPClient],
) -> None:
    client, configurations = _install_browserbase_client(monkeypatch)
    handle = await browserbase.launch(
        api_key="api-key",
        base_url="https://api.dev.browserbase.com",
        region=BrowserbaseRegion.us_east_1,
    )

    arguments = fake_cdp.connect_arguments[-1]
    assert arguments["preloaded_extension"] is True
    assert arguments["extension_dir"] is None
    assert arguments["extension_id"] is None
    claimed = _claim_browser(handle)
    assert claimed.worker_init_metadata.api_key == "api-key"
    assert claimed.worker_init_metadata.browser is not None
    assert claimed.worker_init_metadata.browser.model_dump(exclude_none=True) == {
        "session_id": "session-id",
        "region": BrowserbaseRegion.us_east_1,
    }
    _release_browser(handle)
    await handle.close()

    assert configurations == [("api-key", "https://api.dev.browserbase.com")]
    assert client.created.close_calls == 1
    assert fake_cdp.instances[-1].close_calls == 1


async def test_browserbase_launch_keep_alive_still_closes_session_explicitly(
    monkeypatch: pytest.MonkeyPatch,
    fake_cdp: type[FakeCDPClient],
) -> None:
    client, configurations = _install_browserbase_client(monkeypatch)
    handle = await browserbase.launch(api_key="api-key", keep_alive=True)
    await handle.close()
    assert configurations == [("api-key", "https://api.browserbase.com")]
    assert client.created.close_calls == 1
    assert fake_cdp.instances[-1].close_calls == 1


async def test_browserbase_connect_releases_session_and_selects_extension_mode(
    monkeypatch: pytest.MonkeyPatch,
    fake_cdp: type[FakeCDPClient],
) -> None:
    client, configurations = _install_browserbase_client(monkeypatch)
    preloaded = await browserbase.connect(
        api_key="api-key",
        base_url="https://api.dev.browserbase.com",
        session_id="session",
    )
    assert fake_cdp.connect_arguments[-1]["preloaded_extension"] is True
    claimed = _claim_browser(preloaded)
    assert claimed.worker_init_metadata.browser is not None
    assert claimed.worker_init_metadata.browser.region == BrowserbaseRegion.eu_central_1
    _release_browser(preloaded)
    await preloaded.close()

    caller_extension = await browserbase.connect(
        api_key="api-key",
        session_id="session",
        extension_id="caller-extension",
    )
    arguments = fake_cdp.connect_arguments[-1]
    assert arguments["preloaded_extension"] is False
    assert arguments["extension_id"] == "caller-extension"
    await caller_extension.close()

    assert client.connect_calls == ["session", "session"]
    assert configurations == [
        ("api-key", "https://api.dev.browserbase.com"),
        ("api-key", "https://api.browserbase.com"),
    ]
    assert client.connected.close_calls == 2


async def test_browserbase_launch_connect_failure_closes_owned_session(
    monkeypatch: pytest.MonkeyPatch,
    fake_cdp: type[FakeCDPClient],
) -> None:
    client, _ = _install_browserbase_client(monkeypatch)
    fake_cdp.connect_error = RuntimeError("connect failed")
    with pytest.raises(RuntimeError, match="connect failed"):
        await browserbase.launch(api_key="api-key")
    assert client.created.close_calls == 1


async def test_browserbase_validation_precedes_api_calls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, api_keys = _install_browserbase_client(monkeypatch)
    with pytest.raises(ValueError, match="api_key"):
        await browserbase.launch(api_key="")
    with pytest.raises(ValueError, match="^base_url must not be empty$"):
        await browserbase.launch(api_key="api-key", base_url="  ")
    with pytest.raises(ValueError, match="^extension_id must not be empty$"):
        await browserbase.launch(api_key="api-key", extension_id="  ")
    with pytest.raises(
        ValueError,
        match="^browser_settings.extension_id must not be empty$",
    ):
        await browserbase.launch(
            api_key="api-key",
            browser_settings={"extension_id": "  "},
        )
    with pytest.raises(ValidationError):
        await browserbase.connect(api_key="", session_id="session")
    with pytest.raises(ValidationError):
        await browserbase.connect(api_key="api-key", session_id="")
    assert api_keys == []


async def test_browserbase_search_and_fetch_delegate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    search_calls: list[object] = []
    fetch_calls: list[object] = []

    async def search(options: object) -> object:
        search_calls.append(options)
        return cast(object, "search-result")

    async def fetch(options: object) -> object:
        fetch_calls.append(options)
        return cast(object, "fetch-result")

    monkeypatch.setattr(browser, "search_browserbase", search)
    monkeypatch.setattr(browser, "fetch_browserbase", fetch)

    assert await browserbase.search(
        api_key="bb_key",
        query="browser agents",
        num_results=5,
    ) == cast(object, "search-result")
    assert await browserbase.fetch(
        api_key="bb_key",
        url="https://stagehand.dev",
        format="markdown",
    ) == cast(object, "fetch-result")
    assert len(search_calls) == 1
    assert len(fetch_calls) == 1
    search_options = cast(browser._BrowserbaseSearchOptions, search_calls[0])
    assert search_options.api_key == "bb_key"
    assert search_options.query == "browser agents"
    assert search_options.num_results == 5
    fetch_options = cast(browser._BrowserbaseFetchOptions, fetch_calls[0])
    assert fetch_options.api_key == "bb_key"
    assert str(fetch_options.url) == "https://stagehand.dev"
    assert fetch_options.format == "markdown"


async def test_local_browser_close_ignores_vanished_process_and_removes_profile(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    profile = tmp_path / "profile"
    profile.mkdir()

    class FakeProcess:
        returncode = None
        pid = 123

        async def wait(self) -> int:
            return 0

    async def create_subprocess_exec(*_args: object, **_kwargs: object) -> FakeProcess:
        return FakeProcess()

    taskkill_calls: list[tuple[int, bool]] = []

    async def taskkill(pid: int, *, force: bool) -> None:
        taskkill_calls.append((pid, force))
        raise browser._TaskkillError(128)

    monkeypatch.setattr(browser, "_find_chrome_path", lambda _explicit: "/path/to/chrome")
    monkeypatch.setattr(browser, "_available_port", lambda: 9222)
    monkeypatch.setattr(browser.tempfile, "mkdtemp", lambda **_kwargs: str(profile))
    monkeypatch.setattr(browser.asyncio, "create_subprocess_exec", create_subprocess_exec)
    monkeypatch.setattr(browser, "_wait_for_chrome", _ready_chrome)
    monkeypatch.setattr(browser, "_run_taskkill", taskkill)
    monkeypatch.setattr(browser.sys, "platform", "win32")

    source = await _launch_local_browser(LocalBrowserLaunchOptions())
    await source.close()

    assert taskkill_calls == [(123, False)]
    assert not profile.exists()


async def test_empty_user_data_dir_uses_and_removes_temporary_profile(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    profile = tmp_path / "profile"
    profile.mkdir()
    spawned_args: tuple[object, ...] = ()

    class FakeProcess:
        returncode = 0
        pid = 123

    async def create_subprocess_exec(*args: object, **_kwargs: object) -> FakeProcess:
        nonlocal spawned_args
        spawned_args = args
        return FakeProcess()

    monkeypatch.setattr(browser, "_find_chrome_path", lambda _explicit: "/path/to/chrome")
    monkeypatch.setattr(browser, "_available_port", lambda: 9222)
    monkeypatch.setattr(browser.tempfile, "mkdtemp", lambda **_kwargs: str(profile))
    monkeypatch.setattr(browser.asyncio, "create_subprocess_exec", create_subprocess_exec)
    monkeypatch.setattr(browser, "_wait_for_chrome", _ready_chrome)

    source = await _launch_local_browser(LocalBrowserLaunchOptions(user_data_dir=""))

    assert f"--user-data-dir={profile}" in spawned_args
    await source.close()
    assert not profile.exists()


@pytest.mark.parametrize(
    "uses_temporary_profile",
    [False, True],
)
async def test_local_browser_close_preserves_non_owned_profiles(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    uses_temporary_profile: bool,
) -> None:
    profile = tmp_path / "profile"
    profile.mkdir()

    class FakeProcess:
        returncode = 0
        pid = 123

    async def create_subprocess_exec(*_args: object, **_kwargs: object) -> FakeProcess:
        return FakeProcess()

    monkeypatch.setattr(browser, "_find_chrome_path", lambda _explicit: "/path/to/chrome")
    monkeypatch.setattr(browser, "_available_port", lambda: 9222)
    monkeypatch.setattr(browser.asyncio, "create_subprocess_exec", create_subprocess_exec)
    monkeypatch.setattr(browser, "_wait_for_chrome", _ready_chrome)
    if uses_temporary_profile:
        monkeypatch.setattr(browser.tempfile, "mkdtemp", lambda **_kwargs: str(profile))
        options = LocalBrowserLaunchOptions(preserve_user_data_dir=True)
    else:
        options = LocalBrowserLaunchOptions(user_data_dir=str(profile))

    source = await _launch_local_browser(options)
    await source.close()

    assert profile.exists()


async def _ready_chrome(_cdp_url: str, _process: object) -> None:
    return None


async def test_local_browser_validation_precedes_executable_discovery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def find_chrome(_explicit: str | None) -> str:
        raise AssertionError("executable discovery should not run")

    monkeypatch.setattr(browser, "_find_chrome_path", find_chrome)

    with pytest.raises(ValueError, match="viewport dimensions"):
        await _launch_local_browser(
            LocalBrowserLaunchOptions(viewport=LocalViewport(width=0, height=800))
        )


async def test_invalid_explicit_executable_precedes_profile_creation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def create_profile(**_kwargs: object) -> str:
        raise AssertionError("profile creation should not run")

    monkeypatch.setattr(browser.tempfile, "mkdtemp", create_profile)

    with pytest.raises(RuntimeError, match="Chrome executable.*does not exist"):
        await _launch_local_browser(LocalBrowserLaunchOptions(executable_path="/missing/chrome"))


async def test_occupied_explicit_port_precedes_profile_creation_and_spawn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile_created = False
    spawned = False

    def inspect_port(_port: int) -> int:
        raise OSError(errno.EADDRINUSE, "address already in use")

    def create_profile(**_kwargs: object) -> str:
        nonlocal profile_created
        profile_created = True
        return "/unused"

    async def create_subprocess_exec(*_args: object, **_kwargs: object) -> object:
        nonlocal spawned
        spawned = True
        raise AssertionError("Chrome should not spawn")

    monkeypatch.setattr(browser, "_find_chrome_path", lambda _explicit: "/path/to/chrome")
    monkeypatch.setattr(browser, "_inspect_chrome_port", inspect_port)
    monkeypatch.setattr(browser.tempfile, "mkdtemp", create_profile)
    monkeypatch.setattr(browser.asyncio, "create_subprocess_exec", create_subprocess_exec)

    with pytest.raises(RuntimeError, match="Chrome debugging port 9222 is already in use"):
        await _launch_local_browser(LocalBrowserLaunchOptions(port=9222))

    assert not profile_created
    assert not spawned


@pytest.mark.parametrize("port", [0, -1, 65_536])
def test_resolve_chrome_port_rejects_invalid_explicit_ports(
    monkeypatch: pytest.MonkeyPatch,
    port: int,
) -> None:
    def inspect_port(_port: int) -> int:
        raise AssertionError("invalid ports should not be inspected")

    monkeypatch.setattr(browser, "_inspect_chrome_port", inspect_port)

    with pytest.raises(ValueError, match="between 1 and 65535"):
        browser._resolve_chrome_port(port)


def test_resolve_chrome_port_preserves_non_occupancy_socket_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    socket_error = OSError(errno.EACCES, "permission denied")

    def inspect_port(_port: int) -> int:
        raise socket_error

    monkeypatch.setattr(browser, "_inspect_chrome_port", inspect_port)

    with pytest.raises(OSError) as raised:
        browser._resolve_chrome_port(9222)
    assert raised.value is socket_error


def test_available_port_releases_automatic_reservation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeSocket:
        closed = False

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            self.closed = True

        def bind(self, address: tuple[str, int]) -> None:
            assert address == ("127.0.0.1", 0)

        def getsockname(self) -> tuple[str, int]:
            return ("127.0.0.1", 4567)

    reservation = FakeSocket()
    monkeypatch.setattr(browser.socket, "socket", lambda *_args: reservation)

    port = browser._available_port()

    assert port == 4567
    assert reservation.closed


async def test_spawn_failure_removes_sdk_owned_profile(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    profile = tmp_path / "profile"
    profile.mkdir()

    async def create_subprocess_exec(*_args: object, **_kwargs: object) -> object:
        raise OSError("spawn failed")

    monkeypatch.setattr(browser, "_find_chrome_path", lambda _explicit: "/path/to/chrome")
    monkeypatch.setattr(browser, "_available_port", lambda: 9222)
    monkeypatch.setattr(browser.tempfile, "mkdtemp", lambda **_kwargs: str(profile))
    monkeypatch.setattr(browser.asyncio, "create_subprocess_exec", create_subprocess_exec)

    with pytest.raises(RuntimeError, match="Failed to start Chrome: spawn failed"):
        await _launch_local_browser(LocalBrowserLaunchOptions())

    assert not profile.exists()


def test_find_chrome_path_uses_explicit_then_environment() -> None:
    def executable(path: str, _platform: str) -> bool:
        return path in {"/explicit", "/configured"}

    assert (
        browser._find_chrome_path(
            "/explicit",
            platform="linux",
            environment={"CHROME_PATH": "/configured"},
            is_executable=executable,
        )
        == "/explicit"
    )
    assert (
        browser._find_chrome_path(
            platform="linux",
            environment={"CHROME_PATH": "/configured"},
            is_executable=executable,
        )
        == "/configured"
    )


@pytest.mark.parametrize(
    ("platform", "environment", "expected"),
    [
        (
            "darwin",
            {},
            [
                "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
                "/Applications/Chromium.app/Contents/MacOS/Chromium",
            ],
        ),
        (
            "win32",
            {"LOCALAPPDATA": r"C:\Users\me\AppData", "PROGRAMFILES": r"C:\Program Files"},
            [
                r"C:\Users\me\AppData\Google\Chrome SxS\Application\chrome.exe",
                r"C:\Users\me\AppData\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files\Google\Chrome SxS\Application\chrome.exe",
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            ],
        ),
    ],
)
def test_find_chrome_path_checks_platform_candidates_in_order(
    platform: str,
    environment: dict[str, str],
    expected: list[str],
) -> None:
    checked: list[str] = []

    def executable(path: str, _platform: str) -> bool:
        checked.append(path)
        return path == expected[-1]

    assert (
        browser._find_chrome_path(
            platform=platform,
            environment=environment,
            is_executable=executable,
        )
        == expected[-1]
    )
    assert checked == expected


def test_find_chrome_path_checks_linux_candidates_in_order() -> None:
    names: list[str] = []

    def which(name: str) -> str:
        names.append(name)
        return f"/bin/{name}"

    assert (
        browser._find_chrome_path(
            platform="linux",
            environment={},
            which=which,
            is_executable=lambda path, _platform: path == "/bin/chromium",
        )
        == "/bin/chromium"
    )
    assert names == [
        "google-chrome-stable",
        "google-chrome",
        "chromium-browser",
        "chromium",
    ]


def test_find_chrome_path_rejects_unsupported_platform() -> None:
    with pytest.raises(RuntimeError, match="not supported on freebsd"):
        browser._find_chrome_path(
            platform="freebsd",
            environment={},
            is_executable=lambda _path, _platform: False,
        )


async def test_launch_creates_caller_profile_before_spawn(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    profile = tmp_path / "nested" / "profile"
    spawned = False

    class FakeProcess:
        returncode = 0
        pid = 123

    async def create_subprocess_exec(*_args: object, **_kwargs: object) -> FakeProcess:
        nonlocal spawned
        spawned = True
        assert profile.is_dir()
        return FakeProcess()

    monkeypatch.setattr(browser, "_find_chrome_path", lambda _explicit: "/path/to/chrome")
    monkeypatch.setattr(browser, "_available_port", lambda: 9222)
    monkeypatch.setattr(browser.asyncio, "create_subprocess_exec", create_subprocess_exec)
    monkeypatch.setattr(browser, "_wait_for_chrome", _ready_chrome)

    source = await _launch_local_browser(LocalBrowserLaunchOptions(user_data_dir=str(profile)))
    await source.close()

    assert spawned
    assert profile.is_dir()


async def test_wait_for_chrome_requires_debugger_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    never_exits = asyncio.Event()
    responses = iter((False, True))

    class FakeProcess:
        returncode = None

        async def wait(self) -> int:
            await never_exits.wait()
            return 0

    async def debugging_ready(_cdp_url: str) -> bool:
        return next(responses)

    async def no_delay(_seconds: float) -> None:
        return None

    monkeypatch.setattr(browser, "_chrome_debugging_ready", debugging_ready)
    monkeypatch.setattr(browser.asyncio, "sleep", no_delay)

    await browser._wait_for_chrome("http://127.0.0.1:9222", FakeProcess())


async def test_wait_for_chrome_reports_early_exit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeProcess:
        returncode = None

        async def wait(self) -> int:
            return 17

    async def never_ready(_cdp_url: str) -> bool:
        await asyncio.Event().wait()
        return False

    monkeypatch.setattr(browser, "_chrome_debugging_ready", never_ready)

    with pytest.raises(RuntimeError, match="ready with code 17"):
        await browser._wait_for_chrome("http://127.0.0.1:9222", FakeProcess())


@pytest.mark.parametrize(
    ("version", "ready"),
    [
        ({}, False),
        ({"webSocketDebuggerUrl": "  "}, False),
        ({"webSocketDebuggerUrl": "ws://127.0.0.1/devtools/browser/id"}, True),
    ],
)
async def test_chrome_debugging_ready_requires_nonempty_websocket_url(
    monkeypatch: pytest.MonkeyPatch,
    version: dict[str, object],
    ready: bool,
) -> None:
    monkeypatch.setattr(browser, "_read_chrome_version", lambda _url: version)
    assert await browser._chrome_debugging_ready("http://127.0.0.1:9222") is ready


async def test_launch_cancellation_closes_process_and_removes_profile(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    profile = tmp_path / "profile"
    closed: list[Path] = []

    class FakeProcess:
        returncode = None
        pid = 123

    async def create_subprocess_exec(*_args: object, **_kwargs: object) -> FakeProcess:
        return FakeProcess()

    async def cancel_wait(_cdp_url: str, _process: object) -> None:
        raise asyncio.CancelledError

    async def close_process(_process: object, chrome_profile: object) -> None:
        closed.append(cast(browser._ChromeProfile, chrome_profile).path)
        profile.rmdir()

    monkeypatch.setattr(browser, "_find_chrome_path", lambda _explicit: "/path/to/chrome")
    monkeypatch.setattr(browser, "_available_port", lambda: 9222)
    monkeypatch.setattr(browser.tempfile, "mkdtemp", lambda **_kwargs: str(profile))
    monkeypatch.setattr(browser.asyncio, "create_subprocess_exec", create_subprocess_exec)
    monkeypatch.setattr(browser, "_wait_for_chrome", cancel_wait)
    monkeypatch.setattr(browser, "_close_local_chrome", close_process)
    profile.mkdir()

    with pytest.raises(asyncio.CancelledError):
        await _launch_local_browser(LocalBrowserLaunchOptions())

    assert closed == [profile]
    assert not profile.exists()


async def test_resolved_browser_source_concurrent_close_waits_for_shared_task() -> None:
    started = asyncio.Event()
    release = asyncio.Event()
    close_calls = 0

    async def close_callback() -> None:
        nonlocal close_calls
        close_calls += 1
        started.set()
        await release.wait()

    source = browser.ResolvedBrowserSource(
        cdp_url="http://127.0.0.1:9222",
        keep_alive=False,
        _close_callback=close_callback,
    )
    first = asyncio.create_task(source.close())
    await started.wait()
    second = asyncio.create_task(source.close())
    await asyncio.sleep(0)

    assert close_calls == 1
    assert not first.done()
    assert not second.done()

    release.set()
    await asyncio.gather(first, second)
    await source.close()
    assert close_calls == 1


@pytest.mark.parametrize(
    ("platform", "environment", "uid", "sandbox_option", "expected"),
    [
        ("linux", {}, 0, None, True),
        ("linux", {}, 1000, None, False),
        ("darwin", {}, 0, None, False),
        ("darwin", {"CI": "1"}, 1000, None, True),
        ("win32", {}, 1000, False, True),
    ],
)
def test_should_disable_chromium_sandbox(
    platform: str,
    environment: dict[str, str],
    uid: int,
    sandbox_option: bool | None,
    expected: bool,
) -> None:
    assert (
        browser._should_disable_chromium_sandbox(
            LocalBrowserLaunchOptions(chromium_sandbox=sandbox_option),
            platform=platform,
            environment=environment,
            getuid=lambda: uid,
        )
        is expected
    )


async def test_close_chrome_process_terminates_unix_process_group(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    signals: list[tuple[int, int]] = []

    class FakeProcess:
        returncode = None
        pid = 123

        async def wait(self) -> int:
            return 0

    monkeypatch.setattr(browser.sys, "platform", "linux")
    monkeypatch.setattr(browser.os, "killpg", lambda pid, sig: signals.append((pid, sig)))

    await browser._close_chrome_process(FakeProcess())

    assert signals == [(123, browser.signal.SIGTERM)]


async def test_close_chrome_process_force_kills_after_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    signals: list[tuple[int, int]] = []
    waits = 0

    class FakeProcess:
        returncode = None
        pid = 123

        async def wait(self) -> int:
            nonlocal waits
            waits += 1
            return 0

    async def timeout_wait(awaitable: object, *, timeout: float) -> int:
        assert timeout == 3
        cast(Any, awaitable).close()
        raise TimeoutError

    monkeypatch.setattr(browser.sys, "platform", "linux")
    monkeypatch.setattr(browser.os, "killpg", lambda pid, sig: signals.append((pid, sig)))
    monkeypatch.setattr(browser.asyncio, "wait_for", timeout_wait)

    await browser._close_chrome_process(FakeProcess())

    assert signals == [
        (123, browser.signal.SIGTERM),
        (123, browser.signal.SIGKILL),
    ]
    assert waits == 1


async def test_run_taskkill_terminates_windows_process_tree(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[tuple[object, ...], dict[str, object]]] = []

    class FakeTaskkill:
        async def wait(self) -> int:
            return 0

    async def create_subprocess_exec(
        *args: object,
        **kwargs: object,
    ) -> FakeTaskkill:
        calls.append((args, kwargs))
        return FakeTaskkill()

    monkeypatch.setattr(browser.asyncio, "create_subprocess_exec", create_subprocess_exec)

    await browser._run_taskkill(123, force=False)
    await browser._run_taskkill(123, force=True)

    assert [args for args, _ in calls] == [
        ("taskkill", "/PID", "123", "/T"),
        ("taskkill", "/PID", "123", "/T", "/F"),
    ]
    assert all(
        kwargs
        == {
            "stdin": asyncio.subprocess.DEVNULL,
            "stdout": asyncio.subprocess.DEVNULL,
            "stderr": asyncio.subprocess.DEVNULL,
        }
        for _, kwargs in calls
    )


async def test_close_chrome_process_ignores_finished_windows_tree(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeProcess:
        returncode = None
        pid = 123

        async def wait(self) -> int:
            return 0

    async def taskkill(_pid: int, *, force: bool) -> None:
        assert not force
        raise browser._TaskkillError(128)

    monkeypatch.setattr(browser.sys, "platform", "win32")
    monkeypatch.setattr(browser, "_run_taskkill", taskkill)

    await browser._close_chrome_process(FakeProcess())


async def test_close_chrome_process_skips_already_exited_process(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeProcess:
        returncode: int | None = 0
        pid = 123

        async def wait(self) -> int:
            raise AssertionError("already-exited process should not be awaited")

    async def terminate(_pid: int, *, force: bool) -> None:
        raise AssertionError(f"already-exited process received force={force}")

    monkeypatch.setattr(browser, "_terminate_chrome_process", terminate)

    await browser._close_chrome_process(FakeProcess())


async def test_close_local_chrome_combines_shutdown_and_profile_errors(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    termination_error = OSError("termination failed")
    profile_error = OSError("profile cleanup failed")

    async def close_process(_process: object) -> None:
        raise termination_error

    async def remove_profile(_path: Path) -> None:
        raise profile_error

    monkeypatch.setattr(browser, "_close_chrome_process", close_process)
    monkeypatch.setattr(browser, "_remove_chrome_profile", remove_profile)

    with pytest.raises(ExceptionGroup) as raised:
        await browser._close_local_chrome(
            cast(browser._ChromeProcess, object()),
            browser._ChromeProfile(path=tmp_path, remove=True),
        )

    assert raised.value.message == "Chrome termination and profile cleanup failed"
    assert raised.value.exceptions == (termination_error, profile_error)


async def test_launch_combines_spawn_and_profile_cleanup_errors(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    profile = tmp_path / "profile"
    profile.mkdir()
    profile_error = OSError("profile cleanup failed")

    async def create_subprocess_exec(*_args: object, **_kwargs: object) -> object:
        raise OSError("spawn failed")

    async def remove_profile(_path: Path) -> None:
        raise profile_error

    monkeypatch.setattr(browser, "_find_chrome_path", lambda _explicit: "/path/to/chrome")
    monkeypatch.setattr(browser, "_available_port", lambda: 9222)
    monkeypatch.setattr(browser.tempfile, "mkdtemp", lambda **_kwargs: str(profile))
    monkeypatch.setattr(browser.asyncio, "create_subprocess_exec", create_subprocess_exec)
    monkeypatch.setattr(browser, "_remove_chrome_profile", remove_profile)

    with pytest.raises(ExceptionGroup) as raised:
        await _launch_local_browser(LocalBrowserLaunchOptions())

    assert raised.value.message == "Chrome launch failed and browser cleanup also failed"
    assert isinstance(raised.value.exceptions[0], RuntimeError)
    assert str(raised.value.exceptions[0]) == "Failed to start Chrome: spawn failed"
    assert raised.value.exceptions[1] is profile_error


def test_local_browser_flags_keep_explicit_viewport_without_defaults(tmp_path: Path) -> None:
    flags = _local_browser_flags(
        LocalBrowserLaunchOptions(
            viewport=LocalViewport(width=1440, height=900),
            ignore_default_args=True,
        ),
        port=9222,
        user_data_dir=tmp_path,
        disable_sandbox=False,
    )

    assert "--window-size=1440,900" in flags
    assert set(_DEFAULT_CHROME_FLAGS).isdisjoint(flags)


def test_local_browser_flags_keep_ignored_explicit_viewport(tmp_path: Path) -> None:
    flags = _local_browser_flags(
        LocalBrowserLaunchOptions(
            viewport=LocalViewport(width=1440, height=900),
            ignore_default_args=["--window-size=1440,900"],
        ),
        port=9222,
        user_data_dir=tmp_path,
        disable_sandbox=False,
    )

    assert "--window-size=1440,900" in flags


def test_local_browser_flags_can_omit_implicit_default_viewport(tmp_path: Path) -> None:
    flags = _local_browser_flags(
        LocalBrowserLaunchOptions(ignore_default_args=["--window-size=1280,800"]),
        port=9222,
        user_data_dir=tmp_path,
        disable_sandbox=False,
    )

    assert "--window-size=1280,800" not in flags
