"""Run with STAGEHAND_BROWSER_TESTS=1 after building packages/extension."""

from __future__ import annotations

import asyncio
import os
import time
from collections.abc import AsyncIterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import parse_qs, urlparse

import pytest
from typing_extensions import override

from stagehand import LLMGenerateInput, LLMGenerateOutput, Stagehand, local_browser
from stagehand.page import Page

pytestmark = pytest.mark.skipif(
    os.environ.get("STAGEHAND_BROWSER_TESTS") != "1",
    reason="requires a fresh extension build and Chrome",
)


@pytest.fixture
async def browser_fixture() -> AsyncIterator[tuple[Stagehand, Page, str, list[int]]]:
    clicks = [0]

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            url = urlparse(self.path)
            query = parse_qs(url.query)
            depth = int(query.get("depth", ["0"])[0])
            delay = int(query.get("delay", ["0"])[0])
            body = '<button>ready</button><input><div hidden id="hidden"></div>'
            if url.path == "/clicked":
                clicks[0] += 1
                body = "ok"
            elif depth:
                time.sleep(delay / 1000)
                body = (
                    f'<iframe src="/child?depth={depth - 1}&delay={delay}"></iframe>'
                    if depth > 1
                    else "<button onclick=\"fetch('/clicked')\">click</button>"
                )
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            try:
                self.wfile.write(body.encode())
            except (BrokenPipeError, ConnectionResetError):
                pass

        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    browser = await local_browser.launch(headless=True)
    try:

        async def generate(_: LLMGenerateInput) -> LLMGenerateOutput:
            raise AssertionError("deterministic act must not invoke the model")

        stagehand = await Stagehand.create(browser=browser, model=generate)
        try:
            page = await browser.context.new_page()
            yield stagehand, page, f"http://127.0.0.1:{server.server_port}", clicks
        finally:
            await stagehand.close()
    finally:
        await browser.close()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


async def prepare(page: Page, url: str, delay: int, depth: int = 1) -> str:
    await page.goto(url)
    await page.evaluate(
        f"document.body.insertAdjacentHTML('beforeend', "
        f"'<iframe src=\"/child?depth={depth}&delay={delay}\"></iframe>')"
    )
    return "iframe >> " * depth + "button"


@pytest.mark.parametrize(
    "delay,depth,timeout,succeeds",
    [
        (1800, 1, 4000, True),
        (1800, 1, None, True),
        (5500, 1, 0, True),
        (900, 1, 250, False),
        (6000, 1, None, False),
        (1800, 2, 2800, False),
        (2800, 2, None, False),
    ],
)
async def test_iframe_timeout(
    browser_fixture: tuple[Stagehand, Page, str, list[int]],
    delay: int,
    depth: int,
    timeout: int | None,
    succeeds: bool,
) -> None:
    _, page, url, clicks = browser_fixture
    selector = await prepare(page, url, delay, depth)
    start = time.monotonic()
    if succeeds:
        await page.locator(selector).click(timeout=timeout)
        for _ in range(100):
            if clicks[0]:
                break
            await asyncio.sleep(0.02)
        assert clicks[0] == 1
    else:
        with pytest.raises(Exception, match=f"{5000 if timeout is None else timeout}ms"):
            await page.locator(selector).click(timeout=timeout)
        assert time.monotonic() - start < (5000 if timeout is None else timeout) / 1000 + 1.2
        await page.wait_for_selector(selector, timeout=8000)
        await asyncio.sleep(0.25)
        assert clicks[0] == 0


async def test_act_and_selector_deadlines(
    browser_fixture: tuple[Stagehand, Page, str, list[int]],
) -> None:
    stagehand, page, url, clicks = browser_fixture
    selector = await prepare(page, url, 1800)
    with pytest.raises(Exception, match="250ms"):
        await page.wait_for_selector(selector, timeout=250)
    with pytest.raises(Exception, match="250ms"):
        await stagehand.act(
            {
                "selector": selector,
                "method": "click",
                "arguments": [],
                "description": "click child",
            },
            page=page,
            timeout=250,
        )
    await page.wait_for_selector(selector, timeout=4000)
    await asyncio.sleep(0.25)
    assert clicks[0] == 0


async def test_ready_queries_and_execution_delays(
    browser_fixture: tuple[Stagehand, Page, str, list[int]],
) -> None:
    _, page, url, _ = browser_fixture
    await page.goto(url)
    start = time.monotonic()
    await page.locator("button").click()
    assert await page.locator("#missing").count(timeout=4000) == 0
    assert not await page.locator("#hidden").is_visible(timeout=4000)
    with pytest.raises(Exception):
        await page.locator("#missing").is_visible(timeout=4000)
    assert time.monotonic() - start < 2
    with pytest.raises(Exception, match="250ms"):
        await page.locator("input").type("abcd", delay=300, timeout=250)
    value = await page.locator("input").input_value()
    await asyncio.sleep(1.2)
    assert await page.locator("input").input_value() == value
    await page.locator("input").fill("")
    await page.locator("input").type("ab", delay=150, timeout=2000)
    assert await page.locator("input").input_value() == "ab"
    with pytest.raises(Exception, match="250ms"):
        await page.locator("button").highlight(duration_ms=800, timeout=250)
    await page.locator("button").highlight(duration_ms=300, timeout=2000)
