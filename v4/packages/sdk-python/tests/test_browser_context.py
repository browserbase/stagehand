from __future__ import annotations

import re
from typing import cast

import pytest

from stagehand._generated.models import (
    ContextClearCookiesParams,
    ContextVoidResult,
    PageRef,
)
from stagehand.browser_context import BrowserContext
from stagehand.rpc_client import RPCClient

from ._support import RecordingRPCClient


@pytest.mark.asyncio
async def test_browser_context_wraps_generated_page_references() -> None:
    recording = RecordingRPCClient({
        "context.pages": [PageRef(page_id="page-1")],
        "context.new_page": PageRef(page_id="page-2"),
        "context.active_page": PageRef(page_id="page-2"),
        "context.set_active_page": ContextVoidResult(ok=True),
    })
    context = BrowserContext(cast(RPCClient, recording))

    pages = await context.pages()
    new_page = await context.new_page(url="https://example.com")
    active_page = await context.active_page()
    await context.set_active_page(new_page)

    assert [page.page_id for page in pages] == ["page-1"]
    assert new_page.page_id == "page-2"
    assert active_page is not None and active_page.page_id == "page-2"
    assert [call[0] for call in recording.calls] == [
        "context.pages",
        "context.new_page",
        "context.active_page",
        "context.set_active_page",
    ]
    assert recording.calls[1][1].model_dump(exclude_unset=True) == {"url": "https://example.com"}


def test_browser_context_reuses_one_clipboard_wrapper() -> None:
    context = BrowserContext(cast(RPCClient, RecordingRPCClient()))

    assert context.clipboard is context.clipboard


@pytest.mark.asyncio
async def test_browser_context_serializes_python_cookie_filters() -> None:
    recording = RecordingRPCClient({"context.clear_cookies": ContextVoidResult(ok=True)})
    context = BrowserContext(cast(RPCClient, recording))

    await context.clear_cookies(
        name=re.compile("^session$", re.IGNORECASE),
        domain="example.com",
    )

    assert recording.calls[0][1] == ContextClearCookiesParams.model_validate({
        "options": {
            "name": {"source": "^session$", "flags": "i"},
            "domain": "example.com",
        }
    })
