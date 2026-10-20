from __future__ import annotations

import asyncio
import hashlib
import json

import pytest

from stagehand_integrations.facade import facade_bundle, facade_tools, tools
from stagehand_integrations.facade._syntax import check_run_syntax


def test_bundle_content_matches_its_hash() -> None:
    bundle = facade_bundle()
    # canonicalJson in src/facade/bundle.ts: sorted keys, no whitespace, non-ASCII unescaped.
    canonical = json.dumps(
        {"sources": bundle["sources"], "contract": bundle["contract"]},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    assert bundle["version"] == 3
    assert hashlib.sha256(canonical.encode()).hexdigest() == bundle["sha256"]


def test_facade_tools_are_the_bundle_tool_sets() -> None:
    assert [tool["name"] for tool in facade_tools()] == ["run", "snapshot", "screenshot"]
    for tool_set in ("playwright", "legacy", "explicitSnapshotActions"):
        assert facade_tools(tool_set) == facade_bundle()["contract"]["tools"][tool_set]
    facade_tools()[0]["name"] = "changed"
    assert facade_tools()[0]["name"] == "run"


@pytest.mark.parametrize(
    "code",
    [
        "await page.goto('https://example.com'); return await page.title();",
        "return a?.b ?? `}${'}'}`;",
        "class A { #p = 1; static {} } return /}/v.test('}');",
        "return 1 // trailing comment",
        "x = a\n--> an HTML-like comment at the start of a line",
    ],
)
def test_run_code_that_is_a_function_body_passes(code: str) -> None:
    check_run_syntax(code)


@pytest.mark.parametrize(
    "code",
    [
        "return 1; }",
        "})(); } catch {} }, globalThis.escaped = 1, async function y() { try { (async () => {",
        "/*",
        "x = 1 }, globalThis.escaped = 1, async function y() {",
        # Read differently by V8, so they could hide where the code ends.
        "return <div/>;",
        "x = a <!--b, (() => {\n})",
        "x = 1 /*\n*/ --> (function () {\n})",
    ],
)
def test_run_code_that_is_not_a_function_body_fails(code: str) -> None:
    with pytest.raises(SyntaxError):
        check_run_syntax(code)


async def test_a_capture_past_its_deadline_fails_with_the_typescript_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(tools, "PAGE_CAPTURE_DEADLINE_S", 0.01)
    with pytest.raises(TimeoutError, match=r"^page\.snapshot received no response within 10ms$"):
        await tools._with_deadline(asyncio.sleep(1), "page.snapshot")
