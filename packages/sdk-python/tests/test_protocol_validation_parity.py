from __future__ import annotations

import base64
import re
from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from pydantic import AnyUrl, TypeAdapter, ValidationError

from stagehand._generated import models

_URL_ADAPTER = TypeAdapter(AnyUrl)
_MAX_INPUT_FILE_BYTES = 50 * 1024 * 1024
_MAX_INPUT_FILE_BASE64_LENGTH = ((_MAX_INPUT_FILE_BYTES + 2) // 3) * 4
_ALLOWED_REGEX_FLAGS = tuple("dgimsuvy")


def _expected_cookie_param_valid(payload: dict[str, Any]) -> bool:
    url = payload.get("url")
    domain = payload.get("domain")
    path = payload.get("path")
    expires = payload.get("expires")
    secure = payload.get("secure")
    same_site = payload.get("same_site")

    if not url and not (domain and path):
        return False
    if url and domain:
        return False
    if url and path:
        return False
    if expires is not None and expires < 0 and expires != -1:
        return False

    parsed_url: AnyUrl | None = None
    if url == "about:blank":
        return False
    if isinstance(url, str) and url.startswith("data:"):
        return False
    if url:
        try:
            parsed_url = _URL_ADAPTER.validate_python(url)
        except ValidationError:
            return False

    effectively_secure = (
        parsed_url is not None and parsed_url.scheme == "https" if url else secure is True
    )
    return not (same_site == "None" and not effectively_secure)


@settings(max_examples=200)
@given(
    name=st.text(min_size=0, max_size=20),
    value=st.text(min_size=0, max_size=20),
    url=st.sampled_from([
        None,
        "",
        "https://example.com",
        "https://example.com/account",
        "HTTPS://EXAMPLE.COM/path",
        "http://example.com",
        "http://localhost:8080/a",
        "about:blank",
        "about:srcdoc",
        "data:text/plain,hello",
        "DATA:text/plain,hello",
        "not-a-url",
        "https://",
        "ftp://example.com/file",
    ]),
    domain=st.sampled_from([None, "", "example.com", ".example.com"]),
    path=st.sampled_from([None, "", "/", "/account"]),
    expires=st.one_of(
        st.none(),
        st.sampled_from([-2, -1.5, -1, -1.0, -0.001, 0, 1, 1_700_000_000]),
        st.floats(min_value=-1000.0, max_value=1_000_000.0, allow_nan=False, allow_infinity=False),
    ),
    secure=st.sampled_from([None, True, False]),
    same_site=st.sampled_from([None, "Strict", "Lax", "None"]),
)
def test_cookie_param_validation_parity(
    name: str,
    value: str,
    url: str | None,
    domain: str | None,
    path: str | None,
    expires: float | None,
    secure: bool | None,
    same_site: str | None,
) -> None:
    payload: dict[str, Any] = {"name": name, "value": value}
    if url is not None:
        payload["url"] = url
    if domain is not None:
        payload["domain"] = domain
    if path is not None:
        payload["path"] = path
    if expires is not None:
        payload["expires"] = expires
    if secure is not None:
        payload["secure"] = secure
    if same_site is not None:
        payload["same_site"] = same_site

    expected_valid = _expected_cookie_param_valid(payload)
    if expected_valid:
        validated = models.CookieParam.model_validate(payload)
        assert validated.name == name
    else:
        with pytest.raises(ValidationError):
            models.CookieParam.model_validate(payload)


def test_cookie_param_assignment_revalidates_cross_field_rules() -> None:
    cookie = models.CookieParam.model_validate({
        "name": "session",
        "value": "abc",
        "domain": "example.com",
        "path": "/",
        "secure": True,
        "same_site": "None",
    })
    with pytest.raises(ValidationError, match='sameSite: "None"'):
        cookie.secure = False
    with pytest.raises(ValidationError, match="expires"):
        cookie.expires = -2
    with pytest.raises(ValidationError, match="either url or domain"):
        cookie.url = "https://example.com"


@settings(max_examples=150)
@given(
    flags=st.lists(st.sampled_from(_ALLOWED_REGEX_FLAGS), min_size=0, max_size=8).map("".join),
    pattern=st.sampled_from([
        "",
        "^session-",
        "foo|bar",
        "[a-z0-9_]+",
        "(?:abc){1,3}?",
        "(?<id>[a-z]+)",
        "[]",
        "[^]",
    ]),
)
def test_cookie_regex_flag_combinations_parity(flags: str, pattern: str) -> None:
    has_duplicates = len(set(flags)) != len(flags)
    has_u_and_v = "u" in flags and "v" in flags
    expected_valid = not has_duplicates and not has_u_and_v

    payload = {"source": pattern, "flags": flags}
    if expected_valid:
        parsed = models.CookieRegex.model_validate(payload)
        assert parsed.source == pattern
        assert parsed.flags == flags
    else:
        with pytest.raises(ValidationError, match="Invalid cookie filter regular expression"):
            models.CookieRegex.model_validate(payload)


@settings(max_examples=150)
@given(
    low=st.integers(min_value=0, max_value=50),
    high=st.integers(min_value=0, max_value=50),
    flags=st.sampled_from([None, "", "i", "u", "v"]),
)
def test_cookie_regex_quantifier_bounds_parity(
    low: int,
    high: int,
    flags: str | None,
) -> None:
    payload: dict[str, Any] = {"source": f"a{{{low},{high}}}"}
    if flags is not None:
        payload["flags"] = flags
    if low <= high:
        models.CookieRegex.model_validate(payload)
    else:
        with pytest.raises(ValidationError, match="Invalid cookie filter regular expression"):
            models.CookieRegex.model_validate(payload)


@settings(max_examples=150)
@given(
    start_code=st.integers(min_value=ord("a"), max_value=ord("z")),
    end_code=st.integers(min_value=ord("a"), max_value=ord("z")),
    flags=st.sampled_from([None, "", "i", "u", "v"]),
)
def test_cookie_regex_character_class_range_parity(
    start_code: int,
    end_code: int,
    flags: str | None,
) -> None:
    payload: dict[str, Any] = {"source": f"[{chr(start_code)}-{chr(end_code)}]"}
    if flags is not None:
        payload["flags"] = flags
    if start_code <= end_code:
        models.CookieRegex.model_validate(payload)
    else:
        with pytest.raises(ValidationError, match="Invalid cookie filter regular expression"):
            models.CookieRegex.model_validate(payload)


@pytest.mark.parametrize(
    ("source", "flags"),
    [
        ("^session-", "i"),
        ("(?<name>foo)\\k<name>", None),
        ("(?<=foo+)bar", None),
        ("(?<=foo+)bar", "u"),
        ("[]", None),
        ("[^]", "u"),
        ("\\u{1F600}", "u"),
        ("\\p{L}", "u"),
        ("(?i:abc)", None),
        ("(?<a>x)|(?<a>y)", None),
        ("[[a-z]--[aeiou]]", "v"),
        ("[\\q{abc|def}]", "v"),
        ("(?=a)+", None),
        ("{", None),
        ("a", "dgimsuy"),
        ("a", "dgimsvy"),
    ],
)
def test_cookie_regex_accepts_valid_js_patterns(source: str, flags: str | None) -> None:
    payload: dict[str, Any] = {"source": source}
    if flags is not None:
        payload["flags"] = flags
    parsed = models.CookieRegex.model_validate(payload)
    assert parsed.source == source


@pytest.mark.parametrize(
    ("source", "flags"),
    [
        ("(", "i"),
        (")", None),
        ("[abc", None),
        ("abc\\", None),
        ("*", None),
        ("+", None),
        ("?", None),
        ("a**", None),
        ("a{2,1}", None),
        ("[z-a]", None),
        ("session", "ii"),
        ("session", "uv"),
        ("session", "x"),
        ("(?P<name>foo)", None),
        ("(?i)foo", None),
        ("(?<a>x)(?<a>y)", None),
        ("(?<1>x)", None),
        ("(?=a)+", "u"),
        ("(?<=a)?", None),
        ("\\a", "u"),
        ("{", "u"),
        ("}", "u"),
        ("]", "u"),
        ("(a)\\2", "u"),
        ("\\01", "u"),
        ("\\k<missing>", "u"),
        ("(?<a>x)\\k<missing>", None),
        ("[\\d-a]", "u"),
        ("[a-z--[aeiou]]", "v"),
        ("[a&&]", "v"),
        ("[a-]", "v"),
        ("[^\\p{Basic_Emoji}]", "v"),
        ("\\u{110000}", "u"),
    ],
)
def test_cookie_regex_rejects_invalid_js_patterns(source: str, flags: str | None) -> None:
    payload: dict[str, Any] = {"source": source}
    if flags is not None:
        payload["flags"] = flags
    with pytest.raises(ValidationError):
        models.CookieRegex.model_validate(payload)


def test_cookie_regex_assignment_revalidates() -> None:
    regex = models.CookieRegex.model_validate({"source": "^session-", "flags": "i"})
    with pytest.raises(ValidationError, match="Invalid cookie filter regular expression"):
        regex.flags = "ii"
    with pytest.raises(ValidationError, match="Invalid cookie filter regular expression"):
        regex.source = "("


@settings(max_examples=100)
@given(raw=st.binary(min_size=0, max_size=256))
def test_input_file_payload_accepts_valid_base64_under_limit(raw: bytes) -> None:
    encoded = base64.b64encode(raw).decode("ascii")
    payload = models.InputFilePayload.model_validate({"name": "blob.bin", "data": encoded})
    assert base64.b64decode(payload.data, validate=True) == raw


@settings(max_examples=100)
@given(
    text=st.text(min_size=1, max_size=64).filter(
        lambda value: (
            re.fullmatch(
                r"(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?",
                value,
            )
            is None
        )
    )
)
def test_input_file_payload_rejects_invalid_base64(text: str) -> None:
    with pytest.raises(ValidationError):
        models.InputFilePayload.model_validate({"name": "bad.bin", "data": text})


def test_input_file_payload_enforces_exact_50_mib_decoded_boundary() -> None:
    one_below = f"{'A' * (_MAX_INPUT_FILE_BASE64_LENGTH - 2)}=="
    exact_limit = f"{'A' * (_MAX_INPUT_FILE_BASE64_LENGTH - 1)}="
    one_over = "A" * _MAX_INPUT_FILE_BASE64_LENGTH
    four_over = "A" * (_MAX_INPUT_FILE_BASE64_LENGTH + 4)

    models.InputFilePayload.model_validate({"name": "below.bin", "data": one_below})
    exact_model = models.InputFilePayload.model_validate({"name": "limit.bin", "data": exact_limit})

    with pytest.raises(ValidationError, match="50 MiB"):
        models.InputFilePayload.model_validate({"name": "over.bin", "data": one_over})
    with pytest.raises(ValidationError):
        models.InputFilePayload.model_validate({"name": "way-over.bin", "data": four_over})
    with pytest.raises(ValidationError, match="50 MiB"):
        exact_model.data = one_over


@settings(max_examples=150)
@given(
    scheme=st.sampled_from(["http", "https"]),
    path=st.sampled_from([
        "",
        "/",
        "/v1/traces",
        "/otel/v1/traces",
        "/foo/../v1/traces",
        "/v1/traces/",
        "/v1/traces/..",
        "/v1/traces/extra",
        "/v1/metrics",
    ]),
    suffix=st.sampled_from(["", "?a=1", "#frag", "?a=1#frag"]),
)
def test_telemetry_traces_endpoint_validation_parity(
    scheme: str,
    path: str,
    suffix: str,
) -> None:
    endpoint = f"{scheme}://collector.example.com{path}{suffix}"
    expected_valid = (_URL_ADAPTER.validate_python(endpoint).path or "").endswith("/v1/traces")

    if expected_valid:
        traces = models.TelemetryTraces(endpoint=endpoint)
        config = models.TelemetryConfig(traces=traces)
        assert config.traces.endpoint == endpoint
    else:
        with pytest.raises(ValidationError, match="/v1/traces"):
            models.TelemetryTraces(endpoint=endpoint)
        with pytest.raises(ValidationError, match="/v1/traces"):
            models.TelemetryConfig.model_validate({"traces": {"endpoint": endpoint}})


def test_telemetry_traces_assignment_revalidates() -> None:
    config = models.TelemetryConfig.model_validate({
        "traces": {"endpoint": "https://collector.example.com/v1/traces"}
    })
    with pytest.raises(ValidationError, match="/v1/traces"):
        config.traces.endpoint = "https://collector.example.com/collector"


@settings(max_examples=150)
@given(
    full_page=st.sampled_from([None, False, True]),
    has_clip=st.booleans(),
    image_type=st.sampled_from([None, "png", "jpeg"]),
    quality=st.sampled_from([None, 0, 50, 100]),
)
def test_page_screenshot_options_validation_parity(
    full_page: bool | None,
    has_clip: bool,
    image_type: str | None,
    quality: int | None,
) -> None:
    payload: dict[str, Any] = {}
    if full_page is not None:
        payload["full_page"] = full_page
    if has_clip:
        payload["clip"] = {"x": 0, "y": 0, "width": 100, "height": 100}
    if image_type is not None:
        payload["type"] = image_type
    if quality is not None:
        payload["quality"] = quality

    expected_valid = not (bool(full_page) and has_clip) and (
        image_type == "jpeg" or quality is None
    )
    if expected_valid:
        models.PageScreenshotOptions.model_validate(payload)
    else:
        with pytest.raises(ValidationError):
            models.PageScreenshotOptions.model_validate(payload)


def test_page_screenshot_options_assignment_allows_valid_and_rejects_invalid_mutations() -> None:
    options = models.PageScreenshotOptions(type=models.Type.png)
    options.full_page = True
    assert options.full_page is True

    with pytest.raises(ValidationError, match="quality"):
        options.quality = 80
    with pytest.raises(ValidationError, match="fullPage and clip"):
        options.clip = models.PageScreenshotClip(x=0, y=0, width=10, height=10)


@settings(max_examples=50)
@given(
    browserbase=st.sampled_from([None, "client"]),
    has_browser=st.booleans(),
)
def test_stagehand_init_params_browserbase_dependency_parity(
    browserbase: str | None,
    has_browser: bool,
) -> None:
    payload: dict[str, Any] = {
        "protocol_version": "4.1.0",
        "client_info": {"name": "test", "version": "1"},
    }
    if browserbase is not None:
        payload["browserbase"] = browserbase
    if has_browser:
        payload["browser"] = {"session_id": "session-1"}

    expected_valid = browserbase is None or has_browser
    if expected_valid:
        models.StagehandInitParams.model_validate(payload)
    else:
        with pytest.raises(ValidationError, match="browser metadata"):
            models.StagehandInitParams.model_validate(payload)


def test_stagehand_init_params_assignment_revalidates() -> None:
    params = models.StagehandInitParams.model_validate({
        "protocol_version": "4.1.0",
        "client_info": {"name": "test", "version": "1"},
        "browserbase": "client",
        "browser": {"session_id": "session-1"},
    })
    with pytest.raises(ValidationError, match="browser metadata"):
        params.browser = None


@settings(max_examples=100)
@given(
    step_kinds=st.lists(st.sampled_from(["query", "frame", "nth"]), min_size=0, max_size=5),
)
def test_locator_chain_leading_query_parity(step_kinds: list[str]) -> None:
    steps: list[dict[str, Any]] = []
    for kind in step_kinds:
        if kind == "query":
            steps.append({"type": "query", "selector": {"kind": "css", "value": "button"}})
        elif kind == "frame":
            steps.append({"type": "frame", "selector": {"kind": "css", "value": "iframe"}})
        else:
            steps.append({"type": "nth", "index": 0})

    expected_valid = bool(step_kinds) and step_kinds[0] == "query"
    if expected_valid:
        models.LocatorChain.model_validate({"steps": steps})
    else:
        with pytest.raises(ValidationError):
            models.LocatorChain.model_validate({"steps": steps})
