from __future__ import annotations

import pytest

from stagehand.browser_source import ResolvedBrowserSource, resolve_browser_source
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
