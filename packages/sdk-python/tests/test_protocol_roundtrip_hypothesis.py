from __future__ import annotations

import base64
import json
import math
import os
import re
import shutil
import subprocess
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from pydantic import BaseModel, ValidationError

from stagehand._generated import models
from stagehand._generated.protocol_version import STAGEHAND_PROTOCOL_VERSION
from stagehand.rpc_client import (
    _JSONRPCError,
    _JSONRPCErrorResponse,
    _JSONRPCNotification,
    _JSONRPCRequest,
    _JSONRPCSuccessResponse,
)

from ._wire_bridge_check import resolve_model

REPO_ROOT = Path(__file__).resolve().parents[3]
PROTOCOL_DIR = REPO_ROOT / "packages" / "protocol"
TSX_BIN = REPO_ROOT / "node_modules" / ".bin" / "tsx"
TS_BRIDGE_SCRIPT = PROTOCOL_DIR / "tests" / "protocol" / "wire-bridge-check.ts"

MAX_SAFE_INT = 9_007_199_254_740_991
MAX_CALLBACK_BATCH_TIMEOUT_MS = 2_147_473_647
SNAKE_CASE_KEY = re.compile(r"^(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)*|\$schema)$")

DEFAULT_SETTINGS = settings(
    max_examples=50,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)

TRICKY_STRINGS = [
    "",
    "0",
    "123",
    "-1",
    "a.b",
    "foo_bar",
    "fooBar",
    "FOO_BAR",
    "X-Request-ID",
    "base_url",
    "baseURL",
    "prefer_css_page_size",
    "preferCSSPageSize",
    "constructor",
    "toString",
    "hasOwnProperty",
    "café_日本語_🚀",
    "مرحبا",
    "line1\nline2",
    "nul\x00byte",
    "   ",
]


def _normalize_zero(value: float) -> float:
    return 0.0 if value == 0.0 else value


finite_floats = st.floats(
    min_value=-1e6,
    max_value=1e6,
    allow_nan=False,
    allow_infinity=False,
).map(_normalize_zero)

nonneg_floats = st.floats(
    min_value=0.0,
    max_value=1e6,
    allow_nan=False,
    allow_infinity=False,
).map(_normalize_zero)

pos_floats = st.floats(
    min_value=0.001,
    max_value=1e6,
    allow_nan=False,
    allow_infinity=False,
).map(_normalize_zero)

nonneg_ints = st.integers(min_value=0, max_value=1_000_000)
pos_ints = st.integers(min_value=1, max_value=1_000_000)
safe_ints = st.integers(min_value=-1_000_000, max_value=1_000_000)
request_ids = st.one_of(
    st.integers(min_value=0, max_value=100_000),
    st.sampled_from([0, 1, 42, MAX_SAFE_INT]),
)

edge_strings = st.one_of(
    st.sampled_from(TRICKY_STRINGS),
    st.text(max_size=32),
)
# Exclude "__proto__" in normal cross-SDK dictionaries; dedicated contract test covers it.
safe_map_keys = edge_strings.filter(lambda s: s != "__proto__")
nonempty_strings = edge_strings.filter(lambda s: len(s) > 0)

base64_strings = st.binary(min_size=0, max_size=32).map(
    lambda raw: base64.b64encode(raw).decode("ascii")
)

http_urls = st.tuples(
    st.sampled_from(["http", "https"]),
    st.sampled_from(["example.com", "sub.example.org", "localhost", "127.0.0.1"]),
    st.one_of(st.none(), st.integers(min_value=80, max_value=65535)),
    st.lists(st.from_regex(r"[a-z0-9_-]{1,8}", fullmatch=True), max_size=3),
).map(
    lambda t: (
        f"{t[0]}://{t[1]}"
        + (f":{t[2]}" if t[2] is not None else "")
        + (f"/{'/'.join(t[3])}" if t[3] else "")
    )
)

trace_endpoints = http_urls.map(lambda base: f"{base.rstrip('/')}/v1/traces")

json_values: st.SearchStrategy[Any] = st.recursive(
    st.one_of(
        st.none(),
        st.booleans(),
        safe_ints,
        finite_floats,
        edge_strings,
    ),
    lambda children: st.one_of(
        st.lists(children, max_size=3),
        st.dictionaries(safe_map_keys, children, max_size=3),
    ),
    max_leaves=10,
)
json_objects = st.dictionaries(safe_map_keys, json_values, max_size=4)
string_maps = st.dictionaries(safe_map_keys, edge_strings, max_size=4)


def _omit_unset(**kwargs: object) -> dict[str, Any]:
    return {k: v for k, v in kwargs.items() if v is not _UNSET}


_UNSET = object()


def opt(strategy: st.SearchStrategy[Any]) -> st.SearchStrategy[Any]:
    return st.one_of(st.just(_UNSET), strategy)


model_names = st.tuples(
    st.sampled_from(["openai", "anthropic", "google", "groq", "cerebras"]),
    st.from_regex(r"[A-Za-z0-9._:/-]{1,20}", fullmatch=True),
).map(lambda t: f"{t[0]}/{t[1]}")


@st.composite
def model_config_st(draw: st.DrawFn) -> models.ModelConfig:
    data = _omit_unset(
        model_name=draw(model_names),
        api_key=draw(opt(nonempty_strings)),
        headers=draw(opt(string_maps)),
    )
    return models.ModelConfig.model_validate(data)


@st.composite
def locator_query_selector_st(draw: st.DrawFn) -> models.LocatorQuerySelector:
    kind = draw(st.sampled_from(["css", "xpath", "text"]))
    val = draw(nonempty_strings)
    return models.LocatorQuerySelector.model_validate({"kind": kind, "value": val})


@st.composite
def locator_step_st(draw: st.DrawFn) -> models.LocatorStep:
    step_type = draw(st.sampled_from(["query", "frame", "nth"]))
    if step_type == "nth":
        return models.LocatorStep.model_validate({"type": "nth", "index": draw(nonneg_ints)})
    return models.LocatorStep.model_validate({
        "type": step_type,
        "selector": draw(locator_query_selector_st()).model_dump(mode="json"),
    })


@st.composite
def locator_chain_st(draw: st.DrawFn) -> models.LocatorChain:
    first = models.LocatorQueryStep(
        type="query",
        selector=draw(locator_query_selector_st()),
    )
    rest = draw(st.lists(locator_step_st(), max_size=4))
    return models.LocatorChain(steps=[first, *rest])


@st.composite
def locator_input_st(draw: st.DrawFn) -> models.LocatorInput:
    if draw(st.booleans()):
        loc = models.Locator(
            **_omit_unset(selector=draw(nonempty_strings), nth=draw(opt(nonneg_ints)))
        )
        return models.LocatorInput(root=loc)
    return models.LocatorInput(root=models.ChainLocator(chain=draw(locator_chain_st())))


@st.composite
def locator_request_descriptor_st(draw: st.DrawFn) -> models.LocatorRequestDescriptor:
    page_id = draw(edge_strings)
    if draw(st.booleans()):
        desc = models.LocatorDescriptor(
            **_omit_unset(
                page_id=page_id, selector=draw(nonempty_strings), nth=draw(opt(nonneg_ints))
            )
        )
        return models.LocatorRequestDescriptor(root=desc)
    return models.LocatorRequestDescriptor(
        root=models.ChainLocatorDescriptor(page_id=page_id, chain=draw(locator_chain_st()))
    )


@st.composite
def locator_params_st(draw: st.DrawFn) -> models.LocatorParams:
    page_id = draw(edge_strings)
    timeout = draw(opt(nonneg_floats))
    options = (
        models.LocatorOptions(**_omit_unset(timeout=timeout)) if draw(st.booleans()) else _UNSET
    )
    if draw(st.booleans()):
        inner: BaseModel = models.LocatorParams1(
            **_omit_unset(
                page_id=page_id,
                selector=draw(nonempty_strings),
                nth=draw(opt(nonneg_ints)),
                options=options,
            )
        )
    else:
        inner = models.LocatorParams2(
            **_omit_unset(page_id=page_id, chain=draw(locator_chain_st()), options=options)
        )
    return models.LocatorParams.model_validate(inner.model_dump(mode="json", exclude_unset=True))


@st.composite
def locator_click_params_st(draw: st.DrawFn) -> models.LocatorClickParams:
    page_id = draw(edge_strings)
    options = (
        models.LocatorClickOptions(
            **_omit_unset(
                timeout=draw(opt(nonneg_floats)),
                button=draw(opt(st.sampled_from(list(models.MouseButton)))),
                click_count=draw(opt(pos_ints)),
            )
        )
        if draw(st.booleans())
        else _UNSET
    )
    if draw(st.booleans()):
        inner: BaseModel = models.LocatorClickParams1(
            **_omit_unset(
                page_id=page_id,
                selector=draw(nonempty_strings),
                nth=draw(opt(nonneg_ints)),
                options=options,
            )
        )
    else:
        inner = models.LocatorClickParams2(
            **_omit_unset(page_id=page_id, chain=draw(locator_chain_st()), options=options)
        )
    return models.LocatorClickParams.model_validate(
        inner.model_dump(mode="json", exclude_unset=True)
    )


@st.composite
def domain_policy_st(draw: st.DrawFn) -> models.DomainPolicy:
    return models.DomainPolicy(
        **_omit_unset(
            allowed_domains=draw(opt(st.lists(edge_strings, max_size=4))),
            blocked_domains=draw(opt(st.lists(edge_strings, max_size=4))),
        )
    )


@st.composite
def context_set_domain_policy_params_st(draw: st.DrawFn) -> models.ContextSetDomainPolicyParams:
    policy = draw(st.one_of(st.none(), domain_policy_st()))
    return models.ContextSetDomainPolicyParams(policy=policy)


@st.composite
def stagehand_result_usage_st(draw: st.DrawFn) -> models.StagehandResultUsage:
    return models.StagehandResultUsage(
        **_omit_unset(
            input_tokens=draw(opt(nonneg_ints)),
            output_tokens=draw(opt(nonneg_ints)),
            reasoning_tokens=draw(opt(nonneg_ints)),
            cached_input_tokens=draw(opt(nonneg_ints)),
            inference_time_ms=draw(opt(nonneg_ints)),
        )
    )


@st.composite
def cache_metadata_st(draw: st.DrawFn) -> models.CacheMetadata:
    tokens_saved = (
        models.CacheTokenSavings(
            **_omit_unset(
                input_tokens=draw(opt(nonneg_ints)),
                output_tokens=draw(opt(nonneg_ints)),
                total_tokens=draw(opt(nonneg_ints)),
            )
        )
        if draw(st.booleans())
        else _UNSET
    )
    return models.CacheMetadata(
        **_omit_unset(
            status=draw(st.sampled_from(list(models.CacheStatus))),
            count=draw(opt(nonneg_ints)),
            threshold=draw(opt(pos_ints)),
            miss_reason=draw(opt(edge_strings)),
            tokens_saved=tokens_saved,
        )
    )


@st.composite
def stagehand_result_metadata_st(draw: st.DrawFn) -> models.StagehandResultMetadata:
    return models.StagehandResultMetadata(
        **_omit_unset(
            action_id=draw(opt(edge_strings)),
            cache=draw(cache_metadata_st()),
            usage=draw(stagehand_result_usage_st()),
        )
    )


@st.composite
def action_st(draw: st.DrawFn) -> models.Action:
    return models.Action(
        **_omit_unset(
            selector=draw(edge_strings),
            description=draw(edge_strings),
            method=draw(opt(edge_strings)),
            arguments=draw(opt(st.lists(edge_strings, max_size=3))),
        )
    )


@st.composite
def act_result_st(draw: st.DrawFn) -> models.ActResult:
    return models.ActResult(
        data=models.ActResultData(
            success=draw(st.booleans()),
            message=draw(edge_strings),
            action_description=draw(edge_strings),
            actions=draw(st.lists(action_st(), max_size=3)),
        ),
        metadata=draw(stagehand_result_metadata_st()),
    )


@st.composite
def observe_result_st(draw: st.DrawFn) -> models.ObserveResult:
    return models.ObserveResult(
        data=draw(st.lists(action_st(), max_size=3)),
        metadata=draw(stagehand_result_metadata_st()),
    )


@st.composite
def extract_result_st(draw: st.DrawFn) -> models.ExtractResult:
    return models.ExtractResult.model_validate({
        "data": draw(json_values),
        "metadata": draw(stagehand_result_metadata_st()).model_dump(
            mode="json", by_alias=True, exclude_unset=True
        ),
    })


@st.composite
def callback_batch_options_st(draw: st.DrawFn) -> models.CallbackBatchOptions:
    return models.CallbackBatchOptions(
        **_omit_unset(
            page_id=draw(opt(nonempty_strings)),
            timeout=draw(opt(st.integers(min_value=1, max_value=MAX_CALLBACK_BATCH_TIMEOUT_MS))),
        )
    )


@st.composite
def callback_batch_params_st(draw: st.DrawFn) -> models.CallbackBatchParams:
    payload: dict[str, Any] = {
        "callback_source": draw(nonempty_strings),
        "options": draw(callback_batch_options_st()).model_dump(mode="json", exclude_unset=True),
    }
    inp = draw(opt(json_values))
    if inp is not _UNSET:
        payload["input"] = inp
    return models.CallbackBatchParams.model_validate(payload)


@st.composite
def callback_batch_result_st(draw: st.DrawFn) -> models.CallbackBatchResult:
    payload: dict[str, Any] = {}
    val = draw(opt(json_values))
    if val is not _UNSET:
        payload["value"] = val
    return models.CallbackBatchResult.model_validate(payload)


@st.composite
def page_goto_params_st(draw: st.DrawFn) -> models.PageGotoParams:
    options = (
        models.PageNavigationOptions(
            **_omit_unset(
                wait_until=draw(opt(st.sampled_from(list(models.LoadState)))),
                timeout=draw(opt(pos_ints)),
            )
        )
        if draw(st.booleans())
        else _UNSET
    )
    return models.PageGotoParams(
        **_omit_unset(page_id=draw(edge_strings), url=draw(nonempty_strings), options=options)
    )


@st.composite
def page_click_params_st(draw: st.DrawFn) -> models.PageClickParams:
    options = (
        models.PageClickOptions(
            **_omit_unset(
                button=draw(opt(st.sampled_from(list(models.MouseButton)))),
                click_count=draw(opt(pos_ints)),
            )
        )
        if draw(st.booleans())
        else _UNSET
    )
    return models.PageClickParams(
        **_omit_unset(
            page_id=draw(edge_strings),
            x=draw(finite_floats),
            y=draw(finite_floats),
            options=options,
        )
    )


@st.composite
def page_drag_and_drop_params_st(draw: st.DrawFn) -> models.PageDragAndDropParams:
    options = (
        models.PageDragAndDropOptions(
            **_omit_unset(
                button=draw(opt(st.sampled_from(list(models.MouseButton)))),
                steps=draw(opt(pos_ints)),
                delay=draw(opt(nonneg_floats)),
                route=draw(
                    opt(
                        st.lists(
                            st.builds(
                                models.PageDragAndDropRoutePoint,
                                x=finite_floats,
                                y=finite_floats,
                            ),
                            max_size=3,
                        )
                    )
                ),
            )
        )
        if draw(st.booleans())
        else _UNSET
    )
    return models.PageDragAndDropParams(
        **_omit_unset(
            page_id=draw(edge_strings),
            from_x=draw(finite_floats),
            from_y=draw(finite_floats),
            to_x=draw(finite_floats),
            to_y=draw(finite_floats),
            options=options,
        )
    )


@st.composite
def page_screenshot_params_st(draw: st.DrawFn) -> models.PageScreenshotParams:
    if not draw(st.booleans()):
        return models.PageScreenshotParams(page_id=draw(edge_strings))
    layout = draw(st.sampled_from(["none", "full_page", "clip"]))
    img_type = draw(opt(st.sampled_from(list(models.Type))))
    opts_data: dict[str, Any] = _omit_unset(
        animations=draw(opt(st.sampled_from(list(models.Animations)))),
        caret=draw(opt(st.sampled_from(list(models.Caret)))),
        mask=draw(opt(st.lists(locator_request_descriptor_st(), max_size=2))),
        mask_color=draw(opt(edge_strings)),
        omit_background=draw(opt(st.booleans())),
        scale=draw(opt(st.sampled_from(list(models.Scale)))),
        style=draw(opt(edge_strings)),
        timeout=draw(opt(nonneg_floats)),
        type=img_type,
    )
    if layout == "full_page":
        opts_data["full_page"] = True
    elif layout == "clip":
        opts_data["clip"] = models.PageScreenshotClip(
            x=draw(finite_floats),
            y=draw(finite_floats),
            width=draw(pos_floats),
            height=draw(pos_floats),
        )
    if img_type == models.Type.jpeg:
        q = draw(opt(st.integers(min_value=0, max_value=100)))
        if q is not _UNSET:
            opts_data["quality"] = q
    return models.PageScreenshotParams(
        page_id=draw(edge_strings),
        options=models.PageScreenshotOptions(**opts_data),
    )


@st.composite
def page_pdf_params_st(draw: st.DrawFn) -> models.PagePDFParams:
    if not draw(st.booleans()):
        return models.PagePDFParams(page_id=draw(edge_strings))
    margin = (
        models.PagePDFMargin(
            **_omit_unset(
                top=draw(opt(nonneg_floats)),
                bottom=draw(opt(nonneg_floats)),
                left=draw(opt(nonneg_floats)),
                right=draw(opt(nonneg_floats)),
            )
        )
        if draw(st.booleans())
        else _UNSET
    )
    options = models.PagePDFOptions(
        **_omit_unset(
            landscape=draw(opt(st.booleans())),
            display_header_footer=draw(opt(st.booleans())),
            print_background=draw(opt(st.booleans())),
            scale=draw(
                opt(st.floats(min_value=0.1, max_value=2.0, allow_nan=False, allow_infinity=False))
            ),
            width=draw(opt(pos_floats)),
            height=draw(opt(pos_floats)),
            margin=margin,
            page_ranges=draw(opt(edge_strings)),
            header_template=draw(opt(edge_strings)),
            footer_template=draw(opt(edge_strings)),
            prefer_css_page_size=draw(opt(st.booleans())),
            tagged=draw(opt(st.booleans())),
            outline=draw(opt(st.booleans())),
            timeout=draw(
                opt(
                    st.floats(
                        min_value=0.0,
                        max_value=float(MAX_CALLBACK_BATCH_TIMEOUT_MS),
                        allow_nan=False,
                        allow_infinity=False,
                    ).map(_normalize_zero)
                )
            ),
        )
    )
    return models.PagePDFParams(page_id=draw(edge_strings), options=options)


@st.composite
def page_set_extra_http_headers_params_st(draw: st.DrawFn) -> models.PageSetExtraHTTPHeadersParams:
    return models.PageSetExtraHTTPHeadersParams(
        page_id=draw(edge_strings),
        headers=draw(string_maps),
    )


@st.composite
def context_set_extra_http_headers_params_st(
    draw: st.DrawFn,
) -> models.ContextSetExtraHTTPHeadersParams:
    return models.ContextSetExtraHTTPHeadersParams(headers=draw(string_maps))


@st.composite
def stagehand_init_params_st(draw: st.DrawFn) -> models.StagehandInitParams:
    use_bb = draw(st.booleans())
    telemetry = (
        models.TelemetryConfig(
            traces=models.TelemetryTraces(
                endpoint=draw(trace_endpoints),
                headers=draw(string_maps),
            )
        )
        if draw(st.booleans())
        else _UNSET
    )
    model_choice: Any = _UNSET
    if draw(st.booleans()):
        model_choice = (
            draw(model_config_st())
            if draw(st.booleans())
            else models.ClientModelReference(source="client")
        )
    data = _omit_unset(
        protocol_version=STAGEHAND_PROTOCOL_VERSION,
        client_info=models.ImplementationInfo(
            name=draw(nonempty_strings), version=draw(nonempty_strings)
        ),
        browser_cdp_url=draw(opt(nonempty_strings)),
        browserbase="client" if use_bb else _UNSET,
        browser=(
            models.BrowserSessionMetadata(
                **_omit_unset(
                    session_id=draw(nonempty_strings),
                    region=draw(opt(st.sampled_from(list(models.BrowserbaseRegion)))),
                )
            )
            if use_bb
            else _UNSET
        ),
        model=model_choice,
        telemetry=telemetry,
        log_level=draw(opt(st.sampled_from(list(models.LogLevel)))),
        system_prompt=draw(opt(edge_strings)),
        self_heal=draw(opt(st.booleans())),
        dom_settle_timeout_ms=draw(opt(pos_ints)),
    )
    return models.StagehandInitParams(**data)


@st.composite
def stagehand_extract_params_st(draw: st.DrawFn) -> models.StagehandExtractParams:
    payload: dict[str, Any] = {
        "page_id": draw(nonempty_strings),
        "instruction": draw(nonempty_strings),
    }
    schema = draw(opt(json_objects))
    if schema is not _UNSET:
        payload["schema"] = schema
    if draw(st.booleans()):
        opts = models.ExtractOptions(
            **_omit_unset(
                model=draw(opt(model_config_st())),
                timeout=draw(opt(finite_floats)),
                locator=draw(opt(locator_input_st())),
                screenshot=draw(opt(st.booleans())),
            )
        )
        payload["options"] = opts.model_dump(mode="json", by_alias=True, exclude_unset=True)
    return models.StagehandExtractParams.model_validate(payload)


@st.composite
def browserbase_request_result_st(draw: st.DrawFn) -> models.BrowserbaseRequestResult:
    if draw(st.booleans()):
        return models.BrowserbaseRequestResult(
            root=models.BrowserbaseHttpResponse(
                type="response",
                status=draw(st.integers(min_value=200, max_value=599)),
                status_text=draw(edge_strings),
                headers=draw(string_maps),
                body=draw(edge_strings),
            )
        )
    return models.BrowserbaseRequestResult(
        root=models.BrowserbaseTransportError(
            type="error",
            reason=draw(st.sampled_from(list(models.Reason))),
            message=draw(edge_strings),
        )
    )


@st.composite
def page_event_notification_st(draw: st.DrawFn) -> models.PageEventNotification:
    routing = {
        "subscription_id": draw(nonempty_strings),
        "page_id": draw(nonempty_strings),
        "session_id": draw(nonempty_strings),
        "target_id": draw(nonempty_strings),
    }
    kind = draw(st.sampled_from(["toolsadded", "toolsremoved", "response"]))
    if kind == "toolsadded":
        tool_payload: dict[str, Any] = {
            "name": draw(nonempty_strings),
            "description": draw(edge_strings),
            "frame_id": draw(nonempty_strings),
        }
        in_schema = draw(opt(json_objects))
        if in_schema is not _UNSET:
            tool_payload["input_schema"] = in_schema
        return models.PageEventNotification.model_validate({
            **routing,
            "event": "toolsadded",
            "tools": [tool_payload],
        })
    if kind == "toolsremoved":
        return models.PageEventNotification.model_validate({
            **routing,
            "event": "toolsremoved",
            "tools": [{"frame_id": draw(nonempty_strings), "name": draw(nonempty_strings)}],
        })
    return models.PageEventNotification.model_validate({
        **routing,
        "event": "response",
        "response": {
            "response_id": draw(nonempty_strings),
            "url": draw(edge_strings),
            "status": draw(nonneg_ints),
            "status_text": draw(edge_strings),
            "headers": draw(string_maps),
            "from_service_worker": draw(st.booleans()),
        },
    })


@st.composite
def llm_generate_params_st(draw: st.DrawFn) -> models.LLMGenerateParams:
    tool_json = models.LLMToolJson(
        **_omit_unset(
            field_schema=draw(opt(edge_strings)),
            type="object",
            required=draw(opt(st.lists(edge_strings, max_size=3))),
        )
    )
    msg = {
        "role": draw(st.sampled_from(["user", "assistant"])),
        "content": (
            {"type": "text", "text": draw(edge_strings)}
            if draw(st.booleans())
            else {
                "type": "image",
                "data": draw(base64_strings),
                "mime_type": draw(edge_strings),
            }
        ),
    }
    if draw(st.booleans()):
        payload: dict[str, Any] = {
            "messages": [msg],
            "response_format": {
                "type": "json_schema",
                "name": draw(edge_strings),
                "schema": draw(json_objects),
            },
        }
    else:
        payload = {
            "messages": [msg],
            "tools": [
                {
                    "name": draw(edge_strings),
                    "input_schema": tool_json.model_dump(
                        mode="json", by_alias=True, exclude_unset=True
                    ),
                }
            ],
            "response_format": {"type": "text"},
        }
    return models.LLMGenerateParams.model_validate(payload)


@st.composite
def jsonrpc_request_st(draw: st.DrawFn) -> _JSONRPCRequest:
    params = draw(opt(st.one_of(json_objects, st.lists(json_values, max_size=3))))
    return _JSONRPCRequest(
        **_omit_unset(
            jsonrpc="2.0",
            id=draw(request_ids),
            method=draw(edge_strings),
            params=params,
            traceparent=draw(opt(edge_strings)),
            tracestate=draw(opt(edge_strings)),
        )
    )


@st.composite
def jsonrpc_notification_st(draw: st.DrawFn) -> _JSONRPCNotification:
    params = draw(opt(st.one_of(json_objects, st.lists(json_values, max_size=3))))
    return _JSONRPCNotification(
        **_omit_unset(jsonrpc="2.0", method=draw(edge_strings), params=params)
    )


@st.composite
def jsonrpc_success_response_st(draw: st.DrawFn) -> _JSONRPCSuccessResponse:
    return _JSONRPCSuccessResponse(
        jsonrpc="2.0",
        id=draw(request_ids),
        result=draw(json_values),
    )


@st.composite
def jsonrpc_error_response_st(draw: st.DrawFn) -> _JSONRPCErrorResponse:
    err_kwargs = _omit_unset(
        code=draw(safe_ints),
        message=draw(edge_strings),
        data=draw(opt(json_values)),
    )
    return _JSONRPCErrorResponse(
        jsonrpc="2.0",
        id=draw(st.one_of(st.none(), request_ids)),
        error=_JSONRPCError(**err_kwargs),
    )


MODEL_STRATEGY_CASES: list[tuple[str, type[BaseModel], st.SearchStrategy[BaseModel], set[str]]] = [
    ("LocatorChain", models.LocatorChain, locator_chain_st(), set()),
    ("LocatorInput", models.LocatorInput, locator_input_st(), set()),
    (
        "LocatorRequestDescriptor",
        models.LocatorRequestDescriptor,
        locator_request_descriptor_st(),
        set(),
    ),
    ("LocatorParams", models.LocatorParams, locator_params_st(), set()),
    ("LocatorClickParams", models.LocatorClickParams, locator_click_params_st(), set()),
    ("DomainPolicy", models.DomainPolicy, domain_policy_st(), set()),
    (
        "ContextSetDomainPolicyParams",
        models.ContextSetDomainPolicyParams,
        context_set_domain_policy_params_st(),
        set(),
    ),
    ("StagehandResultUsage", models.StagehandResultUsage, stagehand_result_usage_st(), set()),
    ("CacheMetadata", models.CacheMetadata, cache_metadata_st(), set()),
    (
        "StagehandResultMetadata",
        models.StagehandResultMetadata,
        stagehand_result_metadata_st(),
        set(),
    ),
    ("ActResult", models.ActResult, act_result_st(), set()),
    ("ObserveResult", models.ObserveResult, observe_result_st(), set()),
    ("ExtractResult", models.ExtractResult, extract_result_st(), {"data"}),
    ("CallbackBatchOptions", models.CallbackBatchOptions, callback_batch_options_st(), set()),
    ("CallbackBatchParams", models.CallbackBatchParams, callback_batch_params_st(), {"input"}),
    ("CallbackBatchResult", models.CallbackBatchResult, callback_batch_result_st(), {"value"}),
    ("PageGotoParams", models.PageGotoParams, page_goto_params_st(), set()),
    ("PageClickParams", models.PageClickParams, page_click_params_st(), set()),
    ("PageDragAndDropParams", models.PageDragAndDropParams, page_drag_and_drop_params_st(), set()),
    ("PageScreenshotParams", models.PageScreenshotParams, page_screenshot_params_st(), set()),
    ("PagePDFParams", models.PagePDFParams, page_pdf_params_st(), set()),
    (
        "PageSetExtraHTTPHeadersParams",
        models.PageSetExtraHTTPHeadersParams,
        page_set_extra_http_headers_params_st(),
        {"headers"},
    ),
    (
        "ContextSetExtraHTTPHeadersParams",
        models.ContextSetExtraHTTPHeadersParams,
        context_set_extra_http_headers_params_st(),
        {"headers"},
    ),
    ("StagehandInitParams", models.StagehandInitParams, stagehand_init_params_st(), {"headers"}),
    (
        "StagehandExtractParams",
        models.StagehandExtractParams,
        stagehand_extract_params_st(),
        {"schema", "headers"},
    ),
    (
        "BrowserbaseRequestResult",
        models.BrowserbaseRequestResult,
        browserbase_request_result_st(),
        {"headers"},
    ),
    (
        "PageEventNotification",
        models.PageEventNotification,
        page_event_notification_st(),
        {"input_schema", "headers"},
    ),
    (
        "LLMGenerateParams",
        models.LLMGenerateParams,
        llm_generate_params_st(),
        {"schema", "input", "structured_content", "properties"},
    ),
]


def _assert_protocol_keys_are_wire_cased(
    value: object,
    opaque_keys: set[str],
    path: str = "$",
) -> None:
    if isinstance(value, list):
        for index, item in enumerate(value):
            _assert_protocol_keys_are_wire_cased(item, opaque_keys, f"{path}[{index}]")
        return
    if not isinstance(value, dict):
        return
    for key, child in value.items():
        assert SNAKE_CASE_KEY.fullmatch(key), (
            f"Non-wire-cased protocol key {key!r} at {path} (expected snake_case or $schema)"
        )
        if key not in opaque_keys:
            _assert_protocol_keys_are_wire_cased(child, opaque_keys, f"{path}.{key}")


@pytest.mark.parametrize(
    ("name", "model_cls", "strategy", "opaque_keys"),
    MODEL_STRATEGY_CASES,
    ids=[case[0] for case in MODEL_STRATEGY_CASES],
)
def test_python_model_wire_roundtrip_and_casing(
    name: str,
    model_cls: type[BaseModel],
    strategy: st.SearchStrategy[BaseModel],
    opaque_keys: set[str],
) -> None:
    @DEFAULT_SETTINGS
    @given(instance=strategy)
    def _check(instance: BaseModel) -> None:
        wire_dict = instance.model_dump(mode="json", by_alias=True, exclude_unset=True)
        wire_json = instance.model_dump_json(by_alias=True, exclude_unset=True, warnings="none")
        assert json.loads(wire_json) == wire_dict

        _assert_protocol_keys_are_wire_cased(wire_dict, opaque_keys)

        reparsed = model_cls.model_validate_json(wire_json, strict=True)
        reparsed_dict = reparsed.model_dump(mode="json", by_alias=True, exclude_unset=True)
        reparsed_json = reparsed.model_dump_json(by_alias=True, exclude_unset=True, warnings="none")
        assert reparsed_dict == wire_dict
        assert model_cls.model_validate_json(reparsed_json, strict=True) == reparsed

    _check()


@DEFAULT_SETTINGS
@given(instance=stagehand_extract_params_st())
def test_schema_alias_serializes_as_schema_not_schema_underscore(
    instance: models.StagehandExtractParams,
) -> None:
    wire = instance.model_dump(mode="json", by_alias=True, exclude_unset=True)
    assert "schema" in wire
    assert "schema_" not in wire


@DEFAULT_SETTINGS
@given(instance=llm_generate_params_st())
def test_llm_generate_aliases_serialize_dollar_schema_and_schema(
    instance: models.LLMGenerateParams,
) -> None:
    wire = instance.model_dump(mode="json", by_alias=True, exclude_unset=True)
    if wire["response_format"]["type"] == "json_schema":
        assert "schema" in wire["response_format"]
        assert "schema_" not in wire["response_format"]
    if "tools" in wire:
        for tool in wire["tools"]:
            assert "field_schema" not in tool["input_schema"]


@pytest.mark.parametrize(
    ("envelope_cls", "strategy"),
    [
        (_JSONRPCRequest, jsonrpc_request_st()),
        (_JSONRPCNotification, jsonrpc_notification_st()),
        (_JSONRPCSuccessResponse, jsonrpc_success_response_st()),
        (_JSONRPCErrorResponse, jsonrpc_error_response_st()),
    ],
    ids=["request", "notification", "success_response", "error_response"],
)
def test_jsonrpc_envelope_roundtrip(
    envelope_cls: type[BaseModel],
    strategy: st.SearchStrategy[BaseModel],
) -> None:
    @DEFAULT_SETTINGS
    @given(envelope=strategy)
    def _check(envelope: BaseModel) -> None:
        wire_json = envelope.model_dump_json(by_alias=True, exclude_unset=True, warnings="none")
        reparsed = envelope_cls.model_validate_json(wire_json, strict=True)
        assert reparsed == envelope

    _check()


@DEFAULT_SETTINGS
@given(
    bad_kind=edge_strings.filter(lambda s: s not in {"css", "xpath", "text"}),
    value=nonempty_strings,
)
def test_rejects_unknown_locator_query_selector_kind(bad_kind: str, value: str) -> None:
    with pytest.raises(ValidationError):
        models.LocatorQuerySelector.model_validate_json(
            json.dumps({"kind": bad_kind, "value": value}), strict=True
        )


@DEFAULT_SETTINGS
@given(
    bad_event=edge_strings.filter(lambda s: s not in {"toolsadded", "toolsremoved", "response"}),
)
def test_rejects_unknown_page_event_notification_variant(bad_event: str) -> None:
    with pytest.raises(ValidationError):
        models.PageEventNotification.model_validate_json(
            json.dumps({
                "subscription_id": "s1",
                "page_id": "p1",
                "session_id": "sess1",
                "target_id": "t1",
                "event": bad_event,
                "tools": [],
            }),
            strict=True,
        )


@DEFAULT_SETTINGS
@given(
    bad_type=edge_strings.filter(lambda s: s not in {"response", "error"}),
)
def test_rejects_unknown_browserbase_result_variant(bad_type: str) -> None:
    with pytest.raises(ValidationError):
        models.BrowserbaseRequestResult.model_validate_json(
            json.dumps({"type": bad_type, "reason": "network", "message": "x"}), strict=True
        )


@DEFAULT_SETTINGS
@given(
    extra_key=st.from_regex(r"[a-z][a-z0-9_]{2,12}", fullmatch=True).filter(
        lambda k: k not in {"allowed_domains", "blocked_domains"}
    ),
    extra_value=json_values,
)
def test_rejects_extra_fields_on_strict_models(extra_key: str, extra_value: object) -> None:
    with pytest.raises(ValidationError):
        models.DomainPolicy.model_validate_json(json.dumps({extra_key: extra_value}), strict=True)


def _parse_semver_dir_name(name: str) -> tuple[int, ...]:
    parts: list[int] = []
    for segment in name.lstrip("v").split("."):
        if segment.isdigit():
            parts.append(int(segment))
        else:
            break
    return tuple(parts)


def _find_node_env() -> dict[str, str]:
    env = dict(os.environ)
    if shutil.which("node") is not None:
        return env
    nvm_node_dir = Path.home() / ".nvm" / "versions" / "node"
    if nvm_node_dir.is_dir():
        versions = sorted(
            (entry for entry in nvm_node_dir.iterdir() if entry.is_dir()),
            key=lambda entry: _parse_semver_dir_name(entry.name),
            reverse=True,
        )
        for version_dir in versions:
            bin_dir = version_dir / "bin"
            if (bin_dir / "node").exists():
                env["PATH"] = f"{bin_dir}:{env.get('PATH', '')}"
                break
    return env


class _TsWireBridge:
    def __init__(self) -> None:
        self._proc = subprocess.Popen(
            [str(TSX_BIN), str(TS_BRIDGE_SCRIPT)],
            cwd=str(PROTOCOL_DIR),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=_find_node_env(),
        )

    def request(self, payload: dict[str, Any]) -> dict[str, Any]:
        assert self._proc.stdin is not None and self._proc.stdout is not None
        self._proc.stdin.write(json.dumps(payload, separators=(",", ":")) + "\n")
        self._proc.stdin.flush()
        line = self._proc.stdout.readline()
        if not line:
            stderr = self._proc.stderr.read() if self._proc.stderr is not None else ""
            raise RuntimeError(f"TS wire bridge terminated unexpectedly:\n{stderr}")
        return json.loads(line)

    def run_batch(self, requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [self.request(entry) for entry in requests]

    def close(self) -> None:
        if self._proc.poll() is None:
            if self._proc.stdin is not None and not self._proc.stdin.closed:
                self._proc.stdin.close()
            try:
                self._proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._proc.kill()
                self._proc.wait(timeout=5)


@pytest.fixture(scope="session")
def ts_bridge() -> Iterator[_TsWireBridge]:
    bridge = _TsWireBridge()
    try:
        yield bridge
    finally:
        bridge.close()


def _json_structurally_equal(left: object, right: object) -> bool:
    if type(left) is bool or type(right) is bool:
        return type(left) is type(right) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return math.isclose(left, right, rel_tol=0.0, abs_tol=0.0)
    if type(left) is not type(right):
        return False
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(
            _json_structurally_equal(a, b) for a, b in zip(left, right, strict=True)
        )
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(
            _json_structurally_equal(left[k], right[k]) for k in left
        )
    return bool(left == right)


def _core_schema_has_custom_validator(schema: object) -> bool:
    if isinstance(schema, dict):
        if schema.get("type") in {
            "function-after",
            "function-before",
            "function-wrap",
            "function-plain",
        }:
            return True
        return any(_core_schema_has_custom_validator(value) for value in schema.values())
    if isinstance(schema, list):
        return any(_core_schema_has_custom_validator(item) for item in schema)
    return False


def test_python_hypothesis_wire_json_roundtrips_through_ts_zod(ts_bridge: _TsWireBridge) -> None:
    samples_per_model = 10
    batch_meta: list[tuple[str, type[BaseModel], str, Any]] = []

    for name, model_cls, strategy, _opaque_keys in MODEL_STRATEGY_CASES:
        drawn: list[BaseModel] = []

        @settings(
            max_examples=samples_per_model,
            deadline=None,
            database=None,
            suppress_health_check=[HealthCheck.too_slow],
        )
        @given(item=strategy)
        def _collect(item: BaseModel) -> None:
            drawn.append(item)

        _collect()

        for instance in drawn:
            raw_json = instance.model_dump_json(by_alias=True, exclude_unset=True, warnings="none")
            batch_meta.append((name, model_cls, raw_json, json.loads(raw_json)))

    responses = ts_bridge.run_batch([
        {"schema": name, "rawJson": raw_json} for name, _, raw_json, _ in batch_meta
    ])
    assert len(responses) == len(batch_meta)

    for (name, model_cls, py_raw_json, py_wire), ts_resp in zip(batch_meta, responses, strict=True):
        assert ts_resp["ok"], (
            f"TS Zod rejected Python-generated wire JSON for {name}:\n"
            f"pyWire={py_raw_json}\n"
            f"tsError={ts_resp.get('error')}"
        )
        ts_wire = ts_resp["wire"]
        assert _json_structurally_equal(ts_wire, py_wire), (
            f"Python -> TS -> wire drifted for {name}:\n"
            f"pyWire={py_raw_json}\n"
            f"tsWire={json.dumps(ts_wire)}"
        )
        reparsed_py = model_cls.model_validate_json(
            json.dumps(ts_wire, separators=(",", ":")), strict=True
        )
        assert _json_structurally_equal(
            reparsed_py.model_dump(mode="json", by_alias=True, exclude_unset=True),
            py_wire,
        )


def test_python_jsonrpc_envelopes_roundtrip_through_ts_zod(ts_bridge: _TsWireBridge) -> None:
    envelope_specs: list[tuple[str, type[BaseModel], st.SearchStrategy[BaseModel]]] = [
        ("JSONRPCRequest", _JSONRPCRequest, jsonrpc_request_st()),
        ("JSONRPCNotification", _JSONRPCNotification, jsonrpc_notification_st()),
        ("JSONRPCSuccessResponse", _JSONRPCSuccessResponse, jsonrpc_success_response_st()),
        ("JSONRPCErrorResponse", _JSONRPCErrorResponse, jsonrpc_error_response_st()),
    ]
    batch_meta: list[tuple[str, type[BaseModel], str, Any]] = []

    for ts_schema_name, model_cls, strategy in envelope_specs:
        drawn: list[BaseModel] = []

        @settings(
            max_examples=15,
            deadline=None,
            database=None,
            suppress_health_check=[HealthCheck.too_slow],
        )
        @given(item=strategy)
        def _collect(item: BaseModel) -> None:
            drawn.append(item)

        _collect()

        for instance in drawn:
            raw_json = instance.model_dump_json(by_alias=True, exclude_unset=True, warnings="none")
            batch_meta.append((ts_schema_name, model_cls, raw_json, json.loads(raw_json)))

    responses = ts_bridge.run_batch([
        {"schema": name, "rawJson": raw_json} for name, _, raw_json, _ in batch_meta
    ])
    assert len(responses) == len(batch_meta)

    for (name, model_cls, py_raw_json, py_wire), ts_resp in zip(batch_meta, responses, strict=True):
        assert ts_resp["ok"], (
            f"TS {name} rejected Python envelope:\n"
            f"pyWire={py_raw_json}\n"
            f"tsError={ts_resp.get('error')}"
        )
        assert _json_structurally_equal(ts_resp["wire"], py_wire)
        model_cls.model_validate_json(
            json.dumps(ts_resp["wire"], separators=(",", ":")), strict=True
        )


def test_ts_fastcheck_wire_json_roundtrips_through_python_pydantic(
    ts_bridge: _TsWireBridge,
) -> None:
    sampled = ts_bridge.request({
        "op": "sample_protocol_cases",
        "samplesPerSchema": 12,
        "seed": 20261124,
    })
    assert sampled["ok"], f"Failed sampling TS protocol cases: {sampled.get('error')}"
    samples = sampled["samples"]
    assert len(samples) > 0

    for sample in samples:
        name: str = sample["name"]
        python_model: str = sample["pythonModel"]
        ts_wire_json: str = sample["rawJson"]
        model_cls = resolve_model(python_model)
        parsed = model_cls.model_validate_json(ts_wire_json, strict=True)
        py_wire_json = parsed.model_dump_json(
            by_alias=True,
            exclude_unset=True,
            warnings="none",
        )
        verified = ts_bridge.request({
            "op": "verify_roundtrip",
            "schema": name,
            "expectedWireJson": ts_wire_json,
            "actualWireJson": py_wire_json,
        })
        assert verified["ok"], (
            f"TS -> Python -> TS round-trip drifted for {name} ({python_model}):\n"
            f"tsWire={ts_wire_json}\n"
            f"pyWire={py_wire_json}\n"
            f"error={verified.get('error')}"
        )


def test_ts_fastcheck_jsonrpc_envelopes_roundtrip_through_python_rpc(
    ts_bridge: _TsWireBridge,
) -> None:
    sampled = ts_bridge.request({
        "op": "sample_envelope_cases",
        "samplesPerEnvelope": 20,
        "seed": 20261125,
    })
    assert sampled["ok"], f"Failed sampling TS envelope cases: {sampled.get('error')}"
    samples = sampled["samples"]
    assert len(samples) > 0

    for sample in samples:
        name: str = sample["name"]
        python_model: str = sample["pythonModel"]
        ts_raw_json: str = sample["rawJson"]
        model_cls = resolve_model(python_model)
        parsed = model_cls.model_validate_json(ts_raw_json, strict=True)
        py_wire_json = parsed.model_dump_json(
            by_alias=True,
            exclude_unset=True,
            warnings="none",
        )
        verified = ts_bridge.request({
            "op": "verify_roundtrip",
            "schema": name,
            "expectedWireJson": ts_raw_json,
            "actualWireJson": py_wire_json,
        })
        assert verified["ok"], (
            f"TS -> Python -> TS envelope round-trip drifted for {name} ({python_model}):\n"
            f"tsWire={ts_raw_json}\n"
            f"pyWire={py_wire_json}\n"
            f"error={verified.get('error')}"
        )


def test_cross_sdk_curated_boundary_validation_parity(ts_bridge: _TsWireBridge) -> None:
    parity_cases: list[tuple[str, type[BaseModel], dict[str, Any], bool]] = [
        ("DomainPolicy", models.DomainPolicy, {}, True),
        ("DomainPolicy", models.DomainPolicy, {"allowed_domains": ["example.com"]}, True),
        ("StagehandResultUsage", models.StagehandResultUsage, {}, True),
        ("CallbackBatchOptions", models.CallbackBatchOptions, {}, True),
        (
            "PageScreenshotOptions",
            models.PageScreenshotOptions,
            {"full_page": True, "clip": {"x": 0, "y": 0, "width": 10, "height": 10}},
            False,
        ),
        (
            "PageScreenshotOptions",
            models.PageScreenshotOptions,
            {"type": "png", "quality": 80},
            False,
        ),
        (
            "StagehandInitParams",
            models.StagehandInitParams,
            {
                "protocol_version": STAGEHAND_PROTOCOL_VERSION,
                "client_info": {"name": "sdk", "version": "1.0.0"},
                "browserbase": "client",
            },
            False,
        ),
        (
            "TelemetryConfig",
            models.TelemetryConfig,
            {"traces": {"endpoint": "https://example.com/not-traces"}},
            False,
        ),
    ]

    ts_results = ts_bridge.run_batch([
        {"schema": schema_name, "rawJson": json.dumps(payload, separators=(",", ":"))}
        for schema_name, _, payload, _ in parity_cases
    ])

    for (schema_name, model_cls, payload, expected_valid), ts_res in zip(
        parity_cases, ts_results, strict=True
    ):
        try:
            model_cls.model_validate_json(json.dumps(payload, separators=(",", ":")), strict=True)
            py_ok = True
        except ValidationError:
            py_ok = False
        assert py_ok is expected_valid, f"Python {schema_name} unexpected verdict on {payload}"
        assert ts_res["ok"] is expected_valid, f"TS {schema_name} unexpected verdict on {payload}"


def test_llm_generate_result_tool_use_input_key_preservation(ts_bridge: _TsWireBridge) -> None:
    payload = {
        "role": "assistant",
        "content": {
            "type": "tool_use",
            "id": "call_1",
            "name": "search",
            "input": {"camelArg": 1, "snake_arg": 2},
        },
        "output_format": "text",
    }
    raw_json = json.dumps(payload, separators=(",", ":"))
    py_wire = json.loads(
        models.LLMGenerateResult.model_validate_json(raw_json, strict=True).model_dump_json(
            by_alias=True, exclude_unset=True
        )
    )
    ts_res = ts_bridge.request({"schema": "LLMGenerateResult", "rawJson": raw_json})
    assert ts_res["ok"]
    assert ts_res["wire"] == py_wire


def test_opaque_map_dunder_proto_key_contract(ts_bridge: _TsWireBridge) -> None:
    payload = {"headers": {"__proto__": "evil", "X-Ok": "1"}}
    raw_json = json.dumps(payload, separators=(",", ":"))
    py_wire = json.loads(
        models.ContextSetExtraHTTPHeadersParams.model_validate_json(
            raw_json, strict=True
        ).model_dump_json(by_alias=True, exclude_unset=True)
    )
    ts_res = ts_bridge.request({"schema": "ContextSetExtraHTTPHeadersParams", "rawJson": raw_json})
    assert py_wire == {"headers": {"__proto__": "evil", "X-Ok": "1"}}
    assert ts_res["ok"]
    assert ts_res["wire"] == {"headers": {"X-Ok": "1"}}


@pytest.mark.xfail(
    strict=True,
    reason=(
        "Optionality drift: generated Python Optional[T] = None fields accept and re-emit JSON "
        "null, whereas TS Zod .optional() rejects null."
    ),
)
@pytest.mark.parametrize(
    ("schema_name", "model_cls", "payload"),
    [
        ("DomainPolicy", models.DomainPolicy, {"allowed_domains": None}),
        (
            "PageGotoParams",
            models.PageGotoParams,
            {"page_id": "p1", "url": "https://example.com", "options": None},
        ),
        ("PageScreenshotOptions", models.PageScreenshotOptions, {"type": "jpeg", "quality": None}),
    ],
    ids=["DomainPolicy.allowed_domains", "PageGotoParams.options", "PageScreenshotOptions.quality"],
)
def test_xfail_optional_non_nullable_null_parity(
    ts_bridge: _TsWireBridge,
    schema_name: str,
    model_cls: type[BaseModel],
    payload: dict[str, Any],
) -> None:
    raw_json = json.dumps(payload, separators=(",", ":"))
    try:
        model_cls.model_validate_json(raw_json, strict=True)
        py_ok = True
    except ValidationError:
        py_ok = False
    ts_ok = ts_bridge.request({"schema": schema_name, "rawJson": raw_json})["ok"]
    assert py_ok == ts_ok


@pytest.mark.xfail(
    strict=True,
    reason=(
        "Missing superRefine in Python: CookieParam lacks cross-field URL/domain+path, expires, "
        "and sameSite=None+secure validation enforced by TS CookieParamSchema."
    ),
)
@pytest.mark.parametrize(
    "payload",
    [
        {"name": "a", "value": "b"},
        {"name": "a", "value": "b", "url": "https://example.com", "domain": "example.com"},
        {"name": "a", "value": "b", "url": "https://example.com", "expires": -2},
        {"name": "a", "value": "b", "url": "about:blank"},
        {"name": "a", "value": "b", "domain": "example.com", "path": "/", "same_site": "None"},
    ],
    ids=["missing_scope", "url_and_domain", "negative_expires", "about_blank", "samesite_none"],
)
def test_xfail_cookie_param_super_refine_parity(
    ts_bridge: _TsWireBridge,
    payload: dict[str, Any],
) -> None:
    raw_json = json.dumps(payload, separators=(",", ":"))
    try:
        models.CookieParam.model_validate_json(raw_json, strict=True)
        py_ok = True
    except ValidationError:
        py_ok = False
    ts_ok = ts_bridge.request({"schema": "CookieParam", "rawJson": raw_json})["ok"]
    assert py_ok == ts_ok


@pytest.mark.xfail(
    strict=True,
    reason=(
        "Missing superRefine in Python: CookieRegex does not validate JS RegExp syntax or reject "
        "duplicate flags."
    ),
)
@pytest.mark.parametrize(
    "payload",
    [{"source": "["}, {"source": "a", "flags": "ii"}],
    ids=["invalid_syntax", "duplicate_flags"],
)
def test_xfail_cookie_regex_super_refine_parity(
    ts_bridge: _TsWireBridge,
    payload: dict[str, Any],
) -> None:
    raw_json = json.dumps(payload, separators=(",", ":"))
    try:
        models.CookieRegex.model_validate_json(raw_json, strict=True)
        py_ok = True
    except ValidationError:
        py_ok = False
    ts_ok = ts_bridge.request({"schema": "CookieRegex", "rawJson": raw_json})["ok"]
    assert py_ok == ts_ok


@pytest.mark.xfail(
    strict=True,
    reason=(
        "50 MiB+1 base64 boundary drift: Python only checks max_length=69905068, accepting a "
        "52,428,801-byte unpadded payload that TS InputFilePayloadSchema.refine rejects."
    ),
)
def test_xfail_input_file_payload_50mib_plus_one_boundary() -> None:
    data_schema = models.InputFilePayload.model_json_schema()["properties"]["data"]
    assert data_schema["maxLength"] == 69_905_068
    assert _core_schema_has_custom_validator(models.InputFilePayload.__pydantic_core_schema__)
