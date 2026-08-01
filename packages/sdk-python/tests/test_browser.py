from __future__ import annotations

import asyncio
from pathlib import Path
from typing import ClassVar, Literal

import pytest
from pydantic import ValidationError

from stagehand import browser
from stagehand.browser import (
    StagehandBrowser,
    _claim_browser,
    _connect_browser,
    _local_browser_flags,
    _release_browser,
    _WorkerInitMetadata,
    browserbase,
    local_browser,
)
from stagehand.client_models import LocalBrowserLaunchOptions


class FakeCDPClient:
    connect_arguments: ClassVar[list[dict[str, object]]] = []
    instances: ClassVar[list[FakeCDPClient]] = []
    connect_error: ClassVar[BaseException | None] = None
    close_error: ClassVar[Exception | None] = None

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


async def test_connect_uses_extension_id_or_packaged_extension_and_never_owns_source(
    fake_cdp: type[FakeCDPClient],
) -> None:
    with_id = await local_browser.connect(cdp_url="http://browser", extension_id="existing")
    assert fake_cdp.connect_arguments[-1]["extension_id"] == "existing"
    assert fake_cdp.connect_arguments[-1]["extension_dir"] is None
    await with_id.close()

    packaged = await local_browser.connect(cdp_url="http://browser", connect_timeout_ms=1_234)
    arguments = fake_cdp.connect_arguments[-1]
    assert arguments["extension_id"] is None
    assert str(arguments["extension_dir"]).endswith(("stagehand/_extension", "server/dist"))
    assert arguments["service_worker_url_includes"] == "service-worker.js"
    assert arguments["discovery_timeout_ms"] == 1_234
    assert arguments["cdp_connect_timeout_ms"] == 1_234
    assert arguments["command_timeout_ms"] == 10_000
    await packaged.close()


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


async def test_browserbase_factories_are_reserved() -> None:
    with pytest.raises(NotImplementedError, match="Browserbase sessions are not implemented yet"):
        await browserbase.launch(api_key="test")
    with pytest.raises(NotImplementedError, match="Browserbase sessions are not implemented yet"):
        await browserbase.connect(api_key="test", session_id="session")
