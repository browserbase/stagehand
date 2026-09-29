from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import sys

import langchain_openai
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from run_eval import RunnerConfig, build_eval_model  # noqa: E402


@pytest.mark.parametrize("model", ["xai/grok-fixture", "xai:grok-fixture"])
def test_xai_uses_native_compatible_endpoint(
    monkeypatch: pytest.MonkeyPatch, model: str,
) -> None:
    configured = {}
    native_model = object()

    def create_model(**kwargs):
        configured.update(kwargs)
        return native_model

    monkeypatch.setattr(langchain_openai, "ChatOpenAI", create_model)
    monkeypatch.setenv("XAI_API_KEY", "fixture-key")
    config = RunnerConfig("task", None, model, {}, 10, 5)
    assert build_eval_model(config) is native_model
    assert configured == {
        "model": "grok-fixture",
        "base_url": "https://api.x.ai/v1",
        "api_key": "fixture-key",
    }


def test_other_provider_routes_remain_unchanged() -> None:
    config = RunnerConfig("task", None, "openai:fixture", {}, 10, 5)
    for model in ["openai:fixture", "anthropic:fixture", "google_genai:fixture"]:
        assert build_eval_model(replace(config, model=model)) == model


@pytest.mark.parametrize("xai_key", [None, "", "   "])
def test_xai_requires_its_own_key_instead_of_falling_back_to_openai(
    monkeypatch: pytest.MonkeyPatch, xai_key: str | None,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "fixture-openai-key")
    if xai_key is None:
        monkeypatch.delenv("XAI_API_KEY", raising=False)
    else:
        monkeypatch.setenv("XAI_API_KEY", xai_key)
    config = RunnerConfig("task", None, "xai/grok-fixture", {}, 10, 5)
    # Use the installed constructor, which otherwise silently picks OPENAI_API_KEY.
    # Constructing a model does not make a provider request.
    with pytest.raises(ValueError, match="XAI_API_KEY is required"):
        build_eval_model(config)
