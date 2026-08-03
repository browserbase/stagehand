import asyncio
import json
import os

from pydantic import BaseModel

from stagehand import Stagehand, browserbase

BROWSERBASE_API_KEY = os.environ["BROWSERBASE_API_KEY"]
if not BROWSERBASE_API_KEY:
    raise RuntimeError


class PageInfo(BaseModel):
    heading: str
    domain: str


async def main() -> None:
    # No model_api_key: inference routes through the Browserbase Model Gateway,
    # authenticated by the Browserbase API key and session.
    browser = await browserbase.launch(api_key=BROWSERBASE_API_KEY)
    try:
        stagehand = await Stagehand.create(
            browser=browser,
            model="openai/gpt-4.1",
        )
        try:
            page = await stagehand.context.active_page()
            if page is None:
                raise RuntimeError("Stagehand initialized without an active page")
            await page.goto("https://example.com")

            page_info = await stagehand.extract(
                instruction="Extract the page heading and the domain this page says it is for",
                schema=PageInfo,
            )

            print(json.dumps(page_info.model_dump(mode="json"), indent=2))
        finally:
            await stagehand.close()
    finally:
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
