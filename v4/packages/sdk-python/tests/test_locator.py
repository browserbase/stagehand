from __future__ import annotations

from typing import cast

import pytest

from stagehand._generated.models import (
    LocatorClickParams,
    LocatorClickResult,
    LocatorCountResult,
    LocatorDescriptor,
    LocatorSelectOptionResult,
)
from stagehand.locator import Locator
from stagehand.rpc_client import RPCClient

from ._support import RecordingRPCClient


@pytest.mark.asyncio
async def test_locator_methods_use_generated_models_and_keep_the_descriptor_internal() -> None:
    recording = RecordingRPCClient({
        "locator.click": LocatorClickResult(clicked=True),
        "locator.count": LocatorCountResult(count=2),
        "locator.select_option": LocatorSelectOptionResult(values=["one"]),
    })
    locator = Locator(
        cast(RPCClient, recording),
        page_id="page-1",
        selector="select",
    ).nth(1)

    await locator.click(button="left", click_count=2)
    count = await locator.count()
    selected = await locator.select_option("one")

    assert count == 2
    assert selected == ["one"]
    method, params, result_model = recording.calls[0]
    assert method == "locator.click"
    assert params == LocatorClickParams.model_validate({
        "page_id": "page-1",
        "selector": "select",
        "nth": 1,
        "options": {"button": "left", "click_count": 2},
    })
    assert result_model is LocatorClickResult
    assert recording.calls[1] == (
        "locator.count",
        LocatorDescriptor(page_id="page-1", selector="select", nth=1),
        LocatorCountResult,
    )


def test_locator_first_and_nth_validate_the_generated_descriptor() -> None:
    recording = RecordingRPCClient()
    locator = Locator(cast(RPCClient, recording), page_id="page-1", selector="button")

    assert locator.first().nth_index == 0
    assert locator.nth(3).nth_index == 3

    with pytest.raises(ValueError):
        locator.nth(-1)
