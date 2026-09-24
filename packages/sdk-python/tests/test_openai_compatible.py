import os
from unittest.mock import patch

import pytest

from stagehand import LLMStructuredGenerateParams, LLMStructuredGenerateResult, open_ai_compatible

LIVE_PNG_1X1 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


@pytest.mark.asyncio
async def test_open_ai_compatible_maps_structured_request() -> None:
    with patch(
        "stagehand.openai_compatible._post_json",
        return_value={"choices": [{"message": {"content": '{"answer":"ok"}'}}]},
    ) as post:
        generate = open_ai_compatible(
            model="example/model", base_url="https://gateway.example/v1/", api_key="test-key"
        )
        params = LLMStructuredGenerateParams.model_validate({
            "messages": [{"role": "user", "content": {"type": "text", "text": "hello"}}],
            "response_format": {
                "type": "json_schema",
                "name": "answer",
                "schema": {"type": "object", "properties": {"answer": {"type": "string"}}},
            },
        })
        result = await generate(params)

    url, api_key, headers, payload = post.call_args.args
    assert url == "https://gateway.example/v1/chat/completions"
    assert api_key == "test-key"
    assert headers == {}
    assert payload["messages"] == [{"role": "user", "content": "hello"}]
    assert "temperature" not in payload
    assert "description" not in payload["response_format"]["json_schema"]
    assert payload["response_format"]["json_schema"]["strict"] is True
    assert isinstance(result, LLMStructuredGenerateResult)
    assert result.structured_content is not None
    assert result.structured_content.model_dump() == {"answer": "ok"}


@pytest.mark.asyncio
async def test_open_ai_compatible_extra_body() -> None:
    with patch(
        "stagehand.openai_compatible._post_json",
        return_value={"choices": [{"message": {"content": '{"ok":true}'}}]},
    ) as post:
        generate = open_ai_compatible(
            model="openai/gpt-6-luna",
            base_url="https://ai-gateway.vercel.sh/v1",
            api_key="test-key",
            extra_body={
                "model": "should-not-win",
                "providerOptions": {
                    "gateway": {
                        "user": "user-12345",
                        "tags": ["team:billing", "env:prod"],
                    }
                },
                "seed": 42,
            },
        )
        params = LLMStructuredGenerateParams.model_validate({
            "messages": [{"role": "user", "content": {"type": "text", "text": "hello"}}],
            "response_format": {
                "type": "json_schema",
                "name": "answer",
                "schema": {"type": "object"},
            },
        })
        result = await generate(params)

    url, api_key, headers, payload = post.call_args.args
    assert url == "https://ai-gateway.vercel.sh/v1/chat/completions"
    assert api_key == "test-key"
    assert payload["model"] == "openai/gpt-6-luna"
    assert payload["seed"] == 42
    assert payload["providerOptions"] == {
        "gateway": {
            "user": "user-12345",
            "tags": ["team:billing", "env:prod"],
        }
    }
    assert isinstance(result, LLMStructuredGenerateResult)
    assert result.structured_content is not None
    assert result.structured_content.model_dump() == {"ok": True}


@pytest.mark.asyncio
async def test_open_ai_compatible_live_vercel_gateway() -> None:
    api_key = os.getenv("AI_GATEWAY_API_KEY")
    if not api_key:
        pytest.skip("AI_GATEWAY_API_KEY not set")
    model = open_ai_compatible(
        model=os.getenv("AI_GATEWAY_MODEL", "openai/gpt-6-luna"),
        base_url=os.getenv("AI_GATEWAY_BASE_URL", "https://ai-gateway.vercel.sh/v1"),
        api_key=api_key,
        extra_body={
            "providerOptions": {
                "gateway": {
                    "user": "test-user-live-python",
                    "tags": ["smoke:pytest", "test:live-luna"],
                }
            }
        },
    )
    params = LLMStructuredGenerateParams.model_validate({
        "messages": [
            {"role": "user", "content": {"type": "text", "text": "ping"}},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "image ping"},
                    {
                        "type": "image",
                        "data": LIVE_PNG_1X1,
                        "mime_type": "image/png",
                    },
                ],
            },
        ],
        "response_format": {
            "type": "json_schema",
            "name": "observation",
            "schema": {
                "type": "object",
                "properties": {"status": {"type": "string"}},
                "required": ["status"],
                "additionalProperties": False,
            },
        },
    })
    result = await model(params)
    assert isinstance(result, LLMStructuredGenerateResult)
    assert result.structured_content is not None
