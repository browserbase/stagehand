from __future__ import annotations

import json
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest
from pydantic import ValidationError

from stagehand._generated.models import (
    BrowserbaseRegion,
    BrowserSessionMetadata,
    Caching,
    ModelConfig,
)
from stagehand.browser import _WorkerInitMetadata
from stagehand.browserbase_connection import BrowserbaseConnection, resolve_browserbase_connection
from stagehand.client_models import (
    ClientLLM,
    LLMGenerateInput,
    LLMGenerateOutput,
    StagehandClientCreateConfig,
)

_FIXTURES = json.loads(
    (Path(__file__).parents[3] / "tests/fixtures/browserbase-transport.json").read_text()
)
_API_KEY = _FIXTURES["connection"]["apiKey"]
_SESSION_ID = _FIXTURES["connection"]["sessionId"]
_DEFAULT_API_URL = _FIXTURES["endpoints"][0]["expected"]


@pytest.mark.parametrize(
    ("api_url", "accepted"),
    [
        ("http://localhost:3000", True),
        ("https://example.com", True),
        ("ftp://example.com", False),
        ("file:///tmp/api", False),
        ("ws://example.com", False),
    ],
)
def test_api_url_scheme(api_url: str, accepted: bool) -> None:
    if accepted:
        assert StagehandClientCreateConfig(api_url=api_url).api_url == api_url
    else:
        with pytest.raises(ValidationError, match="must use HTTP or HTTPS"):
            StagehandClientCreateConfig(api_url=api_url)


@pytest.mark.parametrize("fixture", _FIXTURES["endpoints"], ids=lambda fixture: fixture["name"])
def test_resolves_shared_endpoints(fixture: dict[str, str]) -> None:
    config = StagehandClientCreateConfig(api_key=_API_KEY, api_url=fixture.get("apiUrl"))
    browser = BrowserSessionMetadata(
        session_id=_SESSION_ID,
        region=BrowserbaseRegion(fixture["region"]) if "region" in fixture else None,
    )
    assert resolve_browserbase_connection(config, _WorkerInitMetadata(None, browser)) == (
        BrowserbaseConnection(_API_KEY, fixture["expected"], _SESSION_ID)
    )


@pytest.mark.parametrize("constructor_key", [None, "bb-constructor-key"])
def test_claimed_browser_key_takes_precedence(constructor_key: str | None) -> None:
    config = StagehandClientCreateConfig(
        api_key=constructor_key, api_url="https://fixture.example/services/"
    )
    metadata = _WorkerInitMetadata(
        _API_KEY,
        BrowserSessionMetadata(session_id=_SESSION_ID, region=BrowserbaseRegion.eu_central_1),
    )
    assert resolve_browserbase_connection(config, metadata) == BrowserbaseConnection(
        _API_KEY, "https://fixture.example/services/v1", _SESSION_ID
    )
    assert config.api_key == constructor_key
    assert metadata.api_key == _API_KEY
    assert metadata.browser is not None
    assert metadata.browser.region is BrowserbaseRegion.eu_central_1


@pytest.mark.parametrize(
    ("constructor_key", "claimed_key", "session_id"),
    [
        (None, None, None),
        (_API_KEY, None, None),
        (None, _API_KEY, None),
        (None, None, _SESSION_ID),
        (_API_KEY, "", _SESSION_ID),
    ],
    ids=["no-settings", "key-only", "claimed-key-only", "session-only", "empty-claimed-key"],
)
def test_requires_effective_key_and_session(
    constructor_key: str | None, claimed_key: str | None, session_id: str | None
) -> None:
    config = StagehandClientCreateConfig(api_key=constructor_key)
    metadata = _WorkerInitMetadata(
        claimed_key,
        BrowserSessionMetadata(session_id=session_id) if session_id is not None else None,
    )
    assert resolve_browserbase_connection(config, metadata) is None


async def _generate(_params: LLMGenerateInput) -> LLMGenerateOutput:
    raise AssertionError("Connection resolution must not generate a model response")


@pytest.mark.parametrize(
    "model",
    [ModelConfig(model_name="openai/gpt-5", api_key="provider-key"), ClientLLM(generate=_generate)],
    ids=["direct-model", "custom-model"],
)
def test_model_and_cache_settings_do_not_change_connection(
    model: ModelConfig | ClientLLM,
) -> None:
    config = StagehandClientCreateConfig(model=model, cache=Caching(root=False))
    metadata = _WorkerInitMetadata(None, BrowserSessionMetadata(session_id=_SESSION_ID))
    assert resolve_browserbase_connection(config, metadata) is None
    config.api_key = _API_KEY
    assert resolve_browserbase_connection(config, metadata) == BrowserbaseConnection(
        _API_KEY, _DEFAULT_API_URL, _SESSION_ID
    )


def test_connection_is_an_independent_immutable_snapshot() -> None:
    config = StagehandClientCreateConfig(api_key=_API_KEY, api_url="https://first.example")
    browser = BrowserSessionMetadata(session_id=_SESSION_ID)
    metadata = _WorkerInitMetadata(None, browser)
    first = resolve_browserbase_connection(config, metadata)

    config.api_key = "bb-second-key"
    config.api_url = "https://second.example"
    browser.session_id = "second-session"
    second = resolve_browserbase_connection(config, metadata)

    assert first == BrowserbaseConnection(_API_KEY, "https://first.example/v1", _SESSION_ID)
    assert second == BrowserbaseConnection(
        "bb-second-key", "https://second.example/v1", "second-session"
    )
    assert first is not None
    with pytest.raises(FrozenInstanceError):
        setattr(first, "session_id", "changed")
    assert _API_KEY not in repr(first)
