from __future__ import annotations

import asyncio
import copy
import hashlib
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

import pytest
from stagehand import Stagehand

from stagehand_middleware.facade import (
    StagehandFacadeBundleError,
    facade_bundle,
    facade_instructions,
    facade_tools,
    tools,
)
from stagehand_middleware.facade._syntax import check_run_syntax
from stagehand_middleware.facade.bundle import canonical_json, parse_bundle


def test_bundle_content_matches_its_hash() -> None:
    bundle = facade_bundle()
    canonical = canonical_json({"sources": bundle["sources"], "contract": bundle["contract"]})
    assert bundle["version"] == 6
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


def test_facade_bundle_returns_a_copy_the_host_does_not_use() -> None:
    bundle = facade_bundle()
    bundle["contract"]["limits"]["maxArtifacts"] = 10_000
    bundle["sources"]["runPrelude"] = "tampered"
    assert facade_bundle()["contract"]["limits"]["maxArtifacts"] == 32
    assert facade_bundle()["sources"]["runPrelude"] != "tampered"


def _host(**options: Any) -> tools.StagehandFacadeTools:  # noqa: ANN401 - host options
    return tools.StagehandFacadeTools(cast(Stagehand, object()), **options)


def test_artifacts_fail_closed_without_o_nofollow(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delattr(tools.os, "O_NOFOLLOW", raising=False)
    host = _host(artifact_root=tmp_path)
    with pytest.raises(tools.StagehandFacadeInputError, match="no O_NOFOLLOW"):
        host._write_artifacts([{"path": "shot.png", "base64": "AA=="}])
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("\ud800", len('"\\ud800"')),  # a lone surrogate is a six-byte escape, as in JS
        (chr(0xD83D) + chr(0xDE00), len('""') + 4),  # a pair as two code units is one character
        ("\U0001f600", len('""') + 4),
        ("é", len('""') + 2),
        ({"a": [1, None]}, len('{"a":[1,null]}')),
    ],
    ids=["lone-surrogate", "split-pair", "astral", "latin", "object"],
)
def test_value_size_counts_bytes_like_json_stringify(value: object, expected: int) -> None:
    assert tools._json_value_bytes(value) == expected


async def test_a_failed_close_callback_is_not_chained() -> None:
    async def failing_close() -> None:
        raise RuntimeError("provider said: secret-token")

    host = _host(on_close_requested=failing_close)
    with pytest.raises(tools.StagehandFacadeCleanupError) as raised:
        await host._close_now()
    assert raised.value.__cause__ is None
    assert raised.value.__suppress_context__


def test_run_options_default_off() -> None:
    assert facade_bundle()["contract"]["runOptions"] == {
        "quietWait": {"default": False, "windowMs": 400, "pollMs": 100}
    }


class _RetryingStagehand:
    """Fails the first run batch as if its page had gone, then answers; records inputs."""

    def __init__(self) -> None:
        page = _Page()
        self.inputs: list[object] = []
        self.browser = type("Browser", (), {"context": _Context(page)})()

    async def experimental_batch(
        self, source: str, input: object, *, timeout: int, page: object
    ) -> object:
        self.inputs.append(input)
        if len(self.inputs) == 1:
            raise RuntimeError("callback batch page was not found")
        return {
            "__stagehandPlaywrightCompat": True,
            "value": 1,
            "telemetry": {"calls": {}, "misses": {}},
            "artifacts": [],
            "closeRequested": False,
            "batchRuntimeMs": 1,
        }


class _Page:
    page_id = "page-1"


class _Context:
    def __init__(self, page: _Page) -> None:
        self._page = page

    async def active_page(self) -> _Page:
        return self._page


@pytest.mark.parametrize(
    ("quiet_wait", "expected"),
    [(None, {}), (False, {}), (True, {"quietWait": True})],
)
async def test_quiet_wait_goes_into_every_run_input(
    quiet_wait: bool | None, expected: dict[str, object]
) -> None:
    stagehand = _RetryingStagehand()
    host = tools.StagehandFacadeTools(cast("Stagehand", stagehand), quiet_wait=quiet_wait)
    assert await host.run(code="return 1;") == 1
    assert stagehand.inputs == [expected, expected]
