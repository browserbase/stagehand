from __future__ import annotations

import asyncio
import json
import os
from typing import Any

from langchain_mcp_adapters.client import MultiServerMCPClient

from agent import (
    REPOSITORY_ROOT,
    load_stagehand_code_tool,
    load_stagehand_codemode_skill,
)

LOCAL_STDIO_SERVER_PATH = REPOSITORY_ROOT / "packages/integrations/dist/codemode/stdio-server.mjs"

FIRST_CALL = """
await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  document.documentElement.dataset.stagehandLangchainSmoke = "persistent";
});
return {
  pageId: page.pageId,
  title: await page.title(),
  marker: await page.evaluate(
    () => document.documentElement.dataset.stagehandLangchainSmoke ?? null,
  ),
};
"""

SECOND_CALL = """
return {
  pageId: page.pageId,
  title: await page.title(),
  marker: await page.evaluate(
    () => document.documentElement.dataset.stagehandLangchainSmoke ?? null,
  ),
};
"""


def parse_code_execute_result(raw_result: Any) -> dict[str, Any]:
    """Normalize the text result returned by the LangChain MCP adapter."""
    if isinstance(raw_result, str):
        parsed = json.loads(raw_result)
    elif isinstance(raw_result, dict):
        structured = raw_result.get("structuredContent")
        parsed = structured if isinstance(structured, dict) else raw_result
    elif isinstance(raw_result, list) and len(raw_result) == 1:
        block = raw_result[0]
        text = block.get("text") if isinstance(block, dict) else getattr(block, "text", None)
        if not isinstance(text, str):
            raise TypeError(f"Unexpected MCP content block: {type(block).__name__}")
        parsed = json.loads(text)
    else:
        raise TypeError(f"Unexpected code_execute result: {type(raw_result).__name__}")

    if not isinstance(parsed, dict):
        raise TypeError(f"Expected an object result, got {type(parsed).__name__}")
    return parsed


def local_stagehand_mcp_client_for_ci() -> MultiServerMCPClient:
    """Launch the MCP directly only for the credential-free local CI smoke."""
    if not LOCAL_STDIO_SERVER_PATH.is_file():
        raise FileNotFoundError(
            "Build @browserbasehq/stagehand-integrations before running the smoke"
        )
    child_env = {
        "PATH": os.environ.get("PATH", ""),
        "STAGEHAND_BROWSER": "local",
    }
    # Stagehand's local launcher uses CI to add Chrome's --no-sandbox flag.
    for name in ("HOME", "TMPDIR", "CHROME_PATH", "CI"):
        if value := os.environ.get(name):
            child_env[name] = value
    return MultiServerMCPClient(
        {
            "stagehand": {
                "transport": "stdio",
                "command": "node",
                "args": [str(LOCAL_STDIO_SERVER_PATH)],
                "cwd": str(REPOSITORY_ROOT),
                "env": child_env,
            }
        },
        tool_name_prefix=False,
        handle_tool_errors=True,
    )


async def main() -> None:
    assert "stagehand.extract" in load_stagehand_codemode_skill()
    client = local_stagehand_mcp_client_for_ci()

    async with client.session("stagehand") as session:
        code_tool = await load_stagehand_code_tool(session)
        first = parse_code_execute_result(await code_tool.ainvoke({"code": FIRST_CALL}))
        second = parse_code_execute_result(await code_tool.ainvoke({"code": SECOND_CALL}))

    assert first.get("ok") is True, first
    assert second.get("ok") is True, second
    first_value = first.get("value")
    second_value = second.get("value")
    assert isinstance(first_value, dict), first
    assert isinstance(second_value, dict), second
    assert first_value["marker"] == "persistent", first_value
    assert second_value["marker"] == "persistent", second_value
    assert first_value["pageId"] == second_value["pageId"], (first_value, second_value)
    assert first_value["title"] == second_value["title"] == "Example Domain", (
        first_value,
        second_value,
    )

    print(
        "LangChain local CI-only persistent Stagehand session PASS: "
        "browser=local, code_execute -> code_execute, "
        "same pageId, marker=persistent, title=Example Domain"
    )


if __name__ == "__main__":
    asyncio.run(main())
