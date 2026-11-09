from __future__ import annotations

import json
import os
import threading
from collections.abc import Iterator
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel
from typing_extensions import override

from stagehand import LLMGenerateInput, LLMGenerateOutput, Stagehand, local_browser
from stagehand._generated.models import BrowserSessionMetadata, LLMStructuredGenerateResult
from stagehand.browser import _WorkerInitMetadata

pytestmark = pytest.mark.skipif(
    os.environ.get("STAGEHAND_BROWSER_TESTS") != "1",
    reason="set STAGEHAND_BROWSER_TESTS=1 to run local Chromium routing tests",
)
_FIXTURE = json.loads(
    (Path(__file__).resolve().parents[3] / "tests/fixtures/browserbase-routing.json").read_text()
)


class Answer(BaseModel):
    answer: int


@pytest.fixture
def routing_server() -> Iterator[tuple[str, dict[str, Any]]]:
    state: dict[str, Any] = {"requests": [], "hit": False, "failure": False}

    class Handler(BaseHTTPRequestHandler):
        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

        def do_GET(self) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<html><body><h1>Answer: 42</h1></body></html>")

        def do_POST(self) -> None:
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            state["requests"].append((self.path, dict(self.headers), body))
            self.send_response(503 if state["failure"] else 200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            if self.path.endswith("/responses"):
                key = "metadata" if body["text"]["format"]["name"] == "Metadata" else "gateway"
            elif self.path.endswith("/cache/get"):
                key = "cacheHit" if state["hit"] else "cacheMiss"
            else:
                key = "cacheSet"
            self.wfile.write(json.dumps(_FIXTURE[key]).encode())

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", state
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


@pytest.mark.parametrize("mode", ["gateway", "custom", "cache-failure", "direct"])
async def test_browserbase_routing_in_chromium(
    routing_server: tuple[str, dict[str, Any]], monkeypatch: pytest.MonkeyPatch, mode: str
) -> None:
    origin, state = routing_server
    browser = await local_browser.launch(headless=True)
    # Session acquisition is a fixture; Chrome, the worker, RPC, and HTTP are real.
    browser._attachment = replace(
        browser._attachment,
        worker_init_metadata=_WorkerInitMetadata(
            api_key="bb-browser-routing",
            browser=BrowserSessionMetadata(session_id="session-routing"),
        ),
    )
    sent: list[object] = []
    original_send = browser._attachment.cdp_client.send

    async def send(message: dict[str, object]) -> None:
        sent.append(message)
        await original_send(message)

    monkeypatch.setattr(browser._attachment.cdp_client, "send", send)
    calls = 0

    async def generate(params: LLMGenerateInput) -> LLMGenerateOutput:
        nonlocal calls
        calls += 1
        value = (
            {"progress": "Complete", "completed": True}
            if getattr(params.response_format, "name", None) == "Metadata"
            else {"answer": 42}
        )
        return LLMStructuredGenerateResult.model_validate({
            "role": "assistant",
            "content": {"type": "text", "text": json.dumps(value)},
            "output_format": "json_schema",
            "structured_content": value,
        })

    client: Stagehand | None = None
    try:
        client = await Stagehand.create(
            browser=browser,
            api_key="bb-caller-routing",
            api_url=origin + "/services",
            model="openai/gpt-5" if mode == "direct" else generate if mode != "gateway" else None,
            model_api_key="provider-routing" if mode == "direct" else None,
            logging={"level": "off"},
        )
        page = await browser.context.new_page()
        await page.goto(origin + "/page")
        await browser.context.set_active_page(page)
        state["hit"] = mode == "direct"
        state["failure"] = mode == "cache-failure"
        result = await client.extract("Extract the answer", Answer)
        assert result.data.answer == (7 if mode == "direct" else 42)
        if mode in ("gateway", "custom"):
            batch = await client.experimental_batch(_FIXTURE["batchSource"])
            assert isinstance(batch, dict) and batch["data"] == {"answer": 42}
        if mode == "custom":
            before = calls
            override = await client.extract(
                "Extract the answer", Answer, model={"model_name": "anthropic/claude-sonnet-4-6"}
            )
            assert override.data.answer == 42 and calls == before
            # The same override is accepted inside the batch callback.
            source = _FIXTURE["batchSource"].removesuffix(")") + (
                ', {model: {modelName: "anthropic/claude-sonnet-4-6"}})'
            )
            await client.experimental_batch(source)
            assert calls == before
        elif mode == "cache-failure":
            assert calls == 2
            assert result.metadata.cache.miss_reason == "read_failed"

        requests = state["requests"]
        paths = [path for path, _, _ in requests]
        gateway = [body for path, _, body in requests if path.endswith("/responses")]
        expected_counts = {
            "gateway": (2, 4, 2),
            "custom": (4, 4, 4),
            "cache-failure": (1, 0, 1),
            "direct": (1, 0, 0),
        }[mode]
        assert (
            paths.count("/services/v1/cache/get"),
            len(gateway),
            paths.count("/services/v1/cache/set"),
        ) == expected_counts
        for path, headers, body in requests:
            headers = {key.lower(): value for key, value in headers.items()}
            assert headers["x-bb-api-key"] == "bb-browser-routing"
            if path.endswith("/responses"):
                assert headers["x-bb-session-id"] == "session-routing"
                if mode == "gateway":
                    assert "model" not in body
                else:
                    assert body["model"] == "anthropic/claude-sonnet-4-6"
        serialized = json.dumps(sent)
        assert "bb-browser-routing" not in serialized
        assert "bb-caller-routing" not in serialized
        if mode == "direct":
            assert "provider-routing" in serialized
    finally:
        try:
            if client is not None:
                await client.close()
        finally:
            await browser.close()
