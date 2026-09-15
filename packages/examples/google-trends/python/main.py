"""Extract current Google Trends keywords with Stagehand V4."""

import asyncio
import json
import os
from datetime import UTC, datetime

from dotenv import load_dotenv
from pydantic import BaseModel, Field, RootModel
from stagehand import Stagehand, browserbase

load_dotenv()

COUNTRY_CODE = "US"
LANGUAGE = "en-US"
LIMIT = 20


class TrendingKeyword(BaseModel):
    rank: int = Field(description="Position in the visible trending list")
    keyword: str = Field(description="Main trending search term")


class TrendingKeywords(RootModel[list[TrendingKeyword]]):
    pass


async def main() -> None:
    api_key = os.environ.get("BROWSERBASE_API_KEY")
    if not api_key:
        raise RuntimeError("BROWSERBASE_API_KEY is required")

    print(f"Extracting up to {LIMIT} Google Trends keywords for {COUNTRY_CODE}")
    browser = await browserbase.launch(api_key=api_key)
    try:
        stagehand = await Stagehand.create(
            browser=browser,
        )
        try:
            pages = await browser.context.pages()
            page = pages[0] if pages else await browser.context.new_page()
            url = f"https://trends.google.com/trending?geo={COUNTRY_CODE.upper()}&hl={LANGUAGE}"
            await page.goto(url, wait_until="networkidle", timeout=60_000)

            try:
                await stagehand.act(
                    'Click the "Got it" button if it is visible',
                    page=page,
                    timeout=5_000,
                )
            except Exception:
                print("No consent dialog found")

            extracted = await stagehand.extract(
                (
                    "Extract the visible trending search keywords from the table. "
                    "Assign rank 1 to the first row and continue in order. "
                    f"Return at most {LIMIT} items."
                ),
                TrendingKeywords,
                page=page,
            )
            keywords = extracted.data.root[:LIMIT]
            output = {
                "country_code": COUNTRY_CODE,
                "language": LANGUAGE,
                "extracted_at": datetime.now(UTC).isoformat(),
                "trending_keywords": [item.model_dump() for item in keywords],
            }
            print(json.dumps(output, indent=2))
        finally:
            await stagehand.close()
    finally:
        await browser.close()
        print("Session closed successfully")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"Google Trends extraction failed: {error}")
        print("Docs: https://docs.stagehand.dev/v4/first-steps/introduction")
        raise
