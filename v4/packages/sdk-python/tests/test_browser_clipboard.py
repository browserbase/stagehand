from __future__ import annotations

from typing import cast

import pytest

from stagehand._generated.models import (
    ContextClipboardReadTextResult,
    ContextVoidResult,
    PageRef,
)
from stagehand.browser_clipboard import BrowserClipboard
from stagehand.page import Page
from stagehand.rpc_client import RPCClient

from ._support import RecordingRPCClient


@pytest.mark.asyncio
async def test_browser_clipboard_uses_the_optional_page_as_its_wire_target() -> None:
    recording = RecordingRPCClient({
        "context.clipboard_read_text": ContextClipboardReadTextResult(text="hello"),
        "context.clipboard_write_text": ContextVoidResult(ok=True),
    })
    rpc_client = cast(RPCClient, recording)
    clipboard = BrowserClipboard(rpc_client)
    page = Page(rpc_client, PageRef(page_id="page-1"))

    text = await clipboard.read_text(page=page)
    await clipboard.write_text("updated")

    assert text == "hello"
    assert recording.calls[0][1].model_dump(exclude_unset=True) == {"page_id": "page-1"}
    assert recording.calls[1][1].model_dump(exclude_unset=True) == {"text": "updated"}
