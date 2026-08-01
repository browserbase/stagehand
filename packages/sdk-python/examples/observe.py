import asyncio
import json
import os

from stagehand import Stagehand, local_browser

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
if not OPENAI_API_KEY:
    raise RuntimeError


async def main() -> None:
    browser = await local_browser.launch(headless=True)
    try:
        stagehand = await Stagehand.create(
            browser=browser,
            model="openai/gpt-5.4-mini",
            model_api_key=OPENAI_API_KEY,
        )
        try:
            page = await stagehand.context.active_page()
            if page is None:
                raise RuntimeError("Stagehand initialized without an active page")
            await page.goto("https://example.com")

            actions = await stagehand.observe(
                instruction="Find the link that provides more information about Example Domain",
            )

            print(
                json.dumps(
                    [action.model_dump(mode="json", by_alias=True) for action in actions.data],
                    indent=2,
                )
            )

            if not actions.data:
                raise RuntimeError("observe() returned no matching actions")
        finally:
            await stagehand.close()
    finally:
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
