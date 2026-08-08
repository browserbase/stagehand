from __future__ import annotations

import json
import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from crewai.tools import BaseTool
from crewai_tools import MCPServerAdapter

from agent import (
    REPOSITORY_ROOT,
    build_stagehand_agent,
    load_stagehand_codemode_skill,
)
from mcp import StdioServerParameters

LOCAL_STDIO_SERVER_PATH = REPOSITORY_ROOT / "packages/integrations/dist/codemode/stdio-server.mjs"


@contextmanager
def local_stagehand_code_tools_for_ci() -> Iterator[list[BaseTool]]:
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
    parameters = StdioServerParameters(
        command="node",
        args=[str(LOCAL_STDIO_SERVER_PATH)],
        cwd=Path(REPOSITORY_ROOT),
        env=child_env,
    )
    with MCPServerAdapter(parameters) as discovered_tools:
        yield list(discovered_tools)


def successful_result(raw_result: Any) -> dict[str, Any]:
    result = json.loads(str(raw_result))
    assert result["ok"] is True, result
    return result


def main() -> None:
    os.environ.setdefault("OPENAI_API_KEY", "smoke-only-placeholder")

    with local_stagehand_code_tools_for_ci() as tools:
        assert [tool.name for tool in tools] == ["code_execute"]
        assert "Stagehand V4 code-mode syntax" in tools[0].description
        assert "stagehand.extract" in load_stagehand_codemode_skill()

        agent = build_stagehand_agent(tools)
        code_execute = agent.tools[0]

        first = successful_result(
            code_execute.run(
                code="""
await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  document.documentElement.dataset.crewaiStagehandSession = "persisted";
});
return {
  pageId: page.pageId,
  title: await page.title(),
  marker: await page.evaluate(
    () => document.documentElement.dataset.crewaiStagehandSession,
  ),
};
"""
            )
        )
        second = successful_result(
            code_execute.run(
                code="""
return {
  pageId: page.pageId,
  title: await page.title(),
  marker: await page.evaluate(
    () => document.documentElement.dataset.crewaiStagehandSession,
  ),
};
"""
            )
        )

        first_value = first["value"]
        second_value = second["value"]
        assert first_value["title"] == "Example Domain"
        assert second_value["title"] == "Example Domain"
        assert second_value["marker"] == "persisted"
        assert second_value["pageId"] == first_value["pageId"]

        print(
            "CrewAI local CI-only Stagehand MCP persistence PASS:",
            json.dumps(
                {
                    "browser": "local",
                    "tool": "code_execute",
                    "pageId": second_value["pageId"],
                    "title": second_value["title"],
                    "marker": second_value["marker"],
                },
                sort_keys=True,
            ),
        )


if __name__ == "__main__":
    main()
