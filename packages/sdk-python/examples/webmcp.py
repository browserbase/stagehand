import asyncio

from stagehand import Stagehand, local_browser

WEBMCP_TEST_SITE = "https://browserbase.github.io/stagehand-eval-sites/sites/webmcp-test/"


async def main() -> None:
    browser = await local_browser.launch(headless=False)
    try:
        stagehand = await Stagehand.create(browser=browser)
        try:
            page = await stagehand.context.active_page()
            if page is None:
                raise RuntimeError("Stagehand initialized without an active page")
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
        finally:
            await stagehand.close()
    finally:
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
