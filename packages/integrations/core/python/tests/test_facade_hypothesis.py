from __future__ import annotations

import base64
import json
import math
import subprocess
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from stagehand_middleware.facade._syntax import _preceded_by_line_break_only, check_run_syntax
from stagehand_middleware.facade.bundle import (
    StagehandFacadeBundleError,
    canonical_json,
    contract_error,
    facade_bundle,
    parse_bundle,
)
from stagehand_middleware.facade.tools import (
    StagehandFacadeInputError,
    _check_artifact,
    _decoded_base64_length,
    _is_run_envelope,
    _json_value_bytes,
    sanitize_error_message,
)

CORE_DIR = Path(__file__).resolve().parents[2]
BUNDLE = facade_bundle()
PRELUDE: str = BUNDLE["sources"]["runPrelude"]
EPILOGUE: str = BUNDLE["sources"]["runEpilogue"]

_ESCAPE_PAYLOAD = (
    "})(); } catch {} }, (globalThis.__fvEsc = 1), "
    "async function y(batchStagehand,input){ "
    "let value, executionError, runtime, __stagehandBatchStartedAt; "
    "try { value = await (async () => {"
)

_JSON_VALUE: st.SearchStrategy[Any] = st.recursive(
    st.none()
    | st.booleans()
    | st.integers(min_value=-(2**53) + 1, max_value=2**53 - 1)
    | st.floats(allow_nan=False, allow_infinity=False, width=64)
    | st.text(max_size=30),
    lambda children: (
        st.lists(children, max_size=5) | st.dictionaries(st.text(max_size=12), children, max_size=5)
    ),
    max_leaves=12,
)

_CANARY = st.from_regex(r"CANARY_[A-Za-z0-9_-]{10,20}", fullmatch=True)


def _node_eval(
    script: str, payload: object, *, esm: bool = False, strip_types: bool = False
) -> Any:  # noqa: ANN401 - JSON IPC
    cmd = ["node"]
    if strip_types:
        cmd.append("--experimental-strip-types")
    if esm:
        cmd.append("--input-type=module")
    cmd.extend(["-e", script])
    completed = subprocess.run(
        cmd,
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=True,
        cwd=CORE_DIR,
    )
    return json.loads(completed.stdout)


@settings(max_examples=200)
@given(
    code=st.one_of(
        st.text(max_size=120),
        st.text(alphabet=st.characters(), max_size=80),
        st.sampled_from([
            "return '\ud800';",
            "\ud800",
            "\udfff",
            "return <div/>;",
            "return <></>;",
            "--> x\nreturn 1;",
            "  --> x\nreturn 1;",
            "return /a\rb/;",
            "<!-- hi\r" + _ESCAPE_PAYLOAD,
            "x = 1\n--> hi\r" + _ESCAPE_PAYLOAD,
        ]),
    )
)
def test_check_run_syntax_never_crashes_on_arbitrary_unicode_or_surrogates(code: str) -> None:
    try:
        check_run_syntax(code)
    except SyntaxError:
        pass


@settings(max_examples=80)
@given(
    comment_opener=st.sampled_from(["// ", "<!-- ", "x = 1\n--> "]),
    terminator=st.sampled_from(["\n", "\r", "\r\n", "\u2028", "\u2029"]),
    padding=st.text(alphabet="abc123 \t", max_size=12),
)
def test_check_run_syntax_blocks_callback_escape_across_all_line_terminators(
    comment_opener: str, terminator: str, padding: str
) -> None:
    malicious = f"{comment_opener}{padding}{terminator}{_ESCAPE_PAYLOAD}"
    with pytest.raises(SyntaxError):
        check_run_syntax(malicious)


@settings(max_examples=50)
@given(
    prefix=st.sampled_from(["", " ", "\t", "/* ok */ "]),
    rest=st.text(alphabet="abc123; \n", max_size=30),
)
def test_check_run_syntax_rejects_leading_html_close_comment_matching_v8_prelude(
    prefix: str, rest: str
) -> None:
    with pytest.raises(SyntaxError):
        check_run_syntax(f"{prefix}-->{rest}")


def test_check_run_syntax_uses_ecmascript_whitespace_for_html_close_comment() -> None:
    bom_sample = b"x = 1\n\xef\xbb\xbf--> bom whitespace comment\nreturn 1;"
    assert _preceded_by_line_break_only(bom_sample, 0, bom_sample.index(b"-->"))
    nel_sample = "x = 1\n\u0085--> nel is not ecma whitespace\nreturn 1;".encode()
    assert not _preceded_by_line_break_only(nel_sample, 0, nel_sample.index(b"-->"))
    with pytest.raises(SyntaxError):
        check_run_syntax("x = 1\n\u0085--> nel is not ecma whitespace\nreturn 1;")


def test_check_run_syntax_matches_v8_non_escape_on_adversarial_corpus() -> None:
    corpus = [
        "return 1;",
        "await page.goto('https://example.com'); return await page.title();",
        "return [1, 2, 3].map((x) => x * 2);",
        "const f = async () => { return 42; }; return await f();",
        "<!-- hi\r" + _ESCAPE_PAYLOAD,
        "x = 1\n--> hi\r" + _ESCAPE_PAYLOAD,
        "<!-- hi\u2028" + _ESCAPE_PAYLOAD,
        "--> x\nreturn 1;",
        "return /a\rb/;",
        "return <>hello</>;",
        "return <div/>;",
        "return '\ud800';",
        "x = 1\n\ufeff--> ok\nreturn 1;",
        "x = 1\n\u0085--> bad\nreturn 1;",
    ]
    accepted = []
    for code in corpus:
        try:
            check_run_syntax(code)
            accepted.append(code)
        except SyntaxError:
            pass

    results = _node_eval(
        """
        const fs = require("fs");
        const { prelude, epilogue, accepted } = JSON.parse(fs.readFileSync(0, "utf8"));
        const out = accepted.map((code) => {
          globalThis.__fvEsc = 0;
          try {
            new Function("return (" + prelude + code + epilogue + ");")();
            return { ok: true, escaped: globalThis.__fvEsc };
          } catch (e) {
            return { ok: false, name: e.name, escaped: globalThis.__fvEsc };
          }
        });
        console.log(JSON.stringify(out));
        """,
        {"prelude": PRELUDE, "epilogue": EPILOGUE, "accepted": accepted},
    )
    for code, res in zip(accepted, results, strict=True):
        assert res["ok"], f"Python accepted code rejected by V8 wrapper: {code!r} -> {res}"
        assert res["escaped"] == 0, f"V8 sandbox escape on accepted code: {code!r}"


@settings(max_examples=150)
@given(
    param=st.sampled_from(["signingKey", "apiKey", "api_key", "token", "key"]),
    sk_prefix=st.from_regex(r"[A-Za-z0-9_-]{6}", fullmatch=True),
    bb_prefix=st.from_regex(r"[A-Za-z0-9_-]{4}", fullmatch=True),
    bb_kind=st.sampled_from(["bb_live_", "bb_test_"]),
    canary=_CANARY,
)
def test_sanitize_error_message_non_interference_and_idempotency(
    param: str, sk_prefix: str, bb_prefix: str, bb_kind: str, canary: str
) -> None:
    samples = [
        f"https://example.test/ws?{param}={canary}&ok=1",
        f"https://example.test/ws?{param}=prefix\\{canary}&ok=1",
        f"redirect=https%3A%2F%2Fexample.test%3F{param}%3D{canary}%26ok%3D1",
        f"redirect=https%3A%2F%2Fexample.test%3F{param}%3Dpart1%20%22{canary}%27%26ok%3D1",
        f"key sk-{sk_prefix}{canary}",
        f"key {bb_kind}{bb_prefix}{canary}",
        f"key AIza{'0' * 16}{canary}",
        f"Authorization: Bearer tok%2F{canary}",
        f"Authorization: Bearer sk-{sk_prefix}{canary}",
        f"Authorization: Bearer {bb_kind}{bb_prefix}{canary}",
    ]
    for sample in samples:
        once = sanitize_error_message(sample)
        assert canary not in once
        assert "[redacted][redacted]" not in once
        assert sanitize_error_message(once) == once


def test_sanitize_error_message_matches_typescript_implementation() -> None:
    samples = [
        "https://api.test/v1?apiKey=abc123&key=k9&token=tok_456",
        "https://api.test/v1?token=prefix\\secret123&ok=1",
        '{"url":"https://api.test/v1?signingKey=secret123"}',
        '{\\"url\\":\\"https://api.test/v1?apiKey=secret123\\"}',
        '{"url":"https://api.test/v1?token=abc\\\\"}',
        "redirect=https%3A%2F%2Fapi.test%3FapiKey%3Dsecret123%26a%3D1",
        "redirect=https%3A%2F%2Fapi.test%3Ftoken%3Dpart1%20part2%22q%27end%26a%3D1",
        "redirect=https%3A%2F%2Fapi.test%3Ftoken%3Dprefix\\secret123%26a%3D1",
        "sk-proj1234567890abcdef",
        "bb_live_a-cd1234efgh5678",
        "bb_test_w_yz9876secret",
        "AIzaSyA0123456789abcdefghijklmnopqrstu",
        "Authorization: Bearer\u00a0eyJhbGciOi.payload.sig",
        "Authorization: Bearer sk-proj1234567890abcdef",
        "Authorization: Bearer tok%2Fsecret123456",
        "ordinary message without secrets",
    ]
    ts_results = _node_eval(
        """
        import fs from "node:fs";
        import { sanitizeErrorMessage } from "./src/harness/redact.ts";
        const samples = JSON.parse(fs.readFileSync(0, "utf8"));
        console.log(JSON.stringify(samples.map(sanitizeErrorMessage)));
        """,
        samples,
        esm=True,
        strip_types=True,
    )
    for sample, ts_out in zip(samples, ts_results, strict=True):
        assert sanitize_error_message(sample) == ts_out, sample
        assert "secret123" not in ts_out, sample
        assert "part2" not in ts_out, sample


@settings(max_examples=150)
@given(obj=st.dictionaries(st.text(max_size=10), _JSON_VALUE, max_size=8))
def test_canonical_json_is_key_order_invariant(obj: dict[str, Any]) -> None:
    reversed_obj = dict(reversed(list(obj.items())))
    c1 = canonical_json(obj)
    c2 = canonical_json(reversed_obj)
    assert c1 == c2
    assert json.loads(c1) == obj


@settings(max_examples=100)
@given(
    bad_text=st.one_of(
        st.text(max_size=80),
        st.sampled_from(["[]", "null", "42", "true", '"string"', "{}"]),
    )
)
def test_parse_bundle_always_raises_bundle_error_on_invalid_inputs(bad_text: str) -> None:
    with pytest.raises(StagehandFacadeBundleError):
        parse_bundle(bad_text)


@settings(max_examples=100)
@given(raw=st.binary(max_size=128))
def test_decoded_base64_length_exact_for_all_byte_lengths(raw: bytes) -> None:
    encoded = base64.b64encode(raw).decode("ascii")
    assert _decoded_base64_length(encoded) == len(raw)


@settings(max_examples=100)
@given(
    token=st.one_of(
        st.text(max_size=30),
        st.sampled_from(["$&", "$$", "$'", "${id}", "${cause}"]),
    )
)
def test_contract_error_substitutes_literally(token: str) -> None:
    assert contract_error("STALE_SNAPSHOT_ID_ERROR", id=token) == (
        f'Snapshot ID "{token}" is stale or not actionable; call snapshot again.'
    )
    assert contract_error("BROWSER_SESSION_LOST_ERROR", cause=token) == (
        f"Browser session lost ({token}). The task cannot continue; report your final result now."
    )


@settings(max_examples=100)
@given(
    runtime_ms=st.one_of(
        st.just(math.nan),
        st.just(math.inf),
        st.just(-math.inf),
        st.just(10**400),
        st.just(-(10**400)),
        st.booleans(),
        st.text(max_size=10),
    )
)
def test_is_run_envelope_rejects_non_finite_or_non_numeric_runtime(runtime_ms: object) -> None:
    envelope = {
        "__stagehandPlaywrightCompat": True,
        "value": 1,
        "telemetry": {},
        "artifacts": [],
        "closeRequested": False,
        "batchRuntimeMs": runtime_ms,
    }
    assert not _is_run_envelope(envelope)


@settings(max_examples=100)
@given(
    bad_path=st.one_of(
        st.sampled_from([
            "../escape.png",
            "a/../../escape.png",
            "/etc/passwd.png",
            "shot.txt",
            "shot.js",
            "bad\0name.png",
            f"{'a' * 256}.png",
        ]),
        st.text(alphabet="abcdefghijklmnopqrstuvwxyz", min_size=1, max_size=20).map(
            lambda name: f"{name}.txt"
        ),
    )
)
def test_check_artifact_rejects_traversal_bad_ext_and_overlong_names(bad_path: str) -> None:
    with pytest.raises(StagehandFacadeInputError):
        _check_artifact(
            "/tmp/stagehand-artifact-root", {"path": bad_path, "base64": "iVBORw0KGgo="}
        )


@settings(max_examples=100)
@given(text=st.text(alphabet=st.characters(), max_size=40))
def test_json_value_bytes_handles_arbitrary_unicode_and_surrogates(text: str) -> None:
    size = _json_value_bytes(text)
    assert isinstance(size, int) and size >= 2
