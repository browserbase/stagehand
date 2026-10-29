from __future__ import annotations

import asyncio
import base64
import copy
import errno
import hashlib
import json
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

import pytest
from stagehand import Stagehand

from stagehand_middleware.facade import (
    DEFAULT_ARTIFACT_DIRECTORY,
    StagehandFacadeBundleError,
    contract_error,
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
    assert bundle["version"] == 7
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
        host._write_artifacts([{"path": "shot.png", "base64": _PNG}])
    assert list(tmp_path.iterdir()) == []


_PNG = "iVBORw0KGgo="
_JPEG = "/9j/4AAQ"


def test_a_hard_linked_artifact_is_replaced_not_written_through(tmp_path: Path) -> None:
    root = tmp_path / "artifacts"
    root.mkdir()
    outside = tmp_path / "existing.png"
    outside.write_bytes(b"preserve")
    os.link(outside, root / "shot.png")
    _host(artifact_root=root)._write_artifacts([{"path": "shot.png", "base64": _PNG}])
    assert (root / "shot.png").read_bytes() == base64.b64decode(_PNG)
    assert outside.read_bytes() == b"preserve"
    assert outside.stat().st_nlink == 1
    assert sorted(p.name for p in root.iterdir()) == ["shot.png"]


@pytest.mark.parametrize(
    ("path", "data", "error"),
    [
        (".git/config", _PNG, "SCREENSHOT_ARTIFACT_TYPE_ERROR"),
        ("x.test.js", _PNG, "SCREENSHOT_ARTIFACT_TYPE_ERROR"),
        ("shots/evil.png", "dGVzdA==", "SCREENSHOT_ARTIFACT_CONTENT_ERROR"),
        ("x.png\0.js", _PNG, "SCREENSHOT_ARTIFACT_PATH_ERROR"),
    ],
    ids=["git-config", "script", "not-an-image", "nul"],
)
def test_only_image_artifacts_are_written(tmp_path: Path, path: str, data: str, error: str) -> None:
    host = _host(artifact_root=tmp_path)
    with pytest.raises(tools.StagehandFacadeInputError) as raised:
        host._write_artifacts([{"path": path, "base64": data}])
    assert str(raised.value) == contract_error(error)
    assert list(tmp_path.iterdir()) == []


def test_jpeg_bytes_under_an_upper_case_extension_are_written(tmp_path: Path) -> None:
    _host(artifact_root=tmp_path)._write_artifacts([{"path": "SHOT.JPG", "base64": _JPEG}])
    assert (tmp_path / "SHOT.JPG").read_bytes() == base64.b64decode(_JPEG)


def test_a_directory_at_the_artifact_path_is_rejected(tmp_path: Path) -> None:
    (tmp_path / "dir.png").mkdir()
    with pytest.raises(tools.StagehandFacadeInputError) as raised:
        _host(artifact_root=tmp_path)._write_artifacts([{"path": "dir.png", "base64": _PNG}])
    assert str(raised.value) == contract_error("SCREENSHOT_ARTIFACT_NOT_FILE_ERROR")


def test_a_failed_replace_is_reported_by_its_code_and_leaves_no_temporary_file(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def fail(_source: str, target: str) -> None:
        raise PermissionError(errno.EACCES, "Permission denied", target)

    monkeypatch.setattr(tools.os, "replace", fail)
    with pytest.raises(tools.StagehandFacadeInputError) as raised:
        _host(artifact_root=tmp_path)._write_artifacts([{"path": "shot.png", "base64": _PNG}])
    assert str(raised.value) == contract_error("SCREENSHOT_ARTIFACT_WRITE_ERROR", cause="EACCES")
    assert list(tmp_path.iterdir()) == []


def test_a_replaced_artifact_keeps_its_permissions_and_a_new_one_is_owner_only(
    tmp_path: Path,
) -> None:
    (tmp_path / "shot.png").write_bytes(b"old")
    (tmp_path / "shot.png").chmod(0o644)
    _host(artifact_root=tmp_path)._write_artifacts([
        {"path": "shot.png", "base64": _PNG},
        {"path": "new.png", "base64": _PNG},
    ])
    assert (tmp_path / "shot.png").read_bytes() == base64.b64decode(_PNG)
    assert (tmp_path / "shot.png").stat().st_mode & 0o777 == 0o644
    assert (tmp_path / "new.png").stat().st_mode & 0o777 == 0o600


def test_a_colon_in_an_artifact_name_is_kept(tmp_path: Path) -> None:
    name = "shot-2026-10-29T22:57:48.609Z.png"
    _host(artifact_root=tmp_path)._write_artifacts([{"path": name, "base64": _PNG}])
    assert [p.name for p in tmp_path.iterdir()] == [name]


def test_a_file_on_the_way_to_an_artifact_is_rejected(tmp_path: Path) -> None:
    (tmp_path / "a").write_bytes(b"keep")
    with pytest.raises(tools.StagehandFacadeInputError) as raised:
        _host(artifact_root=tmp_path)._write_artifacts([{"path": "a/x.png", "base64": _PNG}])
    assert str(raised.value) == contract_error("SCREENSHOT_ARTIFACT_NOT_DIRECTORY_ERROR")
    assert (tmp_path / "a").read_bytes() == b"keep"


def test_an_overlong_component_is_rejected_before_any_directory_is_created(
    tmp_path: Path,
) -> None:
    path = f"{'d' * 200}/{'d' * 256}/x.png"
    with pytest.raises(tools.StagehandFacadeInputError) as raised:
        _host(artifact_root=tmp_path)._write_artifacts([{"path": path, "base64": _PNG}])
    assert str(raised.value) == contract_error(
        "SCREENSHOT_ARTIFACT_WRITE_ERROR", cause="ENAMETOOLONG"
    )
    assert list(tmp_path.iterdir()) == []


def test_artifacts_default_to_a_directory_under_the_working_directory(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.chdir(tmp_path)
    _host()._write_artifacts([{"path": "shots/first.png", "base64": _PNG}])
    assert [p.name for p in tmp_path.iterdir()] == [DEFAULT_ARTIFACT_DIRECTORY]
    written = tmp_path / DEFAULT_ARTIFACT_DIRECTORY / "shots" / "first.png"
    assert written.read_bytes() == base64.b64decode(_PNG)


def test_a_symlinked_default_artifact_directory_is_refused_but_a_configured_one_is_followed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.chdir(tmp_path)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    linked = tmp_path / DEFAULT_ARTIFACT_DIRECTORY
    linked.symlink_to(elsewhere)
    with pytest.raises(tools.StagehandFacadeInputError) as raised:
        _host()._write_artifacts([{"path": "x.png", "base64": _PNG}])
    assert str(raised.value) == contract_error("SCREENSHOT_ARTIFACT_SYMLINK_ERROR")
    assert list(elsewhere.iterdir()) == []
    _host(artifact_root=linked)._write_artifacts([{"path": "x.png", "base64": _PNG}])
    assert [p.name for p in elsewhere.iterdir()] == ["x.png"]


def test_the_default_artifact_directory_matches_the_bundle() -> None:
    assert DEFAULT_ARTIFACT_DIRECTORY == facade_bundle()["contract"]["defaultArtifactDirectory"]


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
