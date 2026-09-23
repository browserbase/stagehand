from unittest.mock import patch

import pytest

from stagehand import LLMStructuredGenerateParams, open_ai_compatible


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
    assert result.structured_content.model_dump() == {"answer": "ok"}
