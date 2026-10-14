from typing import Literal, cast

import pytest
from pydantic import ValidationError

from stagehand import LoadState, Page
from stagehand._generated.models import PageRef, PageSetContentParams, PageVoidResult
from stagehand.rpc_client import RPCClient, _rpc_response_timeout_seconds

from ._support import RecordingRPCClient


@pytest.mark.asyncio
async def test_set_content_serializes_html_and_options_with_generated_models() -> None:
    recording = RecordingRPCClient({"page.set_content": PageVoidResult(ok=True)})
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))
    html = '<!doctype html><html><body title="é">Hello</body></html>'

    assert await page.set_content(html, wait_until=LoadState.domcontentloaded, timeout=0) is None

    method, params, result_model = recording.calls[0]
    assert method == "page.set_content"
    assert isinstance(params, PageSetContentParams)
    assert params.model_dump(mode="json", exclude_unset=True) == {
        "page_id": "page-1",
        "html": html,
        "options": {"wait_until": "domcontentloaded", "timeout": 0},
    }
    assert result_model is PageVoidResult
    assert page.page_id == "page-1"


@pytest.mark.asyncio
async def test_set_content_omits_default_options_and_accepts_empty_html() -> None:
    recording = RecordingRPCClient({"page.set_content": PageVoidResult(ok=True)})
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    await page.set_content("")

    assert recording.calls[0][1].model_dump(mode="json", exclude_unset=True) == {
        "page_id": "page-1",
        "html": "",
    }


@pytest.mark.parametrize("wait_until", ["load", "domcontentloaded", "networkidle"])
@pytest.mark.asyncio
async def test_set_content_accepts_load_state_strings(
    wait_until: Literal["load", "domcontentloaded", "networkidle"],
) -> None:
    recording = RecordingRPCClient({"page.set_content": PageVoidResult(ok=True)})
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    await page.set_content("<p>Hello</p>", wait_until=wait_until)

    params = recording.calls[0][1]
    assert params.model_dump(mode="json", exclude_unset=True)["options"] == {
        "wait_until": wait_until,
    }


@pytest.mark.parametrize("timeout", [-1, float("nan"), float("inf"), 2_147_473_648])
@pytest.mark.asyncio
async def test_set_content_rejects_invalid_timeout_before_rpc(timeout: float) -> None:
    recording = RecordingRPCClient()
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    with pytest.raises(ValidationError):
        await page.set_content("<p>Hello</p>", timeout=timeout)

    assert recording.calls == []


@pytest.mark.asyncio
async def test_set_content_preserves_rpc_errors() -> None:
    error = RuntimeError("page closed")
    recording = RecordingRPCClient({"page.set_content": error})
    page = Page(cast(RPCClient, recording), PageRef(page_id="page-1"))

    with pytest.raises(RuntimeError) as raised:
        await page.set_content("<p>Hello</p>")

    assert raised.value is error


@pytest.mark.parametrize(
    ("timeout", "expected"),
    [(None, 40), (250.5, 10.2505), (45_000, 55), (0, None)],
)
def test_set_content_response_deadline(timeout: float | None, expected: float | None) -> None:
    params = PageSetContentParams.model_validate({
        "page_id": "page-1",
        "html": "<p>Hello</p>",
        **({"options": {"timeout": timeout}} if timeout is not None else {}),
    })

    assert _rpc_response_timeout_seconds("page.set_content", params) == expected
