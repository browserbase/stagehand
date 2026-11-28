from __future__ import annotations

import asyncio
import base64
import json
import math
import re
from pathlib import Path
from typing import Any, cast

import jsonschema
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from pydantic import BaseModel, ConfigDict

from stagehand import file_upload, rpc_client, timeouts
from stagehand._generated.models import (
    BrowserbaseRegion,
    BrowserSessionMetadata,
    ChainLocatorDescriptor,
    ContextVoidResult,
    LocatorDescriptor,
    NavigationResponseDescriptor,
    PageRef,
    WebMCPInvocationDescriptor,
    WebMCPToolDescriptor,
)
from stagehand._generated.models import (
    WebMCPToolResponse as WireWebMCPToolResponse,
)
from stagehand._locator_selectors import _query, locator_steps
from stagehand.browser import _WorkerInitMetadata
from stagehand.browser_context import BrowserContext
from stagehand.browserbase_connection import BrowserbaseConnection, resolve_browserbase_connection
from stagehand.browserbase_transport import _request_headers
from stagehand.client_models import StagehandClientCreateConfig
from stagehand.file_upload import FileInput, FilePayload, normalize_file_input
from stagehand.locator import Locator
from stagehand.page import Page
from stagehand.response import Response
from stagehand.rpc_client import RPCClient
from stagehand.webmcp import WebMCPInvocation, WebMCPTool

from ._support import RecordingRPCClient

_PROTOCOL_SCHEMA = json.loads(
    (Path(__file__).resolve().parents[2] / "protocol" / "stagehand.v4.json").read_text()
)
_PROTOCOL_METHODS: dict[str, Any] = _PROTOCOL_SCHEMA["properties"]["methods"]["properties"]
_LOCATOR_METHODS = sorted(m for m in _PROTOCOL_METHODS if m.startswith("locator."))
_CLEAR_COOKIES_VALIDATOR = jsonschema.Draft202012Validator({
    "$defs": _PROTOCOL_SCHEMA["$defs"],
    **_PROTOCOL_METHODS["context.clear_cookies"]["properties"]["params"],
})

_ZERO_UNBOUNDED_METHODS = (
    "page.pdf",
    "page.snapshot",
    "page.wait_for_function",
    "page.wait_for_selector",
)
_OPTIONS_TIMEOUT_METHODS = (
    "stagehand.act",
    "stagehand.extract",
    "stagehand.observe",
    "stagehand.callback_batch",
    "page.goto",
    "page.reload",
    "page.go_back",
    "page.go_forward",
    "page.screenshot",
    "page.pdf",
    "page.snapshot",
    "page.wait_for_function",
    "page.wait_for_selector",
    "page.webmcp_tools",
    "page.webmcp_invocation_result",
)
_DIRECT_TIMEOUT_METHODS = (
    ("page.wait_for_load_state", "timeout"),
    ("page.wait_for_timeout", "ms"),
)


class _AnyParams(BaseModel):
    model_config = ConfigDict(extra="allow")


_ARBITRARY_TIMEOUTS: st.SearchStrategy[object] = st.one_of(
    st.none(),
    st.just(0),
    st.just(0.0),
    st.just(-0.0),
    st.booleans(),
    st.integers(min_value=-(10**9), max_value=10**9),
    st.sampled_from([10**18, 10**308, 10**309, 10**400, -(10**400)]),
    st.floats(allow_nan=True, allow_infinity=True),
)


def _to_usable_finite_float(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        numeric = float(value)
    except OverflowError:
        return None
    return numeric if math.isfinite(numeric) else None


def _ts_expected_timeout_seconds(method: str, raw_timeout: object) -> float | None:
    grace = rpc_client._RPC_RESPONSE_GRACE_MS
    finite = _to_usable_finite_float(raw_timeout)

    if method.startswith("locator."):
        if finite == 0:
            return None
        effective = rpc_client._DEFAULT_LOCATOR_TIMEOUT_MS if finite is None else max(0.0, finite)
        result = (grace + effective) / 1_000
        return result if math.isfinite(result) else None

    if finite is not None:
        if finite == 0 and method in _ZERO_UNBOUNDED_METHODS:
            return None
        result = (grace + max(0.0, finite)) / 1_000
        return result if math.isfinite(result) else None

    if method in rpc_client._DEFAULT_OPERATION_TIMEOUT_MS:
        return (grace + rpc_client._DEFAULT_OPERATION_TIMEOUT_MS[method]) / 1_000
    if method in rpc_client._UNBOUNDED_BY_DEFAULT_METHODS:
        return None
    return grace / 1_000


@settings(max_examples=200, deadline=None)
@given(method=st.sampled_from(_LOCATOR_METHODS), timeout=_ARBITRARY_TIMEOUTS)
def test_locator_response_timeout_clamping_and_non_finite_safety(
    method: str, timeout: object
) -> None:
    params = _AnyParams(options={"timeout": timeout}) if timeout is not None else _AnyParams()
    actual = rpc_client._rpc_response_timeout_seconds(method, params)
    expected = _ts_expected_timeout_seconds(method, timeout)
    if expected is None:
        assert actual is None
    else:
        assert actual is not None
        assert math.isfinite(actual)
        assert actual >= rpc_client._RPC_RESPONSE_GRACE_MS / 1_000
        assert actual == pytest.approx(expected)


@settings(max_examples=200, deadline=None)
@given(method=st.sampled_from(_OPTIONS_TIMEOUT_METHODS), timeout=_ARBITRARY_TIMEOUTS)
def test_options_timeout_methods_parity_with_ts(method: str, timeout: object) -> None:
    params = _AnyParams(options={"timeout": timeout}) if timeout is not None else _AnyParams()
    actual = rpc_client._rpc_response_timeout_seconds(method, params)
    expected = _ts_expected_timeout_seconds(method, timeout)
    if expected is None:
        assert actual is None
    else:
        assert actual is not None
        assert math.isfinite(actual)
        assert actual >= rpc_client._RPC_RESPONSE_GRACE_MS / 1_000
        assert actual == pytest.approx(expected)


@settings(max_examples=150, deadline=None)
@given(
    method_and_field=st.sampled_from(_DIRECT_TIMEOUT_METHODS),
    timeout=_ARBITRARY_TIMEOUTS,
)
def test_direct_timeout_methods_parity_with_ts(
    method_and_field: tuple[str, str], timeout: object
) -> None:
    method, field_name = method_and_field
    params = _AnyParams(**{field_name: timeout}) if timeout is not None else _AnyParams()
    actual = rpc_client._rpc_response_timeout_seconds(method, params)
    expected = _ts_expected_timeout_seconds(method, timeout)
    if expected is None:
        assert actual is None
    else:
        assert actual is not None
        assert math.isfinite(actual)
        assert actual >= rpc_client._RPC_RESPONSE_GRACE_MS / 1_000
        assert actual == pytest.approx(expected)


@pytest.mark.asyncio
async def test_stagehand_init_deadline_preserves_inner_timeout_and_wraps_expiry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(timeouts, "STAGEHAND_INIT_TIMEOUT_MS", 30)

    @timeouts.stagehand_init_deadline
    async def fast(x: int) -> int:
        return x + 1

    assert await fast(41) == 42

    @timeouts.stagehand_init_deadline
    async def inner_timeout() -> None:
        raise TimeoutError("inner operation timed out")

    with pytest.raises(TimeoutError, match="^inner operation timed out$"):
        await inner_timeout()

    @timeouts.stagehand_init_deadline
    async def slow() -> None:
        await asyncio.sleep(1)

    with pytest.raises(TimeoutError, match="Stagehand initialization timed out after 30ms"):
        await slow()


@settings(max_examples=100, deadline=None)
@given(
    name=st.text(min_size=1, max_size=40),
    raw=st.binary(max_size=4096),
    buffer_kind=st.sampled_from(["bytes", "bytearray", "memoryview"]),
    mime_type=st.one_of(st.none(), st.text(min_size=1, max_size=40)),
    last_modified=st.one_of(st.none(), st.integers(min_value=0, max_value=9_007_199_254_740_991)),
)
def test_file_upload_binary_roundtrip_and_metadata(
    name: str,
    raw: bytes,
    buffer_kind: str,
    mime_type: str | None,
    last_modified: int | None,
) -> None:
    buf: bytes | bytearray | memoryview
    if buffer_kind == "bytes":
        buf = raw
    elif buffer_kind == "bytearray":
        buf = bytearray(raw)
    else:
        buf = memoryview(raw)

    payload = FilePayload(name=name, buffer=buf, mime_type=mime_type, last_modified=last_modified)
    (normalized,) = normalize_file_input(payload)
    assert normalized.name == name
    assert base64.b64decode(normalized.data, validate=True) == raw
    dumped = normalized.model_dump(exclude_unset=True)
    if mime_type is None:
        assert "mime_type" not in dumped
    else:
        assert dumped["mime_type"] == mime_type
    if last_modified is None:
        assert "last_modified" not in dumped
    else:
        assert dumped["last_modified"] == last_modified


@settings(max_examples=80, deadline=None)
@given(
    name=st.text(min_size=1, max_size=40),
    text=st.text(
        alphabet=st.characters(blacklist_categories=("Cs",)),
        max_size=512,
    ),
)
def test_file_upload_string_utf8_roundtrip(name: str, text: str) -> None:
    (normalized,) = normalize_file_input(FilePayload(name=name, buffer=text))
    assert base64.b64decode(normalized.data, validate=True) == text.encode("utf-8")


@settings(max_examples=50, deadline=None)
@given(
    bad_buffer=st.one_of(
        st.integers(min_value=0, max_value=10_000),
        st.booleans(),
        st.none(),
        st.lists(st.integers(min_value=0, max_value=255), max_size=10),
        st.dictionaries(st.text(max_size=5), st.integers(), max_size=3),
    )
)
def test_file_upload_rejects_non_buffer_types_without_allocating_bytes(bad_buffer: object) -> None:
    payload = FilePayload(name="test.bin", buffer=cast(Any, bad_buffer))
    with pytest.raises((TypeError, ValueError)):
        normalize_file_input(payload)


def test_file_upload_50mib_boundary_and_malformed_inputs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    exact_50mib = bytes(50 * 1024 * 1024)
    (ok_payload,) = normalize_file_input(FilePayload(name="exact.bin", buffer=exact_50mib))
    assert len(ok_payload.data) == 69_905_068

    over_50mib = bytearray(50 * 1024 * 1024 + 1)
    with pytest.raises(ValueError, match="50 MiB upload limit"):
        normalize_file_input(FilePayload(name="over.bin", buffer=over_50mib))

    with pytest.raises(ValueError):
        normalize_file_input(cast(FileInput, b""))

    with pytest.raises(ValueError):
        normalize_file_input(FilePayload(name="bad.txt", buffer=b"hi", last_modified=-1))

    with pytest.raises(ValueError):
        normalize_file_input(
            FilePayload(name="bad.txt", buffer=b"hi", last_modified=cast(int, True))
        )

    monkeypatch.setattr(file_upload, "_MAX_INPUT_FILE_BYTES", 8)
    assert normalize_file_input(FilePayload(name="ok", buffer=b"12345678"))
    with pytest.raises(ValueError, match="50 MiB upload limit"):
        normalize_file_input(FilePayload(name="too-big", buffer=b"123456789"))


@settings(max_examples=100, deadline=None)
@given(quote=st.sampled_from(['"', "'"]), prefix=st.sampled_from(["text=", "TEXT=", "Text="]))
def test_locator_text_selector_preserves_lone_quote(quote: str, prefix: str) -> None:
    parsed = _query(f"{prefix}{quote}")
    assert parsed == {"kind": "text", "value": quote}


@settings(max_examples=100, deadline=None)
@given(
    inner=st.text(
        alphabet=st.characters(blacklist_characters="\"'\r\n\t "),
        min_size=0,
        max_size=20,
    ),
    quote=st.sampled_from(['"', "'"]),
)
def test_locator_text_selector_strips_matching_outer_quotes(inner: str, quote: str) -> None:
    parsed = _query(f"text={quote}{inner}{quote}")
    assert parsed == {"kind": "text", "value": inner}


_SAFE_CSS_SELECTOR = st.from_regex(r"[a-z][a-z0-9_-]{0,8}", fullmatch=True)
_LOCATOR_OP = st.one_of(
    st.tuples(st.just("locator"), _SAFE_CSS_SELECTOR),
    st.tuples(
        st.just("frame"),
        _SAFE_CSS_SELECTOR,
        _SAFE_CSS_SELECTOR,
    ),
    st.tuples(
        st.just("text"),
        st.text(min_size=0, max_size=20),
        st.booleans(),
    ),
    st.tuples(
        st.just("role"),
        st.sampled_from(["button", "link", "heading", "checkbox"]),
        st.one_of(st.none(), st.text(min_size=1, max_size=15)),
        st.booleans(),
    ),
    st.tuples(st.just("first")),
    st.tuples(st.just("nth"), st.integers(min_value=0, max_value=100)),
)


@settings(max_examples=120, deadline=None)
@given(
    initial_selector=_SAFE_CSS_SELECTOR,
    ops=st.lists(_LOCATOR_OP, min_size=1, max_size=8),
)
def test_locator_builder_immutability_and_valid_step_serialization(
    initial_selector: str,
    ops: list[tuple[Any, ...]],
) -> None:
    recording = RecordingRPCClient()
    root = Locator(cast(RPCClient, recording), page_id="page-1", selector=initial_selector)
    root_snapshot = root.descriptor.model_dump(exclude_unset=True)

    mutated_copy = root.descriptor
    if isinstance(mutated_copy, LocatorDescriptor):
        mutated_copy.nth = 99
    assert root.descriptor.model_dump(exclude_unset=True) == root_snapshot

    current = root
    snapshots: list[tuple[Locator, dict[str, Any]]] = [(root, root_snapshot)]
    for op in ops:
        kind = op[0]
        if kind == "locator":
            current = current.locator(op[1])
        elif kind == "frame":
            current = current.locator(f"{op[1]} >> {op[2]}")
        elif kind == "text":
            current = current.get_by_text(op[1], exact=op[2])
        elif kind == "role":
            current = current.get_by_role(op[1], name=op[2], exact=op[3])
        elif kind == "first":
            current = current.first()
        elif kind == "nth":
            current = current.nth(op[1])

        desc = current.descriptor
        if isinstance(desc, ChainLocatorDescriptor):
            dumped = desc.model_dump(mode="json", exclude_unset=True)
            assert dumped["chain"]["steps"][0]["type"] == "query"
            ChainLocatorDescriptor.model_validate(dumped)
        else:
            LocatorDescriptor.model_validate(desc.model_dump(mode="json", exclude_unset=True))
        snapshots.append((current, desc.model_dump(exclude_unset=True)))

    for loc, expected in snapshots:
        assert loc.descriptor.model_dump(exclude_unset=True) == expected
    assert recording.calls == []


@settings(max_examples=80, deadline=None)
@given(
    invalid_nth=st.one_of(
        st.integers(max_value=-1),
        st.integers(min_value=9_007_199_254_740_992, max_value=10**20),
        st.booleans(),
        st.floats(allow_nan=True, allow_infinity=True),
    )
)
def test_locator_rejects_invalid_nth_indices(invalid_nth: object) -> None:
    recording = RecordingRPCClient()
    base = Locator(cast(RPCClient, recording), page_id="page-1", selector="button")
    chained = base.locator("span")
    with pytest.raises((ValueError, TypeError)):
        base.nth(cast(int, invalid_nth))
    with pytest.raises((ValueError, TypeError)):
        chained.nth(cast(int, invalid_nth))


@pytest.mark.asyncio
@settings(max_examples=100, deadline=None)
@given(
    pattern=st.from_regex(r"[a-zA-Z0-9_.\-^$]{1,20}", fullmatch=True),
    ignorecase=st.booleans(),
    multiline=st.booleans(),
    dotall=st.booleans(),
    use_domain_regex=st.booleans(),
    path_str=st.one_of(st.none(), st.text(min_size=1, max_size=20)),
)
async def test_browser_context_cookie_filter_serialization_matches_protocol_schema(
    pattern: str,
    ignorecase: bool,
    multiline: bool,
    dotall: bool,
    use_domain_regex: bool,
    path_str: str | None,
) -> None:
    flags = (
        (re.IGNORECASE if ignorecase else 0)
        | (re.MULTILINE if multiline else 0)
        | (re.DOTALL if dotall else 0)
    )
    compiled = re.compile(pattern, flags)
    recording = RecordingRPCClient({"context.clear_cookies": ContextVoidResult(ok=True)})
    context = BrowserContext(cast(RPCClient, recording))

    await context.clear_cookies(
        name=compiled,
        domain=re.compile(pattern) if use_domain_regex else "example.com",
        path=path_str,
    )

    _, params, _ = recording.calls[0]
    wire = json.loads(params.model_dump_json(by_alias=True, exclude_unset=True))
    _CLEAR_COOKIES_VALIDATOR.validate(wire)

    expected_flags = (
        ("i" if ignorecase else "") + ("m" if multiline else "") + ("s" if dotall else "")
    )
    name_filter = wire["options"]["name"]
    assert name_filter["source"] == pattern
    if expected_flags:
        assert name_filter["flags"] == expected_flags
    else:
        assert "flags" not in name_filter or name_filter["flags"] == ""

    if use_domain_regex:
        domain_filter = wire["options"]["domain"]
        assert "flags" not in domain_filter or domain_filter["flags"] == ""


_ASCII_HEADER_NAME = st.from_regex(r"[A-Za-z][A-Za-z0-9\-]{0,15}", fullmatch=True)
_ASCII_HEADER_VALUE = st.from_regex(r"[A-Za-z0-9_=.,;:/\-]{1,20}", fullmatch=True)


@pytest.mark.asyncio
@settings(max_examples=80, deadline=None)
@given(
    status=st.integers(min_value=100, max_value=599),
    headers=st.lists(st.tuples(_ASCII_HEADER_NAME, _ASCII_HEADER_VALUE), min_size=1, max_size=10),
    query_idx=st.integers(min_value=0, max_value=9),
    body_bytes=st.binary(max_size=256),
)
async def test_response_header_case_insensitivity_and_body_roundtrip(
    status: int,
    headers: list[tuple[str, str]],
    query_idx: int,
    body_bytes: bytes,
) -> None:
    target_name = headers[query_idx % len(headers)][0]
    mixed_query = "".join(
        ch.upper() if i % 2 == 0 else ch.lower() for i, ch in enumerate(target_name)
    )
    recording = RecordingRPCClient({
        "response.headers_array": {
            "headers": [{"name": k, "value": v} for k, v in headers],
        },
        "response.body": {
            "body": base64.b64encode(body_bytes).decode("ascii"),
            "base64_encoded": True,
        },
    })
    resp = Response(
        cast(RPCClient, recording),
        NavigationResponseDescriptor(
            response_id="resp-1",
            url="https://example.test/",
            status=status,
            status_text="OK",
            headers={k: v for k, v in headers},
            from_service_worker=False,
        ),
    )

    assert resp.ok is (200 <= status <= 299)
    expected_values = [v for k, v in headers if k.lower() == target_name.lower()]
    assert await resp.header_values(mixed_query) == expected_values
    assert await resp.header_value(mixed_query) == ", ".join(expected_values)
    assert await resp.header_value("x-definitely-missing-header-xyz") is None
    assert await resp.body() == body_bytes


@settings(max_examples=80, deadline=None)
@given(
    region=st.one_of(st.none(), st.sampled_from(list(BrowserbaseRegion))),
    trailing_slashes=st.integers(min_value=0, max_value=5),
    custom_url=st.one_of(
        st.none(),
        st.just("https://api.custom.example"),
        st.just("https://api.custom.example/prefix"),
        st.just("http://127.0.0.1:8787"),
    ),
    worker_key=st.one_of(st.none(), st.just(""), st.just("bb-worker-key")),
    config_key=st.one_of(st.none(), st.just("bb-config-key")),
    session_id=st.one_of(st.none(), st.just("sess-123")),
)
def test_browserbase_connection_region_and_url_normalization(
    region: BrowserbaseRegion | None,
    trailing_slashes: int,
    custom_url: str | None,
    worker_key: str | None,
    config_key: str | None,
    session_id: str | None,
) -> None:
    api_url = f"{custom_url}{'/' * trailing_slashes}" if custom_url is not None else None
    config = StagehandClientCreateConfig(api_key=config_key, api_url=api_url)
    browser = (
        BrowserSessionMetadata(session_id=session_id, region=region)
        if session_id is not None
        else None
    )
    resolved = resolve_browserbase_connection(config, _WorkerInitMetadata(worker_key, browser))

    effective_key = config_key if worker_key is None else worker_key
    if not effective_key or session_id is None:
        assert resolved is None
        return

    assert isinstance(resolved, BrowserbaseConnection)
    assert resolved.api_key == effective_key
    assert effective_key not in repr(resolved)
    assert resolved.session_id == session_id
    assert resolved.api_url.endswith("/v1")
    assert not resolved.api_url.endswith("//v1")
    if custom_url is not None:
        assert resolved.api_url == f"{custom_url}/v1"


@settings(max_examples=80, deadline=None)
@given(
    nominated=st.from_regex(r"x-[a-z]{2,8}", fullmatch=True),
    custom_name=st.from_regex(r"x-app-[a-z]{2,6}", fullmatch=True),
    custom_value=st.from_regex(r"[A-Za-z0-9_.\-]{1,16}", fullmatch=True),
    forwarded_suffix=st.from_regex(r"[a-z]{2,8}", fullmatch=True),
)
def test_browserbase_transport_request_headers_strips_hop_by_hop_and_reserved(
    nominated: str,
    custom_name: str,
    custom_value: str,
    forwarded_suffix: str,
) -> None:
    raw = {
        "Host": "evil.example",
        "Content-Length": "999",
        "X-BB-API-Key": "spoofed",
        "X-BB-Session-Id": "spoofed-session",
        "Connection": f"keep-alive, {nominated.upper()}",
        nominated: "should-be-stripped",
        f"X-Forwarded-{forwarded_suffix}": "1.2.3.4",
        custom_name: f"  {custom_value}\t ",
    }
    filtered = _request_headers(raw)
    assert "host" not in filtered
    assert "content-length" not in filtered
    assert "x-bb-api-key" not in filtered
    assert "x-bb-session-id" not in filtered
    assert "connection" not in filtered
    assert nominated not in filtered
    assert f"x-forwarded-{forwarded_suffix}" not in filtered
    if custom_name.lower() != nominated.lower():
        assert filtered[custom_name] == custom_value


@pytest.mark.asyncio
@settings(max_examples=60, deadline=None)
@given(
    tool_id=st.one_of(st.none(), st.text(min_size=1, max_size=20)),
    input_payload=st.dictionaries(
        st.text(min_size=1, max_size=10),
        st.one_of(st.none(), st.booleans(), st.integers(-100, 100), st.text(max_size=10)),
        max_size=5,
    ),
    status=st.sampled_from(["Completed", "Canceled", "Error"]),
)
async def test_webmcp_defensive_copies_and_single_terminal_result_caching(
    tool_id: str | None,
    input_payload: dict[str, Any],
    status: str,
) -> None:
    recording = RecordingRPCClient({
        "page.webmcp_invoke_tool": WebMCPInvocationDescriptor(
            invocation_id="inv-1",
            tool_name="search",
            frame_id="frame-1",
            input=dict(input_payload),
        ),
        "page.webmcp_invocation_result": WireWebMCPToolResponse.model_validate({
            "invocation_id": "inv-1",
            "status": status,
            "output": {"echo": input_payload} if status == "Completed" else None,
            "error_text": "failed" if status == "Error" else None,
        }),
        "page.webmcp_cancel_invocation": ContextVoidResult(ok=True),
    })

    descriptor = WebMCPToolDescriptor.model_validate({
        **({"tool_id": tool_id} if tool_id is not None else {}),
        "name": "search",
        "description": "Search items",
        "frame_id": "frame-1",
        "input_schema": {"type": "object", "properties": {"q": {"type": "string"}}},
    })
    tool = WebMCPTool(cast(RPCClient, recording), "page-1", descriptor)

    schema_copy = tool.input_schema
    assert schema_copy is not None
    schema_copy["mutated"] = True
    assert "mutated" not in (tool.input_schema or {})

    invocation = await tool.invoke(input=input_payload)
    inv_input = invocation.input
    inv_input["__mutated__"] = "yes"
    assert "__mutated__" not in invocation.input

    first_result = await invocation.result(timeout=5000)
    second_result = await invocation.result(timeout=5000)
    assert first_result is second_result
    assert first_result.status == status
    assert [m for m, _, _ in recording.calls].count("page.webmcp_invocation_result") == 1


@pytest.mark.asyncio
async def test_webmcp_concurrent_result_calls_converge_to_single_terminal_instance() -> None:
    gate = asyncio.Event()
    call_count = 0

    class _SlowRPC:
        async def send(
            self, method: str, params: BaseModel, result_model: type[BaseModel]
        ) -> WireWebMCPToolResponse:
            nonlocal call_count
            call_count += 1
            n = call_count
            await gate.wait()
            return WireWebMCPToolResponse.model_validate({
                "invocation_id": "inv-1",
                "status": "Completed",
                "output": n,
            })

    invocation = WebMCPInvocation(
        cast(RPCClient, _SlowRPC()),
        "page-1",
        WebMCPInvocationDescriptor(
            invocation_id="inv-1",
            tool_name="search",
            frame_id="frame-1",
            input={},
        ),
    )
    t1 = asyncio.create_task(invocation.result())
    t2 = asyncio.create_task(invocation.result())
    await asyncio.sleep(0)
    gate.set()
    r1, r2 = await asyncio.gather(t1, t2)
    assert r1 is r2


def test_locator_steps_never_crashes_on_arbitrary_selector_strings() -> None:
    @settings(max_examples=200, deadline=None)
    @given(raw=st.text(max_size=60))
    def _check(raw: str) -> None:
        steps = locator_steps(raw)
        assert len(steps) >= 1
        assert steps[0]["type"] == "query"
        for step in steps[1:]:
            assert step["type"] == "frame"

    _check()


def test_page_locator_get_by_text_handles_special_delimiters() -> None:
    recording = RecordingRPCClient()
    page = Page(cast(RPCClient, recording), PageRef(page_id="p"))
    loc = page.get_by_text('text=" >> //iframe', exact=True)
    dumped = loc.descriptor.model_dump()
    assert dumped == {
        "page_id": "p",
        "chain": {
            "steps": [
                {
                    "type": "query",
                    "selector": {
                        "kind": "textMatch",
                        "value": 'text=" >> //iframe',
                        "exact": True,
                    },
                }
            ]
        },
    }
