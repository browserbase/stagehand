import asyncio
import html
import os
import re
import threading
from collections.abc import Iterator
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from pydantic import BaseModel

from stagehand import LLMGenerateInput, LLMGenerateOutput, Stagehand, local_browser
from stagehand._generated.models import LLMStructuredGenerateParams, LLMStructuredGenerateResult

pytestmark = pytest.mark.skipif(
    os.environ.get("STAGEHAND_BROWSER_TESTS") != "1",
    reason="set STAGEHAND_BROWSER_TESTS=1 to run local Chromium tests",
)


class Label(BaseModel):
    label: str


@pytest.fixture
def page_server(tmp_path: Path) -> Iterator[str]:
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(tmp_path))
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


async def test_public_chains_act_count_mask_and_scope_ai_operations(
    page_server: str,
    tmp_path: Path,
) -> None:
    calls: list[str] = []

    async def generate(params: LLMGenerateInput) -> LLMGenerateOutput:
        assert isinstance(params, LLMStructuredGenerateParams)
        messages = params.model_dump()["messages"]
        text = "\n".join(
            content["text"]
            for message in messages
            for content in (
                message["content"] if isinstance(message["content"], list) else [message["content"]]
            )
            if content["type"] == "text"
        )
        name = params.response_format.name
        calls.append(name)
        if name != "Metadata":
            assert "Save target" in text
            assert not re.search(r"Outside parent|Outside child|Excluded choice", text)
        match = re.search(r"\[(\d+-\d+)\][^\n]*Save target", text)
        if name in ("Act", "Observation"):
            assert match is not None
        action = {
            "elementId": match[1] if match else "",
            "description": "Save target",
            "method": "click",
            "arguments": [],
        }
        return LLMStructuredGenerateResult.model_validate({
            "role": "assistant",
            "content": {"type": "text", "text": "fixture response"},
            "output_format": "json_schema",
            "structured_content": (
                {"action": action, "twoStep": False}
                if name == "Act"
                else {"elements": [action]}
                if name == "Observation"
                else {"label": "Save target"}
                if name == "Extraction"
                else {"completed": True, "progress": "Read label"}
            ),
        })

    child = """<section id="scope">
        <button onclick="this.dataset.clicked='yes'"><span>Save target</span></button>
        <button class="omit">Excluded choice</button></section><button>Outside child</button>
        <div id="open"></div><div id="closed"></div><script>
          for (const mode of ['open', 'closed']) {
            document.getElementById(mode).attachShadow({mode}).innerHTML =
              '<button>Shadow ' + mode + '</button>';
          }
        </script>
    """
    markup = (
        "<button>Outside parent</button>"
        f'<iframe srcdoc="{html.escape(child, quote=True)}"></iframe>'
    )

    (tmp_path / "index.html").write_text(markup)

    async with asyncio.timeout(60):
        browser = await local_browser.launch(headless=True)
        stagehand = None
        try:
            stagehand = await Stagehand.create(browser=browser, model=generate)
            page = await browser.context.new_page()
            await page.goto(page_server, wait_until="load")
            scope = page.locator("iframe").locator("#scope")
            buttons = scope.locator("button")
            assert await buttons.count() == 2
            assert await page.get_by_role("button", name="Save target").count() == 0
            roles = page.locator("iframe").get_by_role("button", name="Save target", exact=True)
            assert await roles.count() == 1
            assert await roles.get_by_role("button").count() == 0
            assert await roles.get_by_text("Save target").text_content() == "Save target"
            assert await scope.get_by_role("button").nth(1).text_content() == "Excluded choice"
            await roles.first().click(timeout=5000)
            assert await scope.locator("button[data-clicked=yes]").count() == 1
            assert await roles.locator("span").text_content() == "Save target"
            shadows = page.locator("iframe").get_by_role("button", name="Shadow")
            assert await shadows.count() == 2
            assert await shadows.first().text_content() == "Shadow open"
            assert await shadows.nth(1).text_content() == "Shadow closed"
            unmasked = await page.screenshot()
            masked = await page.screenshot(mask=[roles, shadows])
            assert masked and masked != unmasked
            assert await page.get_by_text("Save target").count() == 0
            assert await page.locator("iframe").get_by_text("Save target", exact=True).count() == 1
            assert (
                await buttons.get_by_text("Save target", exact=True).text_content() == "Save target"
            )
            assert await buttons.nth(1).text_content() == "Excluded choice"
            await buttons.first().click(timeout=5000)
            assert await scope.locator("button[data-clicked=yes]").count() == 1
            assert await page.screenshot(mask=[buttons])

            ignored = [scope.locator(".omit")]
            observed = await stagehand.observe(
                "Find the button", page=page, locator=scope, ignore_locators=ignored
            )
            assert len(observed.data) == 1
            extracted = await stagehand.extract(
                "Read the button label", Label, page=page, locator=scope, ignore_locators=ignored
            )
            assert extracted.data == Label(label="Save target")
            acted = await stagehand.act(
                "Click the button", page=page, locator=scope, ignore_locators=ignored
            )
            assert acted.data.success
            assert {"Act", "Observation", "Extraction"} <= set(calls)
        finally:
            if stagehand is not None:
                await stagehand.close()
            await browser.close()
