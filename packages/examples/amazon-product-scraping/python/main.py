"""Scrape Amazon search results with Stagehand V4."""

import asyncio
import json
import os
from urllib.parse import quote_plus, urljoin

from dotenv import load_dotenv
from pydantic import BaseModel, Field, HttpUrl
from stagehand import Stagehand, browserbase

load_dotenv()

SEARCH_QUERY = "Seiko 5"


class Product(BaseModel):
    name: str
    price: str
    rating: str
    reviews_count: str
    product_url: HttpUrl = Field(description="Absolute Amazon product-detail href")


class Products(BaseModel):
    products: list[Product] = Field(description="First three Amazon search results")


async def main() -> None:
    api_key = os.environ.get("BROWSERBASE_API_KEY")
    if not api_key:
        raise RuntimeError("BROWSERBASE_API_KEY is required")

    browser = await browserbase.launch(api_key=api_key)
    try:
        stagehand = await Stagehand.create(
            browser=browser,
        )
        try:
            pages = await browser.context.pages()
            page = pages[0] if pages else await browser.context.new_page()
            await page.goto(
                "https://www.amazon.com",
                wait_until="domcontentloaded",
                timeout=60_000,
            )
            typed = await stagehand.act(
                f'Type "{SEARCH_QUERY}" into the search bar',
                page=page,
            )
            submitted = await stagehand.act("Click the search button", page=page)
            if not typed.data.success or not submitted.data.success:
                raise RuntimeError(
                    typed.data.message or submitted.data.message or "Amazon search failed"
                )
            page = await browser.context.active_page() or page
            try:
                results_ready = await page.wait_for_selector(
                    '[data-component-type="s-search-result"]',
                    timeout=10_000,
                )
            except Exception:
                results_ready = None
            if not results_ready:
                # Amazon can replace the document during submit and invalidate
                # the action frame. Use the direct URL only after that failure.
                search_url = f"https://www.amazon.com/s?k={quote_plus(SEARCH_QUERY)}"
                await page.goto(search_url, wait_until="domcontentloaded", timeout=60_000)
                await page.wait_for_selector(
                    '[data-component-type="s-search-result"]',
                    timeout=15_000,
                )
            extracted = await stagehand.extract(
                (
                    "Extract the details of the FIRST 3 products in the search results. "
                    "Return each product's full name, displayed price, star rating, review "
                    "count, and absolute product-page href. Each URL must be a real Amazon "
                    "link containing /dp/."
                ),
                Products,
                page=page,
            )
            products = extracted.data.products
            normalized = [
                {
                    **product.model_dump(mode="json"),
                    "product_url": urljoin("https://www.amazon.com", str(product.product_url)),
                }
                for product in products
            ]

            print(json.dumps({"products": normalized}, indent=2))
        finally:
            await stagehand.close()
    finally:
        await browser.close()
        print("Session closed successfully")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"Amazon product scraping failed: {error}")
        print("Docs: https://docs.stagehand.dev/v4/first-steps/introduction")
        raise
