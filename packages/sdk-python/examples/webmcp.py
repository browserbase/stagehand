import asyncio

from stagehand import Stagehand, WebMCPTool, WebMCPToolIdentity, local_browser

WEBMCP_TEST_SITE = "https://browserbase.github.io/stagehand-eval-sites/sites/webmcp-test/"


def tools_added(tools: list[WebMCPTool]) -> None:
    for tool in tools:
        print("Tool added:", tool.name, tool.frame_id)


async def main() -> None:
    removal_received = asyncio.Event()

    def tools_removed(tools: list[WebMCPToolIdentity]) -> None:
        for tool in tools:
            print("Tool removed:", tool.name, tool.frame_id)
        if tools:
            removal_received.set()

    browser = await local_browser.launch(headless=False)
    try:
        stagehand = await Stagehand.create(browser=browser)
        try:
            page = (await browser.context.pages())[0]
            if page is None:
                raise RuntimeError("Stagehand initialized without an active page")
            # Subscribe before navigation: hooks report future changes, not existing tools.
            added = await page.on_tools_added(tools_added)
            removed = await page.on_tools_removed(tools_removed)
            await page.goto(WEBMCP_TEST_SITE)

            tools = await page.tools(timeout=5_000)
            calculate_sum = next(
                (tool for tool in tools if tool.name == "calculateSum"),
                None,
            )
            if calculate_sum is None:
                raise RuntimeError("calculateSum was not registered by the page")

            invocation = await calculate_sum.invoke(input={"a": 19, "b": 23})
            result = await invocation.result()

            print(result.model_dump_json(indent=2))

            # Leaving the document removes its registered tools.
            await page.goto("about:blank")
            await asyncio.wait_for(removal_received.wait(), timeout=5)
            await added.unsubscribe()
            await removed.unsubscribe()
        finally:
            await stagehand.close()
    finally:
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
