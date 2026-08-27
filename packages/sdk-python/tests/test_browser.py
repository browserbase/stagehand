from __future__ import annotations

import asyncio
from pathlib import Path
from typing import ClassVar, Literal, cast

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
    _WEBMCP_CHROME_FLAG,
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
            _local_browser_flags(options, port=9222, user_data_dir=tmp_path, is_ci=False)
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
    flags = _local_browser_flags(options, port=9222, user_data_dir=tmp_path, is_ci=True)

    assert flags[-5:] == [
        "--headless",
        "--auto-open-devtools-for-tabs",
        "--no-sandbox",
        "--custom-flag",
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


async def test_local_browser_close_ignores_vanished_process_and_removes_profile(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    profile = tmp_path / "profile"
    profile.mkdir()

    class FakeProcess:
        returncode = None
        pid = 123

        def terminate(self) -> None:
            raise ProcessLookupError

        async def wait(self) -> int:
            return 0

    async def create_subprocess_exec(*_args: object, **_kwargs: object) -> FakeProcess:
        return FakeProcess()

    monkeypatch.setattr(browser, "_find_chrome_path", lambda: "/path/to/chrome")
    monkeypatch.setattr(browser, "_available_port", lambda: 9222)
    monkeypatch.setattr(browser.tempfile, "mkdtemp", lambda **_kwargs: str(profile))
    monkeypatch.setattr(browser.asyncio, "create_subprocess_exec", create_subprocess_exec)
    monkeypatch.setattr(browser.sys, "platform", "win32")

    source = await _launch_local_browser(LocalBrowserLaunchOptions())
    await source.close()

    assert not profile.exists()


def test_local_browser_flags_keep_explicit_viewport_without_defaults(tmp_path: Path) -> None:
    flags = _local_browser_flags(
        LocalBrowserLaunchOptions(
            viewport=LocalViewport(width=1440, height=900),
            ignore_default_args=True,
        ),
        port=9222,
        user_data_dir=tmp_path,
        is_ci=False,
    )

    assert "--window-size=1440,900" in flags
    assert _WEBMCP_CHROME_FLAG not in flags
    assert set(_DEFAULT_CHROME_FLAGS).isdisjoint(flags)


def test_local_browser_flags_keep_ignored_explicit_viewport(tmp_path: Path) -> None:
    flags = _local_browser_flags(
        LocalBrowserLaunchOptions(
            viewport=LocalViewport(width=1440, height=900),
            ignore_default_args=["--window-size=1440,900"],
        ),
        port=9222,
        user_data_dir=tmp_path,
        is_ci=False,
    )

    assert "--window-size=1440,900" in flags


def test_local_browser_flags_can_omit_implicit_default_viewport(tmp_path: Path) -> None:
    flags = _local_browser_flags(
        LocalBrowserLaunchOptions(ignore_default_args=["--window-size=1280,800"]),
        port=9222,
        user_data_dir=tmp_path,
        is_ci=False,
    )

    assert "--window-size=1280,800" not in flags
