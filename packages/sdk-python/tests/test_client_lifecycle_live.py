"""Run with STAGEHAND_BROWSER_TESTS=1 after building packages/extension."""

import asyncio
import json
import os
import signal
import sys
from pathlib import Path

import pytest
from websockets.asyncio.client import connect

from stagehand import Stagehand, local_browser

pytestmark = pytest.mark.skipif(
    os.environ.get("STAGEHAND_BROWSER_TESTS") != "1" or sys.platform == "win32",
    reason="requires an opt-in local Chrome and POSIX process signals",
)

CHILD = """
import asyncio, json, sys
from stagehand import Stagehand, local_browser
async def main():
    browser = await local_browser.launch(
        headless=True, keep_alive=sys.argv[1] == 'true', user_data_dir=sys.argv[2]
    )
    stagehand = await Stagehand.create(browser=browser, logging={'level': 'off'})
    cdp_url = browser._attachment.cdp_client.web_socket_debugger_url
    print(json.dumps({'cdp_url': cdp_url}), flush=True)
    await asyncio.Event().wait()
asyncio.run(main())
"""


@pytest.mark.parametrize("keep_alive", [False, True])
async def test_client_death_and_reconnection(keep_alive: bool, tmp_path: Path) -> None:
    # Bounded like the neighboring live tests; pytest has no default per-test timeout.
    async with asyncio.timeout(60):
        await _client_death_and_reconnection(keep_alive, tmp_path)


async def _client_death_and_reconnection(keep_alive: bool, tmp_path: Path) -> None:
    child = await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        CHILD,
        str(keep_alive).lower(),
        str(tmp_path / "chrome"),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        assert child.stdout is not None
        line = await asyncio.wait_for(child.stdout.readline(), 40)
        if not line:
            assert child.stderr is not None
            raise AssertionError((await child.stderr.read()).decode())
        cdp_url = json.loads(line)["cdp_url"]
        async with connect(cdp_url) as observer:
            try:
                child.send_signal(signal.SIGKILL if keep_alive else signal.SIGINT)
                await asyncio.wait_for(child.wait(), 5)
                if keep_alive:
                    browser = await local_browser.connect(cdp_url=cdp_url)
                    try:
                        stagehand = await Stagehand.create(
                            browser=browser, logging={"level": "off"}
                        )
                        pages = await browser.context.pages()
                        assert pages
                        assert "about:blank#stagehand-client-connection" not in [
                            await page.url() for page in pages
                        ]
                        await stagehand.close()
                    finally:
                        await browser.close()
                else:
                    await asyncio.wait_for(observer.wait_closed(), 5)
            finally:
                if observer.close_code is None:
                    await observer.send(json.dumps({"id": 1, "method": "Browser.close"}))
                    await asyncio.wait_for(observer.wait_closed(), 5)
    finally:
        if child.returncode is None:
            child.kill()
        await child.wait()


async def test_intentional_disconnect_preserves_owned_browser(tmp_path: Path) -> None:
    async with asyncio.timeout(60):
        await _intentional_disconnect_preserves_owned_browser(tmp_path)


async def _intentional_disconnect_preserves_owned_browser(tmp_path: Path) -> None:
    # A named profile: the reconnected handle closes Chrome but cannot remove the
    # original launch's temporary profile, so pytest's tmp_path owns it.
    browser = await local_browser.launch(headless=True, user_data_dir=str(tmp_path / "chrome"))
    try:
        await Stagehand.create(browser=browser, logging={"level": "off"})
        await browser.disconnect()
        with pytest.raises(RuntimeError, match=r"connect\(\) again to close it"):
            await browser.close()
        assert browser.cdp_url is not None
        # The new handle owns closing it: Browser.close over its own connection.
        connected = await local_browser.connect(cdp_url=browser.cdp_url)
        try:
            fresh = await Stagehand.create(browser=connected, logging={"level": "off"})
            assert await connected.context.pages()
            await fresh.close()
        finally:
            await connected.close()
    finally:
        if not browser.closed:
            await browser.close()
