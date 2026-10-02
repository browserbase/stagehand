import asyncio
import json
import os

from dotenv import load_dotenv
from stagehand import Stagehand, local_browser

load_dotenv()

WEBMCP_URL = os.environ.get(
    "WEBMCP_URL",
    "https://browserbase.github.io/stagehand-eval-sites/sites/webmcp-test/",
)
WEBMCP_TOOL = os.environ.get("WEBMCP_TOOL", "calculateSum")
WEBMCP_INPUT = os.environ.get("WEBMCP_INPUT", '{"a":19,"b":23}')


async def main() -> None:
    tool_input = json.loads(WEBMCP_INPUT)
    if not isinstance(tool_input, dict):
        raise RuntimeError("WEBMCP_INPUT must be a JSON object")
    browser = await local_browser.launch(headless=True)
    try:
        stagehand = await Stagehand.create(browser=browser)
        try:
            page = await browser.context.active_page()
            if page is None:
                raise RuntimeError("No active page")

            await page.goto(WEBMCP_URL)

            tools = await page.tools(timeout=5_000)
            if not tools:
                raise RuntimeError(
                    f"No WebMCP tools on {WEBMCP_URL} (browser opened {await page.url()}). "
                    "Check browser support and page registration."
                )

            tool = next((candidate for candidate in tools if candidate.name == WEBMCP_TOOL), None)
            if tool is None:
                names = ", ".join(candidate.name for candidate in tools)
                raise RuntimeError(f"Expected tool {WEBMCP_TOOL}, found: {names}")

            invocation = await tool.invoke(input=tool_input)
            result = await invocation.result()
            if result.status != "Completed":
                raise RuntimeError(
                    f"Tool {WEBMCP_TOOL} finished with status {result.status}: {result.error_text}"
                )
            print(result.model_dump_json(indent=2))

        finally:
            await stagehand.close()
    finally:
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
