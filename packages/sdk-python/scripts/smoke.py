from __future__ import annotations

import asyncio
import os
from collections.abc import Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

import stagehand
from stagehand import Stagehand

_FIXTURE_BODY = b"<!doctype html><html><title>Stagehand package smoke</title></html>"


class _FixtureHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(_FIXTURE_BODY)))
        self.send_header("X-Stagehand-Fixture", "python-navigation-response")
        self.end_headers()
        self.wfile.write(_FIXTURE_BODY)

    def log_message(self, format: str, *args: object) -> None:
        pass


@contextmanager
def fixture_server() -> Iterator[str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _FixtureHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


async def main() -> None:
    package_root = Path(stagehand.__file__).parent
    if not (package_root / "_extension" / "manifest.json").is_file():
        raise RuntimeError("Installed Stagehand distribution is missing its browser extension")

    with fixture_server() as fixture_url:
        async with Stagehand(
            browser="local",
            headless=True,
            executable_path=os.environ.get("CHROME_PATH"),
        ) as client:
            page = await client.context.new_page()
            response = await page.goto(fixture_url)
            if response is None:
                raise RuntimeError("HTTP navigation did not return a response")
            if response.status != 200 or not response.ok:
                raise RuntimeError(f"Unexpected navigation status: {response.status}")
            if response.url.rstrip("/") != fixture_url:
                raise RuntimeError(f"Unexpected final response URL: {response.url}")
            if response.headers.get("x-stagehand-fixture") != "python-navigation-response":
                raise RuntimeError("Navigation response did not expose provisional headers")
            if await response.header_value("X-Stagehand-Fixture") != "python-navigation-response":
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


if __name__ == "__main__":
    asyncio.run(main())
