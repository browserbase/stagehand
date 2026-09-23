"""Client-side adapter for OpenAI-compatible Chat Completions endpoints."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping
from typing import Any
from urllib.request import Request, urlopen

from ._generated.models import (
    LLMImageContent,
    LLMMessage,
    LLMStructuredGenerateParams,
    LLMStructuredGenerateResult,
    LLMTextContent,
)
from .client_types import LLMGenerateCallback, LLMGenerateInput


def _content(message: LLMMessage) -> str | list[dict[str, Any]]:
    blocks = message.content if isinstance(message.content, list) else [message.content]
    parts: list[dict[str, Any]] = []
    for block in blocks:
        content = block.root
        if isinstance(content, LLMTextContent):
            parts.append({"type": "text", "text": content.text})
        elif isinstance(content, LLMImageContent):
            parts.append({
                "type": "image_url",
                "image_url": {"url": f"data:{content.mime_type};base64,{content.data}"},
            })
        else:
            raise TypeError(f"OpenAI-compatible models do not accept {content.type} content")
    if all(part["type"] == "text" for part in parts):
        return "".join(part["text"] for part in parts)
    return parts


def _post_json(
    url: str, api_key: str, headers: Mapping[str, str], payload: dict[str, Any]
) -> dict[str, Any]:
    request = Request(
        url,
        data=json.dumps(payload).encode(),
        headers={
            **headers,
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=60) as response:
        return json.load(response)


def open_ai_compatible(
    *,
    model: str,
    base_url: str,
    api_key: str,
    headers: Mapping[str, str] | None = None,
) -> LLMGenerateCallback:
    """Return a callback for an OpenAI-compatible Chat Completions endpoint."""
    url = f"{base_url.rstrip('/')}/chat/completions"
    extra_headers = dict(headers or {})

    async def generate(params: LLMGenerateInput) -> LLMStructuredGenerateResult:
        if not isinstance(params, LLMStructuredGenerateParams):
            raise TypeError("Stagehand only issues structured generations")
        response_format = params.response_format
        messages: list[dict[str, Any]] = []
        if params.system_prompt:
            messages.append({"role": "system", "content": params.system_prompt})
        messages.extend(
            {"role": message.role.value, "content": _content(message)}
            for message in params.messages
        )
        payload = {
            "model": model,
            "messages": messages,
            "temperature": params.temperature,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": response_format.name,
                    "description": response_format.description,
                    "schema": response_format.schema_.model_dump(by_alias=True)
                    if response_format.schema_ is not None
                    else None,
                    "strict": True,
                },
            },
        }
        response = await asyncio.to_thread(_post_json, url, api_key, extra_headers, payload)
        choices = response.get("choices", [])
        text = choices[0].get("message", {}).get("content") if choices else None
        if not isinstance(text, str):
            raise ValueError("OpenAI-compatible response did not include message content")
        return LLMStructuredGenerateResult.model_validate({
            "role": "assistant",
            "content": {"type": "text", "text": text},
            "output_format": "json_schema",
            "structured_content": json.loads(text),
        })

    return generate
