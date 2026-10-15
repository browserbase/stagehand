from __future__ import annotations

import json
import re
from typing import cast, get_args

import pytest
from pydantic import ValidationError

from stagehand import AriaRole, AriaRoleName, Locator, Page
from stagehand._generated.models import LocatorClickParams, LocatorClickResult, PageRef
from stagehand.rpc_client import RPCClient

from ._support import RecordingRPCClient


def _page(recording: RecordingRPCClient) -> Page:
    return Page(cast(RPCClient, recording), PageRef(page_id="page-1"))


def _steps(locator: Locator) -> object:
    assert locator.selector.startswith("internal:locator=")
    return json.loads(locator.selector.removeprefix("internal:locator="))


def test_page_builders_are_lazy_and_keep_text_out_of_selector_syntax() -> None:
    recording = RecordingRPCClient()
    page = _page(recording)
    name = 'Publish "draft" >> release\n雪'

    role = page.get_by_role("button", name=name, description=name, exact=True, include_hidden=False)
    text = page.get_by_text(name, exact=False)

    assert _steps(role) == [
        {
            "kind": "role",
            "role": "button",
            "options": {
                "name": name,
                "description": name,
                "exact": True,
                "include_hidden": False,
            },
        }
    ]
    assert _steps(text) == [{"kind": "text", "text": name, "exact": False}]
    assert role.page_id == text.page_id == "page-1"
    assert role.nth_index is text.nth_index is None
    assert recording.calls == []


def test_role_builder_preserves_false_states_and_enum_roles() -> None:
    locator = _page(RecordingRPCClient()).get_by_role(
        AriaRole.button,
        disabled=False,
        expanded=False,
        selected=False,
        checked=False,
        pressed=False,
        level=2,
    )

    assert _steps(locator) == [
        {
            "kind": "role",
            "role": "button",
            "options": {
                "disabled": False,
                "expanded": False,
                "selected": False,
                "checked": False,
                "pressed": False,
                "level": 2,
            },
        }
    ]


def test_role_name_type_is_public_and_matches_the_generated_enum() -> None:
    assert set(get_args(AriaRoleName)) == {role.value for role in AriaRole}
    assert "mark" not in get_args(AriaRoleName)


@pytest.mark.parametrize("builder", ["name", "description", "text"])
def test_native_regexes_keep_supported_flags(builder: str) -> None:
    page = _page(RecordingRPCClient())
    pattern = re.compile(r"^Publish\s+draft$", re.IGNORECASE | re.MULTILINE | re.DOTALL)
    if builder in ("name", "description"):
        locator = (
            page.get_by_role("button", name=pattern)
            if builder == "name"
            else page.get_by_role("button", description=pattern)
        )
        expected = [
            {
                "kind": "role",
                "role": "button",
                "options": {builder: {"source": pattern.pattern, "flags": "ims"}},
            }
        ]
    else:
        locator = page.get_by_text(pattern)
        expected = [{"kind": "text", "text": {"source": pattern.pattern, "flags": "ims"}}]

    assert _steps(locator) == expected


@pytest.mark.parametrize("flags", [re.ASCII, re.VERBOSE, re.DEBUG])
def test_native_regexes_reject_flags_without_javascript_equivalents(flags: re.RegexFlag) -> None:
    page = _page(RecordingRPCClient())
    pattern = re.compile("Publish", flags)

    with pytest.raises(ValueError, match="support only IGNORECASE, MULTILINE, and DOTALL"):
        page.get_by_text(pattern)
    with pytest.raises(ValueError, match="support only IGNORECASE, MULTILINE, and DOTALL"):
        page.get_by_role("button", name=pattern)
    with pytest.raises(ValueError, match="support only IGNORECASE, MULTILINE, and DOTALL"):
        page.get_by_role("button", description=pattern)


def test_nested_builders_keep_nth_at_its_original_scope_and_do_not_mutate_parent() -> None:
    page = _page(RecordingRPCClient())
    source = page.locator('iframe[title="a >> b"] >> section').nth(2)
    role = source.get_by_role("button", name="Publish", description="Release draft").nth(1)
    descendant = role.locator("span").get_by_text("Ready", exact=True)

    assert _steps(descendant) == [
        {"kind": "selector", "selector": 'iframe[title="a >> b"] >> section'},
        {"kind": "nth", "index": 2},
        {
            "kind": "role",
            "role": "button",
            "options": {"name": "Publish", "description": "Release draft"},
        },
        {"kind": "nth", "index": 1},
        {"kind": "selector", "selector": "span"},
        {"kind": "text", "text": "Ready", "exact": True},
    ]
    assert source.selector == 'iframe[title="a >> b"] >> section'
    assert source.nth_index == 2
    assert role.nth_index == 1
    assert descendant.nth_index is None


def test_empty_text_is_valid_but_empty_descendant_selector_is_not() -> None:
    page = _page(RecordingRPCClient())

    assert _steps(page.get_by_text("")) == [{"kind": "text", "text": ""}]
    with pytest.raises(ValidationError):
        page.get_by_text("anything").locator("")


def test_role_options_validate_before_any_rpc() -> None:
    recording = RecordingRPCClient()
    page = _page(recording)

    with pytest.raises(ValidationError):
        page.get_by_role(cast(AriaRole, "not-a-role"))
    with pytest.raises(ValidationError):
        page.get_by_role("heading", level=0)
    with pytest.raises(ValidationError):
        page.get_by_role("heading", level=cast(int, 1.5))
    with pytest.raises(ValidationError):
        page.get_by_role("checkbox", checked=cast(bool, "mixed"))
    assert recording.calls == []


def test_malformed_reserved_queries_fail_when_chained() -> None:
    page = _page(RecordingRPCClient())

    with pytest.raises(ValidationError):
        page.locator('internal:locator=[{"kind":"unknown"}]').get_by_text("text")
    with pytest.raises(ValidationError):
        page.locator("internal:locator=not-json").locator("span")
    with pytest.raises(ValidationError):
        page.locator("internal:locator=[]").locator("span")
    with pytest.raises(ValueError, match="must start with a selector, role, or text"):
        page.locator('internal:locator=[{"kind":"nth","index":0}]').locator("span")


@pytest.mark.parametrize("padding", ["", "  "])
def test_nested_reserved_selector_arguments_are_rejected(padding: str) -> None:
    page = _page(RecordingRPCClient())
    encoded = page.get_by_role("button", name="Publish").selector

    with pytest.raises(ValueError, match="cannot contain another semantic locator query"):
        page.locator("section").locator(padding + encoded)

    assert page.locator(encoded).selector == encoded
    assert _steps(page.locator(encoded).locator("span")) == [
        {"kind": "role", "role": "button", "options": {"name": "Publish"}},
        {"kind": "selector", "selector": "span"},
    ]


@pytest.mark.asyncio
async def test_semantic_locator_actions_use_the_existing_generated_descriptor() -> None:
    recording = RecordingRPCClient({"locator.click": {"clicked": True}})
    locator = _page(recording).get_by_role("button", name="Publish").nth(2)

    await locator.click(timeout=123)

    assert recording.calls == [
        (
            "locator.click",
            LocatorClickParams.model_validate({
                "page_id": "page-1",
                "selector": locator.selector,
                "nth": 2,
                "options": {"timeout": 123},
            }),
            LocatorClickResult,
        )
    ]
