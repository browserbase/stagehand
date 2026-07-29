from __future__ import annotations

import pytest

from stagehand.browser_source import ResolvedBrowserSource, resolve_browser_source
from stagehand.browserbase_session import BrowserbaseSession
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
async def test_browserbase_sources_create_a_preloaded_stagehand_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    closes = 0
    captured_api_key = ""
    captured_browser: object | None = None

    async def close() -> None:
        nonlocal closes
        closes += 1

    async def create_session(
        api_key: str,
        browser: object,
    ) -> BrowserbaseSession:
        nonlocal captured_api_key, captured_browser
        captured_api_key = api_key
        captured_browser = browser
        return BrowserbaseSession(
            session_id="session_123",
            cdp_url="wss://connect.browserbase.test/session_123",
            close=close,
        )

    monkeypatch.setattr(
        "stagehand.browser_source.create_browserbase_session",
        create_session,
    )
    browserbase = StagehandClientInitParams.model_validate({
        "api_key": "test",
        "browser": {"type": "browserbase", "keep_alive": True},
    })

    source = await resolve_browser_source(browserbase)

    assert captured_api_key == "test"
    assert captured_browser is browserbase.browser
    assert source.cdp_url == "wss://connect.browserbase.test/session_123"
    assert source.browserbase_session_id == "session_123"
    assert source.preloaded_extension is True
    assert source.keep_alive is True
    await source.close()
    assert closes == 1


@pytest.mark.asyncio
async def test_cdp_headers_fail_as_an_explicit_unsupported_feature() -> None:
    cdp_headers = StagehandClientInitParams.model_validate({
        "browser": {
            "type": "cdp",
            "cdp_url": "http://localhost:9222",
            "headers": {"Authorization": "Bearer test"},
        }
    })

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
async def test_resolved_browser_sources_retry_failed_cleanup() -> None:
    closes = 0

    async def close() -> None:
        nonlocal closes
        closes += 1
        if closes == 1:
            raise RuntimeError("cleanup failed")

    source = ResolvedBrowserSource(
        cdp_url="test://browser",
        keep_alive=False,
        _close_callback=close,
    )

    with pytest.raises(RuntimeError, match="cleanup failed"):
        await source.close()
    await source.close()
    await source.close()

    assert closes == 2


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
