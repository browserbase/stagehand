from __future__ import annotations

import asyncio
import os
from collections.abc import Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Thread

from typing_extensions import override

import stagehand as stagehand_package
from stagehand import Page, Stagehand, local_browser
from stagehand.rpc_client import RPCError

_FIXTURE_BODY = b"<!doctype html><html><title>Stagehand package smoke</title></html>"


@contextmanager
def fixture_server(
    gate: Event | None = None, child_requested: Event | None = None
) -> Iterator[str]:
    class FixtureHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            body = _FIXTURE_BODY
            if gate is not None:
                if self.path == "/child":
                    if child_requested is not None:
                        child_requested.set()
                    gate.wait()
                    body = (
                        b"<button id='b' onclick='this.textContent="
                        b"Number(this.textContent)+1'>0</button>"
                    )
                else:
                    body = b"<!doctype html><iframe src='/child'></iframe>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Stagehand-Fixture", "python-navigation-response")
            self.end_headers()
            self.wfile.write(body)

        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        if gate is not None:
            gate.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


async def check_locator_timeouts(page: Page) -> None:
    for timeout in (250, 0):
        gate, child_requested = Event(), Event()
        with fixture_server(gate, child_requested) as url:
            await page.goto(url, wait_until="domcontentloaded")
            if not await asyncio.to_thread(child_requested.wait, 5):
                raise RuntimeError("Browser did not request the delayed iframe")
            button = page.locator("iframe >> #b")
            click = asyncio.create_task(button.click(timeout=timeout))
            try:
                if timeout:
                    try:
                        await asyncio.wait_for(click, timeout=5)
                    except RPCError as error:
                        if (
                            not isinstance(error.data, dict)
                            or error.data.get("name") != "TimeoutError"
                        ):
                            raise AssertionError(
                                f"Expected browser TimeoutError, got {error}"
                            ) from error
                        if "locator.click" not in str(error):
                            raise AssertionError(
                                f"Timeout did not name the action: {error}"
                            ) from error
                    else:
                        raise AssertionError("Click succeeded while the iframe response was held")
                    gate.set()
                    if await button.inner_text(timeout=5000) != "0":
                        raise AssertionError("Timed-out click fired when the iframe loaded")
                    await asyncio.sleep(0.35)
                    if await button.inner_text(timeout=5000) != "0":
                        raise AssertionError("Timed-out click fired after returning its error")
                else:
                    # Stay blocked beyond the previous 1,200 ms frame readiness limit.
                    await asyncio.sleep(1.6)
                    if click.done():
                        raise AssertionError("Unlimited click stopped before the iframe loaded")
                    gate.set()
                    await asyncio.wait_for(click, timeout=5)
                    if await button.inner_text(timeout=5000) != "1":
                        raise AssertionError("Unlimited click did not execute exactly once")
            finally:
                gate.set()
                if not click.done():
                    click.cancel()
                await asyncio.gather(click, return_exceptions=True)
        print(f"locator timeout {timeout}: passed", flush=True)


async def main() -> None:
    package_root = Path(stagehand_package.__file__).parent
    if not (package_root / "_extension" / "manifest.json").is_file():
        raise RuntimeError("Installed Stagehand distribution is missing its browser extension")

    with fixture_server() as fixture_url:
        browser = await local_browser.launch(
            headless=True,
            executable_path=os.environ.get("CHROME_PATH"),
        )
        try:
            stagehand = await Stagehand.create(browser=browser)
            try:
                page = await browser.context.new_page()
                response = await page.goto(fixture_url)
                if response is None:
                    raise RuntimeError("HTTP navigation did not return a response")
                if response.status != 200 or not response.ok:
                    raise RuntimeError(f"Unexpected navigation status: {response.status}")
                if response.url.rstrip("/") != fixture_url:
                    raise RuntimeError(f"Unexpected final response URL: {response.url}")
                if response.headers.get("x-stagehand-fixture") != "python-navigation-response":
                    raise RuntimeError("Navigation response did not expose provisional headers")
                if (
                    await response.header_value("X-Stagehand-Fixture")
                    != "python-navigation-response"
                ):
                    raise RuntimeError("Navigation response did not retrieve lazy headers")
                if await response.body() != _FIXTURE_BODY:
                    raise RuntimeError("Navigation response did not retrieve its binary body")
                if await response.text() != _FIXTURE_BODY.decode():
                    raise RuntimeError("Navigation response did not retrieve its text body")
                if await response.finished() is not None:
                    raise RuntimeError("Successful navigation response reported a loading error")
                if await page.title() != "Stagehand package smoke":
                    raise RuntimeError(
                        "Installed Stagehand distribution could not navigate with Chrome"
                    )
                await check_locator_timeouts(page)
            finally:
                await stagehand.close()
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
