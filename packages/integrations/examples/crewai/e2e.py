from __future__ import annotations

import json
import os
from typing import Any
from uuid import uuid4

from agent import build_stagehand_agent, stagehand_code_tools
from crewai.events import ToolUsageFinishedEvent, crewai_event_bus
from sandbox import StagehandSandboxLease


class StagehandCrewAIResultError(RuntimeError):
    """code_execute returned a malformed or unsuccessful result."""


class StagehandCrewAIIsolationError(RuntimeError):
    """A host-only value crossed the Vercel Sandbox boundary."""


def successful_result(raw_result: Any) -> dict[str, Any]:
    try:
        result = json.loads(str(raw_result))
    except (json.JSONDecodeError, TypeError, ValueError):
        raise StagehandCrewAIResultError(
            "Stagehand code_execute returned an invalid result."
        ) from None
    if not isinstance(result, dict) or result.get("ok") is not True:
        raise StagehandCrewAIResultError(
            "Stagehand code_execute returned an invalid result."
        )
    value = result.get("value")
    if not isinstance(value, dict):
        raise StagehandCrewAIResultError(
            "Stagehand code_execute returned an invalid result."
        )
    return value


def main() -> None:
    direct_marker = f"crewai-direct-{uuid4()}"
    model_marker = f"crewai-model-{uuid4()}"
    os.environ["CREWAI_HOST_ONLY_MARKER"] = f"host-{uuid4()}"
    model_tool_calls: list[str] = []
    final_state: dict[str, Any]

    with (
        StagehandSandboxLease() as connection,
        stagehand_code_tools(connection) as tools,
    ):
        code_execute = tools[0]
        first = successful_result(
            code_execute.run(
                code=f"""
await page.goto("https://example.com", {{ waitUntil: "domcontentloaded" }});
await page.evaluate((marker) => {{
  document.documentElement.dataset.crewaiDirectMarker = marker;
}}, {json.dumps(direct_marker)});
return {{
  pageId: page.pageId,
  title: await page.title(),
  directMarker: await page.evaluate(
    () => document.documentElement.dataset.crewaiDirectMarker,
  ),
  modelKeyVisible: process.env.OPENAI_API_KEY ?? null,
  hostMarkerVisible: process.env.CREWAI_HOST_ONLY_MARKER ?? null,
}};
"""
            )
        )
        assert first["title"] == "Example Domain"
        assert first["directMarker"] == direct_marker
        if (
            first["modelKeyVisible"] is not None
            or first["hostMarkerVisible"] is not None
        ):
            raise StagehandCrewAIIsolationError(
                "A host-only value crossed the CrewAI sandbox boundary."
            )

        second = successful_result(
            code_execute.run(
                code="""
return {
  pageId: page.pageId,
  title: await page.title(),
  directMarker: await page.evaluate(
    () => document.documentElement.dataset.crewaiDirectMarker,
  ),
};
"""
            )
        )
        assert second["title"] == "Example Domain"
        assert second["pageId"] == first["pageId"]
        assert second["directMarker"] == direct_marker

        @crewai_event_bus.on(ToolUsageFinishedEvent)
        def record_model_tool(_source: Any, event: ToolUsageFinishedEvent) -> None:
            if event.tool_name == "code_execute":
                model_tool_calls.append(event.tool_name)

        try:
            agent = build_stagehand_agent(tools)
            agent.kickoff(
                " ".join(
                    (
                        "Use code_execute to modify the already-open page.",
                        "Set document.documentElement.dataset.crewaiModelMarker to",
                        f"{json.dumps(model_marker)}.",
                        "Then read that dataset value and the current pageId and report them.",
                        "You must call code_execute; do not merely describe JavaScript.",
                    )
                )
            )
            assert crewai_event_bus.flush(), "CrewAI tool events did not finish"
        finally:
            crewai_event_bus.off(ToolUsageFinishedEvent, record_model_tool)
        assert model_tool_calls, "the real CrewAI model must select code_execute"

        final_state = successful_result(
            code_execute.run(
                code="""
return {
  pageId: page.pageId,
  title: await page.title(),
  directMarker: await page.evaluate(
    () => document.documentElement.dataset.crewaiDirectMarker,
  ),
  modelMarker: await page.evaluate(
    () => document.documentElement.dataset.crewaiModelMarker,
  ),
};
"""
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
                "framework": "crewai",
                "directToolCalls": 3,
                "modelToolCalls": len(model_tool_calls),
                "sessionPersisted": True,
                "modelCredentialIsolated": True,
                "finalState": final_state,
                "cleanup": ["crewai-mcp", "vercel-sandbox"],
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
