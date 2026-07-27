from __future__ import annotations

from typing import cast

import pytest

from stagehand._generated.models import (
    AcknowledgementResult,
    ContextClipboardReadTextResult,
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
        "context.clipboard_write_text": AcknowledgementResult(root=True),
    })
    rpc_client = cast(RPCClient, recording)
    clipboard = BrowserClipboard(rpc_client)
    page = Page(rpc_client, PageRef(page_id="page-1"))

    text = await clipboard.read_text(page=page)
    await clipboard.write_text("updated")

    assert text == "hello"
    assert recording.calls[0][1].model_dump(exclude_unset=True) == {"page_id": "page-1"}
    assert recording.calls[1][1].model_dump(exclude_unset=True) == {"text": "updated"}


@pytest.mark.asyncio
async def test_browser_clipboard_side_effects_use_acknowledgement_results() -> None:
    methods = [
        "context.clipboard_clear",
        "context.clipboard_paste",
        "context.clipboard_copy",
        "context.clipboard_cut",
    ]
    recording = RecordingRPCClient({method: AcknowledgementResult(root=True) for method in methods})
    clipboard = BrowserClipboard(cast(RPCClient, recording))

    await clipboard.clear()
    await clipboard.paste()
    await clipboard.copy()
    await clipboard.cut()

    assert [(method, result_model) for method, _, result_model in recording.calls] == [
        (method, AcknowledgementResult) for method in methods
    ]
