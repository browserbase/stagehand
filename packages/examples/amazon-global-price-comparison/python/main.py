"""Compare live Amazon prices through regional proxies with Stagehand V4."""

import asyncio
import json
import os
from dataclasses import asdict, dataclass
from urllib.parse import quote_plus, urljoin

from dotenv import load_dotenv
from pydantic import BaseModel, Field, HttpUrl
from stagehand import BrowserbaseProxyConfig, Stagehand, browserbase

load_dotenv()


class Product(BaseModel):
    name: str
    price: str
    rating: str
    reviews_count: str
    product_url: HttpUrl = Field(description="Absolute Amazon product-detail href")


class Products(BaseModel):
    products: list[Product]


@dataclass(frozen=True)
class Country:
    name: str
    code: str
    domain: str
    currency: str
    city: str | None = None


@dataclass
class CountryResult:
    country: str
    country_code: str
    currency: str
    products: list[dict]
    error: str | None = None


COUNTRIES = [
    Country("United States", "US", "www.amazon.com", "USD"),
    Country("United Kingdom", "GB", "www.amazon.co.uk", "GBP", "LONDON"),
    Country("Germany", "DE", "www.amazon.de", "EUR", "BERLIN"),
    Country("France", "FR", "www.amazon.fr", "EUR", "PARIS"),
    Country("Italy", "IT", "www.amazon.it", "EUR", "ROME"),
    Country("Spain", "ES", "www.amazon.es", "EUR", "MADRID"),
]


async def products_for_country(
    query: str,
    country: Country,
    result_count: int,
) -> CountryResult:
    api_key = os.environ.get("BROWSERBASE_API_KEY")
    if not api_key:
        raise RuntimeError("BROWSERBASE_API_KEY is required")
    proxy: BrowserbaseProxyConfig = {
        "type": "browserbase",
        "geolocation": {
            "country": country.code,
            **({"city": country.city} if country.city else {}),
        },
    }

    browser = await browserbase.launch(api_key=api_key, proxies=[proxy])
    try:
        stagehand = await Stagehand.create(
            browser=browser,
        )
        try:
            pages = await browser.context.pages()
            page = pages[0] if pages else await browser.context.new_page()
            origin = f"https://{country.domain}"
            await page.goto(origin, wait_until="domcontentloaded", timeout=60_000)
            semantic_search_succeeded = False
            try:
                typed = await stagehand.act(f'Type "{query}" into the search bar', page=page)
                submitted = await stagehand.act("Click the search button", page=page)
                semantic_search_succeeded = typed.data.success and submitted.data.success
            except Exception as error:
                print(
                    f"[{country.name}] Semantic search failed; "
                    f"checking results before fallback: {error}"
                )
            page = await browser.context.active_page() or page
            results_ready = None
            if semantic_search_succeeded:
                try:
                    results_ready = await page.wait_for_selector(
                        '[data-component-type="s-search-result"]',
                        timeout=10_000,
                    )
                except Exception:
                    results_ready = None
            if not results_ready:
                search_url = f"{origin}/s?k={quote_plus(query)}"
                await page.goto(search_url, wait_until="domcontentloaded", timeout=60_000)
                await page.wait_for_selector(
                    '[data-component-type="s-search-result"]',
                    timeout=15_000,
                )
            extracted = await stagehand.extract(
                (
                    f"Extract the first {result_count} product search results. For each product, "
                    "return the full title, displayed price with currency symbol or N/A, star "
                    "rating, review count, and absolute product-page href. Each URL must be a "
                    "real Amazon link containing /dp/. "
                    "Only include actual listings."
                ),
                Products,
                page=page,
            )
            products = [
                {
                    **product.model_dump(mode="json"),
                    "product_url": urljoin(origin, str(product.product_url)),
                }
                for product in extracted.data.products[:result_count]
            ]
            return CountryResult(
                country=country.name,
                country_code=country.code,
                currency=country.currency,
                products=products,
            )
        finally:
            await stagehand.close()
    except Exception as error:
        return CountryResult(
            country=country.name,
            country_code=country.code,
            currency=country.currency,
            products=[],
            error=str(error),
        )
    finally:
        await browser.close()


async def main() -> None:
    query = "iPhone 15 Pro Max 256GB"
    result_count = 3
    country_limit = int(os.environ.get("MAX_COUNTRIES", str(len(COUNTRIES))))
    selected = COUNTRIES[:country_limit]
    results = await asyncio.gather(
        *(products_for_country(query, country, result_count) for country in selected)
    )
    print(json.dumps([asdict(result) for result in results], indent=2))


if __name__ == "__main__":
    asyncio.run(main())
