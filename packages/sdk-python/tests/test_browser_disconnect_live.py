from __future__ import annotations

import asyncio
import json
import os
import urllib.request
from urllib.parse import urlparse

import pytest

from stagehand import Stagehand, local_browser
from stagehand.browser import _launch_local_browser
from stagehand.client_models import LocalBrowserLaunchOptions

pytestmark = pytest.mark.skipif(
    os.environ.get("STAGEHAND_BROWSER_TESTS") != "1",
    reason="set STAGEHAND_BROWSER_TESTS=1 to run local Chromium tests",
)


def _get_json(url: str) -> object:
    with urllib.request.urlopen(url, timeout=5) as response:
        return json.loads(response.read())


async def test_disconnect_leaves_a_connected_chrome_running_with_its_pages() -> None:
    # Bounded like the TypeScript test; pytest has no default per-test timeout.
    async with asyncio.timeout(60):
        # Started outside Stagehand's browser factories, like a long-lived user browser.
        chrome = await _launch_local_browser(
            LocalBrowserLaunchOptions.model_validate({"headless": True})
        )
        try:
            browser = await local_browser.connect(cdp_url=chrome.cdp_url)
            stagehand = await Stagehand.create(browser=browser)
            page = await browser.context.new_page()
            await page.goto("data:text/html,<title>still here</title>", wait_until="load")
            await stagehand.close()

            await browser.disconnect()
            assert browser.closed is True
            await browser.close()

            host = urlparse(chrome.cdp_url).netloc
            version = await asyncio.to_thread(_get_json, f"http://{host}/json/version")
            assert isinstance(version, dict) and "Browser" in version
            targets = await asyncio.to_thread(_get_json, f"http://{host}/json/list")
            assert isinstance(targets, list)
            assert "still here" in [target.get("title") for target in targets]
        finally:
            await chrome.close()
