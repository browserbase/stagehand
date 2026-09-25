"""Research a live Polymarket prediction market with Stagehand V4."""

import asyncio
import json
import os

from dotenv import load_dotenv
from pydantic import BaseModel

from stagehand import Stagehand, browserbase

load_dotenv()

SEARCH_QUERY = "Will Elon Musk rejoin the Trump administration in 2026"


class MarketData(BaseModel):
    market_title: str
    current_odds: str | None
    yes_price: str | None
    no_price: str | None
    total_volume: str | None
    price_change: str | None


async def main() -> None:
    api_key = os.environ.get("BROWSERBASE_API_KEY")
    if not api_key:
        raise RuntimeError("BROWSERBASE_API_KEY is required")

    print("Starting Polymarket research automation...")
    browser = await browserbase.launch(api_key=api_key)
    try:
        stagehand = await Stagehand.create(
            browser=browser,
        )
        try:
            pages = await browser.context.pages()
            page = pages[0] if pages else await browser.context.new_page()
            await page.goto("https://polymarket.com", wait_until="domcontentloaded", timeout=60_000)
            opened_search = await stagehand.act(
                "Click the search box at the top of the page", page=page
            )
            typed_search = await stagehand.act(
                "Fill the search box with %query%",
                page=page,
                variables={"query": SEARCH_QUERY},
            )
            opened_market = await stagehand.act(
                "Click the first matching market in the search results",
                page=page,
            )
            page = await browser.context.active_page() or page
            current_url = await page.url()
            market_url = (
                "https://polymarket.com/event/"
                "will-elon-musk-rejoin-the-trump-administration-in-2026"
            )
            if (
                not opened_search.data.success
                or not typed_search.data.success
                or not opened_market.data.success
                or "will-elon-musk-rejoin-the-trump-administration-in-2026" not in current_url
            ):
                await page.goto(
                    market_url,
                    wait_until="domcontentloaded",
                    timeout=60_000,
                )

            extracted = await stagehand.extract(
                "Extract the current odds and market information for this prediction market",
                MarketData,
                page=page,
            )
            market = extracted.data
            print(json.dumps(market.model_dump(mode="json"), indent=2))
        finally:
            await stagehand.close()
    finally:
        await browser.close()
        print("Session closed successfully")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"Application error: {error}")
        print("Docs: https://docs.stagehand.dev/v4/first-steps/introduction")
        raise
