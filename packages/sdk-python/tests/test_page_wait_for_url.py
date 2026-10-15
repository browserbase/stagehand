from typing import Literal, cast

import pytest
from pydantic import ValidationError

from stagehand import Page, rpc_client
from stagehand._generated.models import (
    PageRef,
    PageVoidResult,
    PageWaitForURLOptions,
    PageWaitForURLParams,
)
from stagehand.rpc_client import RPCClient

from ._support import RecordingRPCClient


@pytest.mark.parametrize(
    ("wait_until", "timeout", "expected_options"),
    [
        (None, None, None),
        ("load", None, {"wait_until": "load"}),
        ("domcontentloaded", 5_000, {"wait_until": "domcontentloaded", "timeout": 5_000}),
        (None, 0, {"timeout": 0}),
    ],
)
@pytest.mark.asyncio
async def test_wait_for_url_serializes_options_and_returns_none(
    wait_until: Literal["load", "domcontentloaded"] | None,
    timeout: int | None,
    expected_options: dict[str, object] | None,
) -> None:
    recording = RecordingRPCClient({"page.wait_for_url": PageVoidResult(ok=True)})
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    result = await page.wait_for_url("**/complete", wait_until=wait_until, timeout=timeout)

    assert result is None
    assert len(recording.calls) == 1
    method, params, result_model = recording.calls[0]
    assert method == "page.wait_for_url"
    assert isinstance(params, PageWaitForURLParams)
    expected: dict[str, object] = {"page_id": "page-1", "url": "**/complete"}
    if expected_options is not None:
        expected["options"] = expected_options
    assert params.model_dump(mode="json", by_alias=True, exclude_none=True) == expected
    assert result_model is PageVoidResult


@pytest.mark.asyncio
async def test_wait_for_url_propagates_runtime_errors() -> None:
    error = RuntimeError("waitForURL: page closed")
    recording = RecordingRPCClient({"page.wait_for_url": error})
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    with pytest.raises(RuntimeError) as caught:
        await page.wait_for_url("https://example.com/complete")

    assert caught.value is error


@pytest.mark.parametrize("timeout", [-1, 1.5, True])
@pytest.mark.asyncio
async def test_wait_for_url_rejects_invalid_timeout_before_rpc(timeout: object) -> None:
    recording = RecordingRPCClient()
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    with pytest.raises(ValidationError):
        await page.wait_for_url("**/complete", timeout=cast(int, timeout))

    assert not recording.calls


@pytest.mark.asyncio
async def test_wait_for_url_rejects_unsupported_load_state_before_rpc() -> None:
    recording = RecordingRPCClient()
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    with pytest.raises(ValidationError):
        await page.wait_for_url("**/complete", wait_until=cast(Literal["load"], "networkidle"))

    assert not recording.calls


@pytest.mark.parametrize("timeout,expected", [(None, 40), (250, 10.25), (45_000, 55), (0, None)])
def test_wait_for_url_response_deadline_honors_options(
    timeout: int | None, expected: float | None
) -> None:
    params = PageWaitForURLParams(page_id="page-1", url="**/complete")
    if timeout is not None:
        params.options = PageWaitForURLOptions(timeout=timeout)

    assert rpc_client._rpc_response_timeout_seconds("page.wait_for_url", params) == expected
