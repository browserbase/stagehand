from __future__ import annotations

import asyncio
import json
import os
from typing import Any
from uuid import uuid4

from agent import (
    build_stagehand_agent,
    stagehand_code_session,
    stagehand_tool_call_count,
)
from sandbox import StagehandSandboxLease


def successful_result(raw_result: Any) -> dict[str, Any]:
    if isinstance(raw_result, str):
        result = json.loads(raw_result)
    elif isinstance(raw_result, dict):
        structured = raw_result.get("structuredContent")
        result = structured if isinstance(structured, dict) else raw_result
    elif isinstance(raw_result, list) and len(raw_result) == 1:
        block = raw_result[0]
        text = (
            block.get("text")
            if isinstance(block, dict)
            else getattr(block, "text", None)
        )
        if not isinstance(text, str):
            raise TypeError(f"Unexpected MCP content block: {type(block).__name__}")
        result = json.loads(text)
    else:
        raise TypeError(f"Unexpected code_execute result: {type(raw_result).__name__}")

    assert isinstance(result, dict), result
    assert result["ok"] is True, result
    value = result.get("value")
    assert isinstance(value, dict), result
    return value


async def main() -> None:
    direct_marker = f"langchain-direct-{uuid4()}"
    model_marker = f"langchain-model-{uuid4()}"
    os.environ["LANGCHAIN_HOST_ONLY_MARKER"] = f"host-{uuid4()}"
    final_state: dict[str, Any]
    model_tool_calls = 0

    with StagehandSandboxLease() as connection:
        async with stagehand_code_session(connection) as code_tool:
            first = successful_result(
                await code_tool.ainvoke(
                    {
                        "code": f"""
await page.goto("https://example.com", {{ waitUntil: "domcontentloaded" }});
await page.evaluate((marker) => {{
  document.documentElement.dataset.langchainDirectMarker = marker;
}}, {json.dumps(direct_marker)});
return {{
  pageId: page.pageId,
  title: await page.title(),
  directMarker: await page.evaluate(
    () => document.documentElement.dataset.langchainDirectMarker,
  ),
  modelKeyVisible: process.env.OPENAI_API_KEY ?? null,
  hostMarkerVisible: process.env.LANGCHAIN_HOST_ONLY_MARKER ?? null,
}};
"""
                    }
                )
            )
            assert first["title"] == "Example Domain"
            assert first["directMarker"] == direct_marker
            assert first["modelKeyVisible"] is None
            assert first["hostMarkerVisible"] is None

            second = successful_result(
                await code_tool.ainvoke(
                    {
                        "code": """
return {
  pageId: page.pageId,
  title: await page.title(),
  directMarker: await page.evaluate(
    () => document.documentElement.dataset.langchainDirectMarker,
  ),
};
"""
                    }
                )
            )
            assert second["title"] == "Example Domain"
            assert second["pageId"] == first["pageId"]
            assert second["directMarker"] == direct_marker

            agent = build_stagehand_agent(code_tool)
            agent_result = await agent.ainvoke(
                {
                    "messages": [
                        {
                            "role": "user",
                            "content": " ".join(
                                (
                                    "Use code_execute to modify the already-open page.",
                                    "Set document.documentElement.dataset.langchainModelMarker to",
                                    f"{json.dumps(model_marker)}.",
                                    "Then read that value and the current pageId and report them.",
                                    "You must call code_execute; do not merely describe JavaScript.",
                                )
                            ),
                        }
                    ]
                },
                config={"recursion_limit": 20},
            )
            model_tool_calls = stagehand_tool_call_count(agent_result)
            assert model_tool_calls, (
                "the real Deep Agent model must select code_execute"
            )

            final_state = successful_result(
                await code_tool.ainvoke(
                    {
                        "code": """
return {
  pageId: page.pageId,
  title: await page.title(),
  directMarker: await page.evaluate(
    () => document.documentElement.dataset.langchainDirectMarker,
  ),
  modelMarker: await page.evaluate(
    () => document.documentElement.dataset.langchainModelMarker,
  ),
};
"""
                    }
                )
            )
            assert final_state["title"] == "Example Domain"
            assert final_state["pageId"] == first["pageId"]
            assert final_state["directMarker"] == direct_marker
            assert final_state["modelMarker"] == model_marker

    print(
        json.dumps(
            {
                "status": "PASS",
                "framework": "langchain-deep-agents",
                "directToolCalls": 3,
                "modelToolCalls": model_tool_calls,
                "sessionPersisted": True,
                "modelCredentialIsolated": True,
                "finalState": final_state,
                "cleanup": ["langchain-mcp", "vercel-sandbox"],
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
