from __future__ import annotations

import asyncio
import copy
import hashlib
import json
from collections.abc import Callable
from typing import Any

import pytest

from stagehand_integrations.facade import (
    StagehandFacadeBundleError,
    facade_bundle,
    facade_instructions,
    facade_tools,
    tools,
)
from stagehand_integrations.facade._syntax import check_run_syntax
from stagehand_integrations.facade.bundle import canonical_json, parse_bundle


def test_bundle_content_matches_its_hash() -> None:
    bundle = facade_bundle()
    canonical = canonical_json({"sources": bundle["sources"], "contract": bundle["contract"]})
    assert bundle["version"] == 4
    assert hashlib.sha256(canonical.encode()).hexdigest() == bundle["sha256"]


def test_canonical_json_matches_the_typescript_canonicalization() -> None:
    # Sorted keys at every level, no whitespace, non-ASCII unescaped, control
    # characters escaped as JSON.stringify does.
    value = {"b": [1, {"d": "\u2014\n\u0001", "c": None}], "a": True}
    assert canonical_json(value) == '{"a":true,"b":[1,{"c":null,"d":"\u2014\\n\\u0001"}]}'


@pytest.mark.parametrize(
    "tamper",
    [
        lambda bundle: bundle["sources"].update(actionRunner="async () => {}"),
        lambda bundle: bundle["contract"]["errors"].update(
            NO_HYDRATED_SNAPSHOT_ERROR="Something else."
        ),
        lambda bundle: bundle.update(sha256="0" * 64),
    ],
    ids=["source", "contract", "hash"],
)
def test_a_bundle_whose_content_does_not_match_its_hash_fails_to_load(
    tamper: Callable[[dict[str, Any]], None],
) -> None:
    bundle = copy.deepcopy(facade_bundle())
    assert parse_bundle(json.dumps(bundle)) == bundle
    tamper(bundle)
    with pytest.raises(StagehandFacadeBundleError, match=r"does not match its sha256"):
        parse_bundle(json.dumps(bundle))


def test_facade_instructions_are_the_bundle_instructions() -> None:
    instructions = facade_bundle()["contract"]["instructions"]
    assert facade_instructions() == instructions["playwright"]
    for tool_set in ("playwright", "legacy", "explicitSnapshotActions"):
        assert facade_instructions(tool_set) == instructions[tool_set]
    assert facade_instructions().startswith("Browser tool surface: Stagehand Playwright facade.")
    assert facade_instructions("explicitSnapshotActions").startswith(
        facade_instructions() + "\n\nWorkflow: "
    )


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
