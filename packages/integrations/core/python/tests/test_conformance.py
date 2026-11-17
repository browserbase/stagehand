"""Runs the language-neutral cases in ../../conformance against the Python host.

See ../../conformance/README.md for the case format.
"""

from __future__ import annotations

import base64
import json
import os
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

import pytest
from stagehand import Stagehand
from stagehand.rpc_client import RPCError, _JSONRPCError

from stagehand_middleware.facade import (
    StagehandFacadeExecutionError,
    StagehandFacadeInputError,
    StagehandFacadeTools,
    contract_error,
    facade_bundle,
)

CASES_DIR = Path(__file__).resolve().parents[2] / "conformance" / "cases"
SOURCES = facade_bundle()["sources"]


def load_cases() -> list[Any]:
    params = []
    for file in sorted(CASES_DIR.glob("*.json")):
        for case in json.loads(file.read_text(encoding="utf-8"))["cases"]:
            not_applicable = case.get("notApplicable", {})
            reason = not_applicable.get("python") or (
                not_applicable.get("windows") if sys.platform == "win32" else None
            )
            marks = [pytest.mark.skip(reason=reason)] if reason else []
            params.append(pytest.param(case, id=f"{file.name}: {case['name']}", marks=marks))
    return params


def expand(value: Any, sandbox: Path) -> Any:  # noqa: ANN401 - any JSON value
    """Expands the `$repeat` and `$sandbox` generators the case format allows."""
    if isinstance(value, list):
        return [expand(entry, sandbox) for entry in value]
    if not isinstance(value, dict):
        return value
    if isinstance(value.get("$repeat"), str):
        return value["$repeat"] * value["count"] + value.get("suffix", "")
    if isinstance(value.get("$sandbox"), str):
        return str(sandbox / value["$sandbox"])
    return {key: expand(entry, sandbox) for key, entry in value.items()}


def describe_sent_call(source: str, input: object) -> object:
    if source == SOURCES["actionRunner"]:
        return {"callback": "actionRunner", "input": input}
    if source.startswith(SOURCES["runPrelude"]) and source.endswith(SOURCES["runEpilogue"]):
        code = source[len(SOURCES["runPrelude"]) : len(source) - len(SOURCES["runEpilogue"])]
        if input:
            return {"callback": "run", "code": code, "input": input}
        return {"callback": "run", "code": code}
    return {"callback": "unknown", "source": source}


@dataclass
class FakeSnapshot:
    formatted_tree: str
    xpath_map: dict[str, str]


class FakePage:
    def __init__(
        self,
        stagehand: FakeStagehand,
        page_id: str = "page-1",
        snapshot: dict[str, Any] | None = None,
    ) -> None:
        self._stagehand = stagehand
        self.page_id = page_id
        self._snapshot = snapshot

    async def url(self) -> str:
        return self._stagehand.url

    async def snapshot(self, *, include_iframes: bool, timeout: float) -> FakeSnapshot:
        snapshot = self._snapshot or self._stagehand.snapshot
        if snapshot is None:
            return FakeSnapshot("", {})
        return FakeSnapshot(snapshot["formattedTree"], snapshot["xpathMap"])

    async def screenshot(self, *, type: str, full_page: bool | None, quality: int | None) -> bytes:
        # Recorded in the case format's { type, fullPage?, quality? } shape.
        self._stagehand.screenshot_options = {
            "type": type,
            **({"fullPage": full_page} if full_page is not None else {}),
            **({"quality": quality} if quality is not None else {}),
        }
        return base64.b64decode(self._stagehand.case.get("page", {}).get("screenshot", ""))


class FakeContext:
    def __init__(
        self, pages: list[FakePage], active: object, make_page: Callable[[str], FakePage]
    ) -> None:
        self._pages = pages
        self._active = active
        self._make_page = make_page
        self.calls: dict[str, Any] = {"newPages": 0, "setActivePage": []}

    async def active_page(self) -> FakePage | None:
        if self._active is None:
            return None
        if isinstance(self._active, dict):
            # The SDK surfaces extension errors as RPCError.
            raise RPCError(_JSONRPCError(code=-32000, message=self._active["throw"]["message"]))
        if self._active is _DEFAULT_ACTIVE:
            return self._pages[0]
        return next(page for page in self._pages if page.page_id == self._active)

    async def pages(self) -> list[FakePage]:
        return list(self._pages)

    async def new_page(self, url: str | None = None) -> FakePage:
        self.calls["newPages"] += 1
        page = self._make_page(f"new-page-{self.calls['newPages']}")
        self._pages.append(page)
        return page

    async def set_active_page(self, page: FakePage) -> None:
        self.calls["setActivePage"].append(page.page_id)


_DEFAULT_ACTIVE = object()


class FakeBrowser:
    def __init__(
        self, pages: list[FakePage], active: object, make_page: Callable[[str], FakePage]
    ) -> None:
        self.context = FakeContext(pages, active, make_page)
        self.close_count = 0

    async def close(self) -> None:
        self.close_count += 1


@dataclass
class FakeStagehand:
    """Duck-types the parts of `stagehand.Stagehand` the host uses."""

    case: dict[str, Any]
    sandbox: Path
    url: str = "about:blank"
    scripted: list[dict[str, Any]] = field(default_factory=list)
    sent: list[object] = field(default_factory=list)
    close_count: int = 0
    snapshot: dict[str, Any] | None = None
    screenshot_options: dict[str, Any] | None = None

    def __post_init__(self) -> None:
        self.url = self.case.get("page", {}).get("url", self.url)
        self.snapshot = self.case.get("page", {}).get("snapshot")
        context = self.case.get("context", {})
        # A case's "pages" list is used as given (even empty); without one there is one page.
        pages = (
            [FakePage(self, entry["id"], entry.get("snapshot")) for entry in context["pages"]]
            if "pages" in context
            else [FakePage(self)]
        )
        self.browser = FakeBrowser(
            pages,
            context.get("activePage", _DEFAULT_ACTIVE),
            lambda page_id: FakePage(self, page_id),
        )

    async def experimental_batch(
        self, source: str, input: object, *, timeout: int, page: FakePage
    ) -> object:
        self.sent.append(describe_sent_call(source, input))
        if not self.scripted:
            raise AssertionError("conformance: unscripted batch call")
        response = self.scripted.pop(0)
        if "throw" in response:
            error_type = type(response["throw"]["name"], (Exception,), {})
            raise error_type(response["throw"]["message"])
        return expand(response["return"], self.sandbox)

    async def close(self) -> None:
        self.close_count += 1


async def call_tool(tools: StagehandFacadeTools, call: dict[str, Any]) -> object:
    if call["tool"] == "run":
        if "code" in call:
            return await tools.run(code=call["code"])
        return await tools.run(actions=call["actions"])
    if call["tool"] == "snapshot":
        return await tools.snapshot(include_iframes=call.get("includeIframes", True))
    return await tools.screenshot(
        full_page=call.get("fullPage"), type=call.get("type", "png"), quality=call.get("quality")
    )


def check_error(error: BaseException, expected: dict[str, Any]) -> None:
    kind = expected["kind"]
    if kind in ("input", "invalid"):
        assert isinstance(error, StagehandFacadeInputError), repr(error)
    elif kind == "execution":
        assert isinstance(error, StagehandFacadeExecutionError), repr(error)
    elif kind == "sdk":
        # SDK errors reach the host as RPCError and must propagate unchanged.
        assert isinstance(error, RPCError), repr(error)
    elif kind == "batch":
        assert not isinstance(error, StagehandFacadeInputError | StagehandFacadeExecutionError)
    else:
        assert isinstance(error, SyntaxError), repr(error)
    if "name" in expected:
        assert getattr(error, "name", None) == expected["name"]
    if "contractError" in expected:
        assert str(error) == contract_error(expected["contractError"], **expected.get("params", {}))
    elif "message" in expected:
        assert str(error) == expected["message"]


def prepare_sandbox(case: dict[str, Any], sandbox: Path) -> None:
    (sandbox / "artifacts").mkdir()
    for entry in case.get("fs", []):
        if "dir" in entry:
            (sandbox / entry["dir"]).mkdir(parents=True, exist_ok=True)
        elif "file" in entry:
            (sandbox / entry["file"]).parent.mkdir(parents=True, exist_ok=True)
            (sandbox / entry["file"]).write_bytes(base64.b64decode(entry["base64"]))
        elif "hardlink" in entry:
            os.link(sandbox / entry["target"], sandbox / entry["hardlink"])
        else:
            os.symlink(entry["target"], sandbox / entry["symlink"])


def list_tree(sandbox: Path, relative: str = "") -> list[str]:
    """Every entry under the sandbox without following symlinks: `dir/`, `link@`, `file`."""
    entries: list[str] = []
    for name in os.listdir(sandbox / relative):
        entry = f"{relative}/{name}" if relative else name
        path = sandbox / entry
        if path.is_symlink():
            entries.append(f"{entry}@")
        elif path.is_dir():
            entries += [f"{entry}/", *list_tree(sandbox, entry)]
        else:
            entries.append(entry)
    # Sorted by UTF-16 code unit, as the TypeScript runner does.
    return sorted(entries, key=lambda entry: entry.encode("utf-16-be"))


@pytest.mark.parametrize("case", load_cases())
async def test_conformance(case: dict[str, Any], tmp_path: Path) -> None:
    sandbox = tmp_path.resolve()
    prepare_sandbox(case, sandbox)
    fake = FakeStagehand(case, sandbox)
    host = case.get("host", {})
    tools = StagehandFacadeTools(
        cast(Stagehand, fake),
        artifact_root=sandbox / "artifacts",
        quiet_wait=host.get("quietWait"),
    )

    for index, step in enumerate(case["steps"]):
        if "pageUrl" in step:
            fake.url = step["pageUrl"]
        if "snapshot" in step:
            fake.snapshot = step["snapshot"]
        fake.screenshot_options = None
        fake.scripted = list(step["batch"])
        fake.sent = []
        try:
            outcome: dict[str, object] = {"result": await call_tool(tools, step["call"])}
        except Exception as error:
            outcome = {"error": error}
        expected = step["expect"]
        if "result" in expected:
            assert "result" in outcome, f"step {index}: {outcome!r}"
            # Compare as JSON so that 1 and True differ, as toStrictEqual does in TypeScript.
            actual = json.dumps(outcome["result"], sort_keys=True)
            assert actual == json.dumps(expand(expected["result"], sandbox), sort_keys=True)
        else:
            assert "error" in outcome, f"step {index}: {outcome!r}"
            check_error(cast(BaseException, outcome["error"]), expected["error"])
        assert not fake.scripted, f"step {index}: unused batch responses"
        if "sent" in step:
            assert fake.sent == step["sent"], f"step {index}"
        if "screenshotOptions" in step:
            assert json.dumps(fake.screenshot_options, sort_keys=True) == json.dumps(
                step["screenshotOptions"], sort_keys=True
            ), f"step {index}: screenshot options"

    expected = case.get("expect", {})
    if "closed" in expected:
        assert fake.close_count == (1 if expected["closed"] else 0)
        assert fake.browser.close_count == (1 if expected["closed"] else 0)
    if "context" in expected:
        assert fake.browser.context.calls == expected["context"]
    if "tree" in expected:
        assert list_tree(sandbox) == expected["tree"]
    for file, content in expected.get("files", {}).items():
        data = (sandbox / file).read_bytes()
        if isinstance(content, str):
            assert base64.b64encode(data).decode() == content, file
        else:
            assert len(data) == content["size"], file
