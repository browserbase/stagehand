from __future__ import annotations

import asyncio
import json
import os
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from typing_extensions import override

from stagehand import LLMGenerateInput, LLMGenerateOutput, Stagehand, local_browser
from stagehand._generated.models import LLMStructuredGenerateResult

pytestmark = pytest.mark.skipif(
    os.environ.get("STAGEHAND_BROWSER_TESTS") != "1",
    reason="set STAGEHAND_BROWSER_TESTS=1 to run local Chromium tests",
)


@pytest.fixture
def locator_server() -> Iterator[str]:
    class Handler(BaseHTTPRequestHandler):
        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

        def do_GET(self) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            if self.path == "/frame":
                self.wfile.write(b"<button>Pay frame</button>")
            else:
                self.wfile.write(b"""<!doctype html><html><body>
                    <button>Pay outside</button>
                    <section class="card" aria-label="First card">
                        <button>Pay first</button>
                    </section>
                    <section class="card" aria-label="Second card">
                        <button onclick="this.textContent='Paid second'">Pay second</button>
                        <p>Keep second</p>
                    </section>
                    <iframe src="/frame"></iframe><iframe src="/frame"></iframe>
                </body></html>""")

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


async def test_sdk_chains_legacy_inputs_scopes_exclusions_and_masks(locator_server: str) -> None:
    async with asyncio.timeout(60):
        prompts: list[str] = []

        async def generate(params: LLMGenerateInput) -> LLMGenerateOutput:
            prompts.append(params.model_dump_json())
            return LLMStructuredGenerateResult.model_validate({
                "role": "assistant",
                "content": {"type": "text", "text": json.dumps({"elements": []})},
                "output_format": "json_schema",
                "structured_content": {"elements": []},
            })

        browser = await local_browser.launch(headless=True)
        try:
            client = await Stagehand.create(
                browser=browser, model=generate, logging={"level": "off"}
            )
            page = await browser.context.new_page(locator_server)
            cards = page.locator(".card").nth(1)
            pay = cards.locator({"type": "text", "value": "Pay"})
            assert await pay.text_content() == "Pay second"
            assert (
                await page.locator(".card").locator("button").nth(1).text_content() == "Pay second"
            )
            for selector in (
                'iframe >> text="Pay frame"',
                "xpath=/html/body/iframe[2]/html/body/button",
                "//iframe[2]//button",
            ):
                assert await page.locator(selector).text_content() == "Pay frame"
            assert (
                await page.locator("iframe").locator({"type": "text", "value": "Pay frame"}).count()
                == 2
            )
            await client.observe(
                "List available actions", page=page, locator=cards, ignore_locators=[pay]
            )
            assert len(prompts) == 1
            assert "Keep second" in prompts[0]
            assert "Pay second" not in prompts[0]
            assert "Pay outside" not in prompts[0]
            screenshot = await page.screenshot(mask=[page.locator("iframe").locator("button")])
            assert screenshot[:4] == bytes.fromhex("89504e47")
            await pay.click()
            assert await cards.locator("button").text_content() == "Paid second"
            await client.close()
        finally:
            await browser.close()
