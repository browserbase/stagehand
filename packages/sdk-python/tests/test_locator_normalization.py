import json
from copy import deepcopy
from pathlib import Path
from typing import Any, cast

import pytest

from stagehand import LocatorInput, Page
from stagehand._generated.models import PageRef
from stagehand.locator_selector import normalize_locator_selector
from stagehand.rpc_client import RPCClient

from ._support import RecordingRPCClient

CASES = json.loads(
    (Path(__file__).parents[3] / "tests/fixtures/locator-normalization.json").read_text()
)


@pytest.mark.parametrize("case", CASES)
def test_locator_normalization_matches_shared_contract(case: dict[str, Any]) -> None:
    value = cast(LocatorInput, case["input"])
    expected = case["chain"]
    assert normalize_locator_selector(value).model_dump(exclude_unset=True) == expected
    if isinstance(value, str):
        assert (
            normalize_locator_selector({"type": "legacy", "value": value}).model_dump(
                exclude_unset=True
            )
            == expected
        )
    page = Page(cast(RPCClient, RecordingRPCClient()), PageRef(page_id="page-1"))
    locator = page.locator(value)
    indexed = locator.nth(2)
    assert indexed.selector == (value if isinstance(value, str) else value["value"])
    indexed_chain = deepcopy(expected)
    indexed_chain["steps"][-1]["nth"] = 2
    assert indexed.descriptor.model_dump(exclude_unset=True) == {
        "page_id": "page-1",
        "selector": indexed_chain,
    }
    assert locator.descriptor.selector.model_dump(exclude_unset=True) == expected
