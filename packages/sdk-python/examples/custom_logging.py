import asyncio
import os

from stagehand import Stagehand, StagehandClientLoggingConfig, local_browser

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
if not OPENAI_API_KEY:
    raise RuntimeError


async def main() -> None:
    with open("stagehand.jsonl", "a", encoding="utf-8") as log_file:
        browser = await local_browser.launch(headless=True)
        try:
            stagehand = await Stagehand.create(
                browser=browser,
                model="openai/gpt-5.4-mini",
                model_api_key=OPENAI_API_KEY,
                logging=StagehandClientLoggingConfig(
                    level="info",
                    format="pretty",
                    on_log=lambda log: print(log.model_dump_json(), file=log_file),
                ),
            )
            try:
                page = await stagehand.context.active_page()
                if page is None:
                    raise RuntimeError

                await page.goto("https://example.com")
                print(await stagehand.observe(instruction="Find the Learn more link"))
            finally:
                await stagehand.close()
        finally:
            await browser.close()


asyncio.run(main())
