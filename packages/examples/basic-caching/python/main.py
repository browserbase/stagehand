"""Prove a repeated Stagehand V4 observation is served from cache."""

import asyncio
import json
import os
import time

from dotenv import load_dotenv

from stagehand import Stagehand, browserbase

load_dotenv()

INSTRUCTION = "Find the More information link"


async def main() -> None:
    api_key = os.environ.get("BROWSERBASE_API_KEY")
    if not api_key:
        raise RuntimeError("BROWSERBASE_API_KEY is required")

    browser = await browserbase.launch(api_key=api_key)
    try:
        stagehand = await Stagehand.create(
            browser=browser,
            cache={"threshold": 1},
        )
        try:
            pages = await browser.context.pages()
            page = pages[0] if pages else await browser.context.new_page()
            await page.goto("https://example.com", wait_until="domcontentloaded")

            started = time.perf_counter()
            first = await stagehand.observe(INSTRUCTION, page=page)
            first_ms = round((time.perf_counter() - started) * 1_000)
            if not first.data:
                raise RuntimeError("First observation returned no link")

            started = time.perf_counter()
            second = await stagehand.observe(INSTRUCTION, page=page)
            second_ms = round((time.perf_counter() - started) * 1_000)
            if not second.data:
                raise RuntimeError("Second observation returned no link")

            first_cache = first.metadata.cache
            second_cache = second.metadata.cache
            report = {
                "first": {
                    "cache": first_cache.status if first_cache else "DISABLED",
                    "duration_ms": first_ms,
                },
                "second": {
                    "cache": second_cache.status if second_cache else "DISABLED",
                    "duration_ms": second_ms,
                    "tokens_saved": (
                        second_cache.tokens_saved.model_dump(mode="json")
                        if second_cache and second_cache.tokens_saved
                        else None
                    ),
                },
            }
            print(json.dumps(report, indent=2))
            if second_cache is None or second_cache.status != "HIT":
                status = second_cache.status if second_cache else "DISABLED"
                raise RuntimeError(f"Expected a cache HIT, received {status}")
            print("Cache verified: repeated observation avoided inference")
        finally:
            await stagehand.close()
    finally:
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
