from __future__ import annotations

import pytest

from stagehand.browser_source import (
    ResolvedBrowserSource,
    _chrome_file_candidates,
    _find_chrome_path,
    resolve_browser_source,
)
from stagehand.client_models import StagehandClientInitParams


@pytest.mark.asyncio
async def test_cdp_browser_sources_connect_to_an_existing_browser() -> None:
    source = await resolve_browser_source(
        StagehandClientInitParams.model_validate({
            "browser": {"type": "cdp", "cdp_url": "http://localhost:9222"}
        })
    )

    assert source.cdp_url == "http://localhost:9222"
    assert source.keep_alive is True


@pytest.mark.asyncio
async def test_browserbase_and_cdp_headers_fail_as_explicit_unsupported_features() -> None:
    browserbase = StagehandClientInitParams.model_validate({
        "api_key": "test",
        "browser": {"type": "browserbase"},
    })
    cdp_headers = StagehandClientInitParams.model_validate({
        "browser": {
            "type": "cdp",
            "cdp_url": "http://localhost:9222",
            "headers": {"Authorization": "Bearer test"},
        }
    })

    with pytest.raises(NotImplementedError, match="Browserbase session creation"):
        await resolve_browser_source(browserbase)
    with pytest.raises(NotImplementedError, match="CDP headers"):
        await resolve_browser_source(cdp_headers)


@pytest.mark.asyncio
async def test_resolved_browser_sources_close_once() -> None:
    closes = 0

    async def close() -> None:
        nonlocal closes
        closes += 1

    source = ResolvedBrowserSource(
        cdp_url="test://browser",
        keep_alive=False,
        _close_callback=close,
    )

    await source.close()
    await source.close()

    assert closes == 1


@pytest.mark.asyncio
async def test_local_browser_sources_use_the_local_launcher(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    launched_headless: bool | None = None

    async def launch(options: object) -> ResolvedBrowserSource:
        nonlocal launched_headless
        launched_headless = getattr(options, "headless")
        return ResolvedBrowserSource(cdp_url="http://localhost:9333", keep_alive=False)

    monkeypatch.setattr("stagehand.browser_source._launch_local_browser", launch)
    params = StagehandClientInitParams.model_validate({
        "browser": {"type": "local", "headless": True}
    })

    source = await resolve_browser_source(params)

    assert launched_headless is True
    assert source.cdp_url == "http://localhost:9333"


def test_macos_browser_candidates_are_ordered_by_release_channel() -> None:
    candidates = _chrome_file_candidates("darwin", {}, "/Users/tester")

    assert candidates == (
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Users/tester/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
        "/Users/tester/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
        "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev",
        "/Users/tester/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        "/Users/tester/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Users/tester/Applications/Chromium.app/Contents/MacOS/Chromium",
    )


def test_windows_browser_candidates_are_ordered_by_release_channel() -> None:
    candidates = _chrome_file_candidates(
        "win32",
        {
            "LOCALAPPDATA": r"C:\Users\tester\AppData\Local",
            "PROGRAMFILES": r"C:\Program Files",
        },
        r"C:\Users\tester",
    )

    assert candidates[:6] == (
        r"C:\Users\tester\AppData\Local\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Users\tester\AppData\Local\Google\Chrome Beta\Application\chrome.exe",
        r"C:\Program Files\Google\Chrome Beta\Application\chrome.exe",
        r"C:\Users\tester\AppData\Local\Google\Chrome Dev\Application\chrome.exe",
        r"C:\Program Files\Google\Chrome Dev\Application\chrome.exe",
    )
    assert r"C:\Users\tester\AppData\Local\Google\Chrome SxS\Application\chrome.exe" in candidates


def test_linux_browser_lookup_uses_release_channel_order() -> None:
    attempts: list[str] = []

    def which(name: str) -> str | None:
        attempts.append(name)
        return "/usr/bin/google-chrome-unstable" if name == "google-chrome-unstable" else None

    assert (
        _find_chrome_path(
            platform="linux", environ={}, is_file=lambda _candidate: False, which=which
        )
        == "/usr/bin/google-chrome-unstable"
    )
    assert attempts == [
        "google-chrome-stable",
        "google-chrome",
        "google-chrome-beta",
        "google-chrome-unstable",
    ]


@pytest.mark.parametrize(
    "installed",
    [
        "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ],
)
def test_browser_lookup_falls_back_to_the_only_installed_variant(installed: str) -> None:
    assert (
        _find_chrome_path(
            platform="darwin",
            environ={},
            home_directory="/Users/tester",
            is_file=lambda candidate: candidate == installed,
        )
        == installed
    )


def test_browser_lookup_prefers_valid_chrome_path() -> None:
    assert (
        _find_chrome_path(
            platform="linux",
            environ={"CHROME_PATH": "/custom/chrome"},
            is_file=lambda candidate: candidate == "/custom/chrome",
        )
        == "/custom/chrome"
    )


def test_browser_lookup_skips_invalid_chrome_path_and_prefers_stable() -> None:
    stable = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    canary = "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"

    assert (
        _find_chrome_path(
            platform="darwin",
            environ={"CHROME_PATH": "/missing/chrome"},
            home_directory="/Users/tester",
            is_file=lambda candidate: candidate in {stable, canary},
        )
        == stable
    )


def test_browser_lookup_raises_stagehand_specific_error() -> None:
    with pytest.raises(
        RuntimeError,
        match=r"Chrome Stable, Beta, Dev, Canary, and Chromium.*executable_path.*CHROME_PATH",
    ):
        _find_chrome_path(
            platform="linux",
            environ={},
            is_file=lambda _candidate: False,
            which=lambda _name: None,
        )


@pytest.mark.asyncio
async def test_explicit_executable_path_bypasses_discovery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    launched: tuple[object, ...] | None = None

    class Process:
        returncode = 0

    async def create_process(*args: object, **_kwargs: object) -> Process:
        nonlocal launched
        launched = args
        return Process()

    def fail_discovery() -> str:
        raise AssertionError("automatic discovery should not run")

    monkeypatch.setattr("stagehand.browser_source.asyncio.create_subprocess_exec", create_process)
    monkeypatch.setattr("stagehand.browser_source._find_chrome_path", fail_discovery)
    params = StagehandClientInitParams.model_validate({
        "browser": {
            "type": "local",
            "executable_path": "/custom/chrome",
            "user_data_dir": "/tmp/stagehand-test-profile",
        }
    })

    await resolve_browser_source(params)

    assert launched is not None
    assert launched[0] == "/custom/chrome"
