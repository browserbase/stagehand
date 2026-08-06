import asyncio
import json
import os

from pydantic import BaseModel

from stagehand import Stagehand, browserbase

BROWSERBASE_API_KEY = os.environ["BROWSERBASE_API_KEY"]
if not BROWSERBASE_API_KEY:
    raise RuntimeError
BROWSERBASE_API_URL = "https://api.browserbase.com"
STAGEHAND_API_URL = "https://api.stagehand.browserbase.com"


class PageInfo(BaseModel):
    heading: str
    domain: str


async def main() -> None:
    # With no model, Browserbase Model Gateway selects one automatically for
    # each inference call. The Browserbase API key and session authenticate it.
    browser = await browserbase.launch(
        api_key=BROWSERBASE_API_KEY,
        api_url=BROWSERBASE_API_URL,
    )
    try:
        stagehand = await Stagehand.create(browser=browser, api_url=STAGEHAND_API_URL)
        try:
            page = (await browser.context.pages())[0]
            if page is None:
                raise RuntimeError("Stagehand initialized without an active page")
            await page.goto("https://example.com")

            page_info = await stagehand.extract(
                "Extract the page heading and the domain this page says it is for",
                PageInfo,
            )

            print(json.dumps(page_info.model_dump(mode="json"), indent=2))
        finally:
            await stagehand.close()
    finally:
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
