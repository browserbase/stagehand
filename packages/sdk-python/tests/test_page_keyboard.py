from __future__ import annotations

from typing import cast

import pytest

from stagehand._generated.models import (
    PageKeyDownParams,
    PageKeyUpParams,
    PageRef,
    PageVoidResult,
)
from stagehand.page import Page
from stagehand.rpc_client import RPCClient

from ._support import RecordingRPCClient


@pytest.mark.asyncio
async def test_key_down_and_up_forward_the_page_and_key() -> None:
    recording = RecordingRPCClient({
        "page.key_down": PageVoidResult(ok=True),
        "page.key_up": PageVoidResult(ok=True),
    })
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    assert await page.key_down("Shift") is None
    assert await page.key_up("Shift") is None

    assert recording.calls == [
        (
            "page.key_down",
            PageKeyDownParams(page_id="page-1", key="Shift"),
            PageVoidResult,
        ),
        (
            "page.key_up",
            PageKeyUpParams(page_id="page-1", key="Shift"),
            PageVoidResult,
        ),
    ]


@pytest.mark.asyncio
async def test_key_down_and_up_preserve_rpc_failures() -> None:
    error = RuntimeError("Page was closed")
    recording = RecordingRPCClient({"page.key_down": error, "page.key_up": error})
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    with pytest.raises(RuntimeError, match="Page was closed"):
        await page.key_down("Shift")
    with pytest.raises(RuntimeError, match="Page was closed"):
        await page.key_up("Shift")
