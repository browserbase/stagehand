import asyncio
import os

from stagehand import Stagehand

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
if not OPENAI_API_KEY:
    raise RuntimeError


async def main() -> None:
    with open("stagehand.jsonl", "a", encoding="utf-8") as log_file:
        stagehand = Stagehand(
            browser="local",
            headless=True,
            model="openai/gpt-5.4-mini",
            model_api_key=OPENAI_API_KEY,
            logging={
                "level": "info",
                "format": "pretty",
                "on_log": lambda log: print(log.model_dump_json(), file=log_file),
            },
        )

        try:
            await stagehand.init()

            page = await stagehand.context.active_page()
            if page is None:
                raise RuntimeError

            await page.goto("https://example.com")
            print(await stagehand.observe(instruction="Find the Learn more link"))
        finally:
            await stagehand.close()


asyncio.run(main())
