from __future__ import annotations

import json
import os
from typing import Any

from agent import (
    STAGEHAND_CODEMODE_SKILL,
    build_stagehand_agent,
    stagehand_code_tools,
)


def successful_result(raw_result: Any) -> dict[str, Any]:
    result = json.loads(str(raw_result))
    assert result["ok"] is True, result
    return result


def main() -> None:
    os.environ.setdefault("STAGEHAND_BROWSER", "local")
    os.environ.setdefault("OPENAI_API_KEY", "smoke-only-placeholder")

    with stagehand_code_tools() as tools:
        assert [tool.name for tool in tools] == ["code_execute"]
        assert "Stagehand V4 code-mode syntax" in tools[0].description
        assert "stagehand.extract" in STAGEHAND_CODEMODE_SKILL

        agent = build_stagehand_agent(tools, llm="openai/gpt-4o-mini")
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
            "CrewAI Stagehand MCP persistence PASS:",
            json.dumps(
                {
                    "browser": os.environ["STAGEHAND_BROWSER"],
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
