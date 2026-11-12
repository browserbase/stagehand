from __future__ import annotations

import asyncio
import os
import threading
from collections.abc import AsyncIterator, Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from typing_extensions import override

from stagehand import (
    DecisionChooseCallback,
    DecisionChooseInput,
    DecisionChooseOutput,
    DecisionContext,
    DecisionNoMatchResult,
    DecisionRefusedResult,
    DecisionSelectedResult,
    FilePayload,
    Page,
    PromptLocatorSelector,
    Stagehand,
    local_browser,
)

pytestmark = pytest.mark.skipif(
    os.environ.get("STAGEHAND_BROWSER_TESTS") != "1",
    reason="set STAGEHAND_BROWSER_TESTS=1 to run local Chromium tests",
)
FIXTURES = Path(__file__).resolve().parents[3] / "tests/fixtures/prompt-locators"


def prompt(value: str) -> PromptLocatorSelector:
    return PromptLocatorSelector(type="prompt", value=value)


async def select(request: DecisionChooseInput, context: DecisionContext) -> DecisionChooseOutput:
    matches = [c for c in request.candidates if f'"{request.prompt}"' in c.description]
    assert len(matches) == 1, request.candidates
    return DecisionSelectedResult(status="selected", id=matches[0].id)


class Decisions:
    def __init__(self) -> None:
        self.requests: list[DecisionChooseInput] = []
        self.handler: DecisionChooseCallback = select

    async def choose(
        self, request: DecisionChooseInput, context: DecisionContext
    ) -> DecisionChooseOutput:
        self.requests.append(request.model_copy(deep=True))
        return await self.handler(request, context)


@pytest.fixture(scope="module")
def prompt_server() -> Iterator[str]:
    class Handler(BaseHTTPRequestHandler):
        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

        def do_GET(self) -> None:
            filename = "frame.html" if self.path.startswith("/frame.html") else "index.html"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write((FIXTURES / filename).read_bytes())

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


@pytest.fixture
async def prompt_page(prompt_server: str) -> AsyncIterator[tuple[Page, Decisions]]:
    decisions = Decisions()
    browser = await local_browser.launch(headless=True, args=["--site-per-process"])
    try:
        client = await Stagehand.create(
            browser=browser, decision_model={"choose": decisions.choose}, logging={"level": "off"}
        )
        try:
            page = await browser.context.new_page(prompt_server)
            await page.wait_for_function("window.state.ready.length === 2")
            yield page, decisions
        finally:
            await client.close()
    finally:
        await browser.close()


async def test_uploads_preserve_files_and_filter_candidates(
    prompt_page: tuple[Page, Decisions], tmp_path: Path
) -> None:
    page, decisions = prompt_page
    resume = page.locator("#application").locator(prompt("Resume PDF"))
    await resume.set_input_files(
        FilePayload("resume.pdf", b"\x00\xffa", mime_type="application/pdf", last_modified=123)
    )
    request = decisions.requests[0]
    assert request.action == "upload"
    assert len(request.candidates) == 1
    assert 'accept=".pdf"' in request.candidates[0].description
    assert "resume.pdf" not in request.model_dump_json()
    assert await page.evaluate("""(async () => {
        const f = document.querySelector('#resume').files[0];
        return {name:f.name,type:f.type,lastModified:f.lastModified,
                bytes:[...new Uint8Array(await f.arrayBuffer())]};
    })()""") == {
        "name": "resume.pdf",
        "type": "application/pdf",
        "lastModified": 123,
        "bytes": [0, 255, 97],
    }
    path = tmp_path / "from-path.pdf"
    path.write_bytes(b"path bytes")
    await resume.set_input_files([path, FilePayload("second.pdf", "second")])
    assert await page.evaluate("[...document.querySelector('#resume').files].map(f => f.name)") == [
        "from-path.pdf",
        "second.pdf",
    ]
    await resume.set_input_files([])
    assert await page.evaluate("document.querySelector('#resume').files.length") == 0


async def test_native_control_actions(prompt_page: tuple[Page, Decisions]) -> None:
    page, _ = prompt_page
    await page.locator(prompt("Applicant")).fill("Ada")
    await page.locator(prompt("Applicant")).type(" Lovelace", delay=1)
    assert await page.locator("#applicant").input_value() == "Ada Lovelace"
    assert await page.locator(prompt("Plan")).select_option("pro") == ["pro"]
    assert await page.locator(prompt("Addons")).select_option(["a", "b"]) == ["a", "b"]
    await page.locator(prompt("Submit")).click()
    await page.locator(prompt("Event button")).send_click_event(bubbles=False)
    await page.locator(prompt("Hover control")).hover()
    await page.locator(prompt("scroll-zone")).scroll_to(100)
    await page.wait_for_function("document.querySelector('#scroll-zone').scrollTop === 250")
    assert await page.evaluate(
        "({clicks:state.clicks,eventClicks:state.eventClicks,hovered:state.hovered})"
    ) == {"clicks": 1, "eventClicks": 1, "hovered": True}


@pytest.mark.parametrize("name", ["same", "cross"])
async def test_frame_identity(prompt_page: tuple[Page, Decisions], name: str) -> None:
    page, decisions = prompt_page
    await page.locator(prompt(f"{name}-field")).fill(name)
    await page.wait_for_function(f'window.state.frames.{name}?.value === "{name}"')
    await (
        page
        .locator(f"#{name}")
        .locator(prompt(f"{name}-upload"))
        .set_input_files(FilePayload(f"{name}.txt", "frame bytes"))
    )
    await page.wait_for_function(f"window.state.frames.{name}?.files?.length === 1")
    assert await page.evaluate(f"window.state.frames.{name}.files") == [
        {"name": f"{name}.txt", "bytes": list(b"frame bytes")}
    ]
    assert len(decisions.requests[-1].candidates) == 1


@pytest.mark.parametrize("mode", ["open", "closed"])
async def test_shadow_identity(prompt_page: tuple[Page, Decisions], mode: str) -> None:
    page, _ = prompt_page
    await page.locator(f"#{mode}-host").locator(prompt(f"{mode} field")).fill(mode)
    assert await page.evaluate(f"window.shadowRoots.{mode}.querySelector('input').value") == mode
    await page.locator(prompt(f"{mode} upload")).set_input_files(
        FilePayload(f"{mode}.txt", "shadow")
    )
    assert (
        await page.evaluate(
            f"window.shadowRoots.{mode}.querySelector('input[type=file]').files[0].name"
        )
        == f"{mode}.txt"
    )


async def test_empty_scope_and_no_match(prompt_page: tuple[Page, Decisions]) -> None:
    page, decisions = prompt_page
    with pytest.raises(Exception, match="Could not find an element"):
        await page.locator("#empty").locator(prompt("Submit")).click()
    assert decisions.requests == []

    async def no_match(
        request: DecisionChooseInput, context: DecisionContext
    ) -> DecisionChooseOutput:
        return DecisionNoMatchResult(status="no_match")

    decisions.handler = no_match
    with pytest.raises(Exception, match="Could not find an element"):
        await page.locator("#application").locator(prompt("Resume PDF")).set_input_files([])
    assert len(decisions.requests) == 1
    assert len(decisions.requests[0].candidates) == 1


async def test_refusal_and_invalid_id(prompt_page: tuple[Page, Decisions]) -> None:
    page, decisions = prompt_page

    async def refuse(
        request: DecisionChooseInput, context: DecisionContext
    ) -> DecisionChooseOutput:
        return DecisionRefusedResult(status="refused")

    decisions.handler = refuse
    with pytest.raises(Exception, match="refused"):
        await page.locator(prompt("Submit")).click()

    outside_id = ""

    async def remember(
        request: DecisionChooseInput, context: DecisionContext
    ) -> DecisionChooseOutput:
        nonlocal outside_id
        outside_id = next(c.id for c in request.candidates if '"Portrait"' in c.description)
        return DecisionNoMatchResult(status="no_match")

    decisions.handler = remember
    with pytest.raises(Exception, match="Could not find"):
        await page.locator(prompt("Portrait")).set_input_files([])

    async def invalid(
        request: DecisionChooseInput, context: DecisionContext
    ) -> DecisionChooseOutput:
        return DecisionSelectedResult(status="selected", id=outside_id)

    decisions.handler = invalid
    with pytest.raises(Exception, match="outside the supplied candidates"):
        await page.locator("#application").locator(prompt("Resume PDF")).set_input_files([])
    assert await page.evaluate("window.state.clicks") == 0


async def test_stale_target_is_not_replaced(prompt_page: tuple[Page, Decisions]) -> None:
    page, decisions = prompt_page

    async def replace(
        request: DecisionChooseInput, context: DecisionContext
    ) -> DecisionChooseOutput:
        selected = await select(request, context)
        await page.evaluate("""const old = document.querySelector('[name=submit]');
            old.replaceWith(old.cloneNode(true))""")
        return selected

    decisions.handler = replace
    with pytest.raises(Exception, match="Prompt locator target is no longer attached"):
        await page.locator(prompt("Submit")).click()
    assert len(decisions.requests) == 1
    assert await page.evaluate("window.state.clicks") == 0


async def test_timeout_cancels_callback_and_discards_late_selection(
    prompt_page: tuple[Page, Decisions],
) -> None:
    page, decisions = prompt_page
    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def delayed(
        request: DecisionChooseInput, context: DecisionContext
    ) -> DecisionChooseOutput:
        started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
        return await select(request, context)

    decisions.handler = delayed
    async with asyncio.timeout(10):
        pending = asyncio.create_task(page.locator(prompt("Submit")).click(timeout=1000))
        with pytest.raises(Exception, match="timed out"):
            await pending
        assert started.is_set()
        await cancelled.wait()
        assert await page.evaluate("window.state.clicks") == 0
