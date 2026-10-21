"""The Python host against a real local Chrome, end to end.

Opt-in: set STAGEHAND_INTEGRATIONS_BROWSER_TESTS=1 (and CHROME_PATH when Chrome is
not where the Stagehand SDK looks for it). The other tests use a fake Stagehand.
"""

from __future__ import annotations

import base64
import contextlib
import os
import re
from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import quote

import pytest
from stagehand import Stagehand, local_browser

from stagehand_integrations.facade import (
    StagehandFacadeInputError,
    StagehandFacadeTools,
    contract_error,
)

pytestmark = pytest.mark.skipif(
    os.environ.get("STAGEHAND_INTEGRATIONS_BROWSER_TESTS") != "1",
    reason="set STAGEHAND_INTEGRATIONS_BROWSER_TESTS=1 to run against a local Chrome",
)

PAGE_URL = "data:text/html," + quote(
    "<!doctype html><title>Facade smoke</title>"
    "<label for=name>Name</label><input id=name>"
    "<button onclick=\"document.querySelector('#count').textContent++\">Increment</button>"
    "<output id=count>0</output>"
)
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


@pytest.fixture
async def stagehand() -> AsyncIterator[Stagehand]:
    browser = await local_browser.launch(
        headless=True, executable_path=os.environ.get("CHROME_PATH")
    )
    try:
        instance = await Stagehand.create(browser=browser)
        try:
            yield instance
        finally:
            # The test closes both through run code; closing again is a no-op or fails.
            with contextlib.suppress(Exception):
                await instance.close()
    finally:
        with contextlib.suppress(Exception):
            await browser.close()


def snapshot_id(tree: str, role: str, name: str) -> str:
    match = re.search(rf"\[([^\]]+)\] {role}: {name}", tree)
    assert match, f"no {role} {name!r} in snapshot:\n{tree}"
    found: str = match[1]
    return found


async def test_tools_drive_a_local_chrome(stagehand: Stagehand, tmp_path: Path) -> None:
    artifacts = tmp_path / "artifacts"
    tools = StagehandFacadeTools(stagehand, artifact_root=artifacts)

    title = await tools.run(
        code=f"await page.goto({PAGE_URL!r}, {{ waitUntil: 'domcontentloaded' }});\n"
        "return await page.title();"
    )
    assert title == "Facade smoke"

    tree = await tools.snapshot()
    actions = [
        {"op": "fill", "id": snapshot_id(tree, "textbox", "Name"), "value": "Ada"},
        {"op": "click", "id": snapshot_id(tree, "button", "Increment")},
    ]
    assert await tools.run(actions=actions) == {"completed": 2, "url": PAGE_URL}

    state = await tools.run(
        code="return { name: await page.locator('#name').inputValue(),"
        " count: await page.locator('#count').textContent() };"
    )
    assert state == {"name": "Ada", "count": "1"}

    saved = await tools.run(
        code="await page.screenshot({ path: 'shots/page.png' }); return 'saved';"
    )
    assert saved == "saved"
    assert (artifacts / "shots" / "page.png").read_bytes().startswith(PNG_MAGIC)

    image = await tools.screenshot()
    assert image["mimeType"] == "image/png"
    assert base64.b64decode(image["data"]).startswith(PNG_MAGIC)

    # The default cleanup closes the Stagehand and its browser once the call ends.
    assert await tools.run(code="await browser.close(); return 'closing';") == "closing"
    with pytest.raises(StagehandFacadeInputError) as error:
        await tools.snapshot()
    assert str(error.value) == contract_error("FACADE_BROWSER_CLOSED_ERROR")
