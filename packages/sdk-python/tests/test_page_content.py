from __future__ import annotations

from typing import cast

import pytest

from stagehand._generated.models import PageContentResult, PageIdParams, PageRef
from stagehand.page import Page
from stagehand.rpc_client import RPCClient

from ._support import RecordingRPCClient


@pytest.mark.parametrize("content", ["<!DOCTYPE html><html><body>Example</body></html>", ""])
@pytest.mark.asyncio
async def test_page_content_returns_a_scalar_string(content: str) -> None:
    recording = RecordingRPCClient({"page.content": content})
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    assert await page.content() == content
    assert recording.calls == [
        ("page.content", PageIdParams(page_id="page-1"), PageContentResult),
    ]
