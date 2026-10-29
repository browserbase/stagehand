"""Exercise the examples' real agent graphs without a browser or provider calls."""

from __future__ import annotations

import ast
import contextlib
import io
import re
import sys
import unittest
from collections import Counter
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, patch

from deepagents import create_deep_agent
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage
from langchain_core.utils.function_calling import convert_to_openai_tool
from pydantic import Field

LOCAL = Path(__file__).resolve().parents[1]
DOCS = LOCAL.parents[3] / "docs/v4/integrations/agent-frameworks/deep-agents.mdx"
BROWSER_TOOLS = {"run", "snapshot", "screenshot"}


class DelegatingModel(FakeMessagesListChatModel):
    bindings: list[list[str]] = Field(default_factory=list)

    def bind_tools(self, tools: list[object], **kwargs: object) -> DelegatingModel:
        self.bindings.append([convert_to_openai_tool(tool)["function"]["name"] for tool in tools])
        return self


def tool_call(name: str, arguments: dict[str, object], call_id: str) -> AIMessage:
    return AIMessage(
        content="",
        tool_calls=[{"name": name, "args": arguments, "id": call_id}],
    )


class DelegationTests(unittest.IsolatedAsyncioTestCase):
    async def test_examples_and_quickstart_delegate_browser_work(self) -> None:
        quickstart = re.search(r"```python\n(.*?)\n```", DOCS.read_text(), re.DOTALL)
        self.assertIsNotNone(quickstart)
        assert quickstart is not None
        cases = [
            (LOCAL / "agent.py", (LOCAL / "agent.py").read_text(), {"events": []}),
            (
                LOCAL / "agents2.py",
                (LOCAL / "agents2.py").read_text(),
                {"url": "https://example.test/", "fields": [], "completed": True},
            ),
            (DOCS, quickstart.group(1), None),
        ]
        for path, source, structured_result in cases:
            with self.subTest(consumer=path.name):
                await self.exercise_main(path, source, structured_result)

    async def exercise_main(
        self, path: Path, source: str, structured_result: dict[str, object] | None
    ) -> None:
        page = SimpleNamespace(page_id="fixture")
        browser = SimpleNamespace(
            context=SimpleNamespace(active_page=AsyncMock(return_value=page)),
            close=AsyncMock(),
        )
        # Keep the published middleware and facade real; stub only the SDK boundary.
        batch = AsyncMock(
            return_value={
                "__stagehandPlaywrightCompat": True,
                "value": "browser result",
                "closeRequested": False,
                "batchRuntimeMs": 1,
                "telemetry": {},
                "artifacts": [],
            }
        )
        stagehand = SimpleNamespace(browser=browser, experimental_batch=batch)
        model = DelegatingModel(responses=[])

        def build_agent(**options: object) -> object:
            response_format = options.get("response_format")
            final = (
                tool_call(response_format.__name__, structured_result, "structured-result")
                if response_format is not None
                else AIMessage(content="Delegation complete")
            )
            model.responses = [
                tool_call("run", {"code": "return 'parent';"}, "parent-browser"),
                tool_call(
                    "task",
                    {"subagent_type": "general-purpose", "description": "Use the browser."},
                    "delegate",
                ),
                tool_call("run", {"code": "return 'child';"}, "child-browser"),
                AIMessage(content="Delegated browser work complete"),
                final,
            ]
            return create_deep_agent(**{**options, "model": model})

        tree = ast.parse(source, filename=str(path))
        # The documentation snippet starts its own event loop; invoke its main in
        # unittest's loop instead. The agent construction and invocation stay intact.
        if path == DOCS:
            self.assertEqual(ast.unparse(tree.body.pop()), "asyncio.run(main())")
        module = ModuleType("delegation_example")
        module.__file__ = str(path)
        with (
            patch.dict(sys.modules, {module.__name__: module}),
            patch.dict(
                "os.environ",
                {
                    "BROWSERBASE_API_KEY": "test-key",
                    "LANGSMITH_TRACING": "false",
                    "LANGCHAIN_TRACING_V2": "false",
                },
            ),
            patch("dotenv.load_dotenv"),
            patch("deepagents.create_deep_agent", side_effect=build_agent),
            patch("stagehand.local_browser.launch", new=AsyncMock(return_value=browser)),
            patch("stagehand.browserbase.launch", new=AsyncMock(return_value=browser)),
            patch("stagehand.Stagehand.create", new=AsyncMock(return_value=stagehand)),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            exec(compile(tree, str(path), "exec"), module.__dict__)
            await module.main()

        self.assertEqual(batch.await_count, 2, "Both parent and delegated run must reach the SDK")
        self.assertIn("return 'parent';", batch.await_args_list[0].args[0])
        self.assertIn("return 'child';", batch.await_args_list[1].args[0])
        self.assertEqual({"task" in names for names in model.bindings}, {False, True})
        for names in model.bindings:
            counts = Counter(names)
            self.assertEqual(
                {name: counts[name] for name in BROWSER_TOOLS}, dict.fromkeys(BROWSER_TOOLS, 1)
            )
        browser.close.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
