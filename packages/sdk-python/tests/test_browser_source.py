from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from stagehand.browser_source import (
    _WEBMCP_CHROME_FLAG,
    ResolvedBrowserSource,
    _local_browser_flags,
    resolve_browser_source,
)
from stagehand.client_models import (
    BrowserbaseBrowserSource,
    LocalBrowserSource,
    StagehandClientInitParams,
)


def test_browserbase_uploaded_extension_id_is_top_level_only() -> None:
    params = StagehandClientInitParams.model_validate({
        "api_key": "test",
        "browser": {
            "type": "browserbase",
            "extension_id": "uploaded-extension",
            "browser_settings": {"extensions": ["browser-events"]},
        },
    })

    assert isinstance(params.browser, BrowserbaseBrowserSource)
    assert params.browser.extension_id == "uploaded-extension"
    with pytest.raises(ValidationError):
        StagehandClientInitParams.model_validate({
            "api_key": "test",
            "browser": {
                "type": "browserbase",
                "browser_settings": {"extension_id": "uploaded-extension"},
            },
        })


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


def test_local_browser_flags_enable_webmcp_by_default(tmp_path: Path) -> None:
    flags = _local_browser_flags(
        LocalBrowserSource(type="local"),
        port=9222,
        user_data_dir=tmp_path,
        is_ci=False,
    )

    assert _WEBMCP_CHROME_FLAG in flags
    assert "--enable-unsafe-extension-debugging" in flags
    assert "--remote-allow-origins=*" in flags


def test_local_browser_flags_omit_defaults_when_requested(
    tmp_path: Path,
) -> None:
    flags = _local_browser_flags(
        LocalBrowserSource(
            type="local",
            ignore_default_args=True,
            args=["--user-supplied"],
        ),
        port=9222,
        user_data_dir=tmp_path,
        is_ci=False,
    )

    assert flags == [
        "--remote-debugging-port=9222",
        f"--user-data-dir={tmp_path}",
        "--user-supplied",
        "about:blank",
    ]


def test_local_browser_flags_can_selectively_omit_webmcp(
    tmp_path: Path,
) -> None:
    flags = _local_browser_flags(
        LocalBrowserSource(type="local", ignore_default_args=[_WEBMCP_CHROME_FLAG]),
        port=9222,
        user_data_dir=tmp_path,
        is_ci=False,
    )

    assert _WEBMCP_CHROME_FLAG not in flags
    assert "--enable-unsafe-extension-debugging" in flags
    assert "--disable-background-networking" in flags


def test_local_browser_flags_append_user_arguments(
    tmp_path: Path,
) -> None:
    flags = _local_browser_flags(
        LocalBrowserSource(
            type="local",
            headless=True,
            devtools=True,
            args=["--custom-flag"],
        ),
        port=9222,
        user_data_dir=tmp_path,
        is_ci=True,
    )

    assert flags[-5:] == [
        "--headless",
        "--auto-open-devtools-for-tabs",
        "--no-sandbox",
        "--custom-flag",
        "about:blank",
    ]
