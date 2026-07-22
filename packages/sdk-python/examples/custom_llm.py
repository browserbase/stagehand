import asyncio
import json
import os
from typing import Any, cast

from openai import AsyncOpenAI
from openai.types.responses import (
    ResponseFormatTextJSONSchemaConfigParam,
    ResponseTextConfigParam,
)
from pydantic import BaseModel

from stagehand import (
    LLMGenerateInput,
    LLMGenerateOutput,
    LLMRole,
    LLMStructuredGenerateParams,
    LLMStructuredGenerateResult,
    LLMTextContent,
    LLMUsage,
    Stagehand,
)

openai = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
generation_names: list[str] = []


class PageInfo(BaseModel):
    heading: str
    description: str


async def main() -> None:
    stagehand = Stagehand(
        browser="local",
        headless=True,
        model=generate_with_openai,
    )

    try:
        await stagehand.init()

        page = await stagehand.context.active_page()
        if page is None:
            raise RuntimeError("Stagehand initialized without an active page")
        await page.goto("https://example.com")

        page_info = await page.extract(
            instruction="Extract the page heading and description",
            schema=PageInfo,
        )
        actions = await page.observe(
            instruction="Find the link that provides more information about Example Domain",
        )
        action_result = await page.act(
            "Click the link that provides more information about Example Domain"
        )

        print(
            json.dumps(
                {
                    "page_info": page_info.model_dump(mode="json"),
                    "actions": [
                        action.model_dump(mode="json", by_alias=True) for action in actions
                    ],
                    "action_result": action_result.model_dump(mode="json", by_alias=True),
                    "generation_names": generation_names,
                },
                indent=2,
            )
        )

        if not actions:
            raise RuntimeError("observe() returned no matching actions")
        if not action_result.success:
            raise RuntimeError(f"act() failed: {action_result.message}")
    finally:
        await stagehand.close()


async def generate_with_openai(params: LLMGenerateInput) -> LLMGenerateOutput:
    if not isinstance(params, LLMStructuredGenerateParams):
        raise TypeError("This example only supports structured generation")

    request = params
    response_format = request.response_format
    if response_format.schema_ is None:
        raise TypeError("OpenAI structured output requires a JSON Schema")
    schema = response_format.schema_.model_dump()
    if not isinstance(schema, dict):
        raise TypeError("OpenAI structured output requires an object JSON Schema")

    generation_names.append(response_format.name)
    openai_format = ResponseFormatTextJSONSchemaConfigParam(
        type="json_schema",
        name=response_format.name,
        schema=cast(dict[str, object], schema),
        strict=True,
    )
    if response_format.description is not None:
        openai_format["description"] = response_format.description
    text = ResponseTextConfigParam(format=openai_format)
    response = await openai.responses.create(
        model="gpt-5.4-mini",
        instructions=request.system_prompt,
        input=[
            {
                "role": message.role.value,
                "content": message_text(message.model_dump(mode="json")),
            }
            for message in request.messages
        ],
        temperature=request.temperature,
        text=text,
    )

    if not response.output_text:
        raise RuntimeError("OpenAI returned no output text")

    usage = response.usage
    return LLMStructuredGenerateResult.model_validate({
        "role": LLMRole.assistant,
        "content": LLMTextContent(type="text", text=response.output_text),
        "output_format": "json_schema",
        "structured_content": json.loads(response.output_text),
        "stop_reason": response.status,
        "usage": (
            LLMUsage(
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
                total_tokens=usage.total_tokens,
                reasoning_tokens=usage.output_tokens_details.reasoning_tokens,
                cached_input_tokens=usage.input_tokens_details.cached_tokens,
            )
            if usage is not None
            else None
        ),
    })


def message_text(message: dict[str, Any]) -> str:
    content = message["content"]
    blocks = content if isinstance(content, list) else [content]
    texts: list[str] = []

    for block in blocks:
        if not isinstance(block, dict) or block.get("type") != "text":
            block_type = block.get("type") if isinstance(block, dict) else type(block).__name__
            raise TypeError(f"This example does not support {block_type} message blocks")
        text = block.get("text")
        if not isinstance(text, str):
            raise TypeError("Text message blocks must contain text")
        texts.append(text)

    return "\n".join(texts)


if __name__ == "__main__":
    asyncio.run(main())
