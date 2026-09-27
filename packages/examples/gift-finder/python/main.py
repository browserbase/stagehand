"""Find, score, and verify live gift recommendations with Stagehand V4."""

import asyncio
import json
import os
from urllib.parse import urljoin, urlparse

from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel, Field

from stagehand import Stagehand, browserbase

load_dotenv()

RECIPIENT = "Friend"
DESCRIPTION = "loves cooking and trying new recipes"


class Product(BaseModel):
    title: str
    url: str
    price: str
    rating: str
    ai_score: int | None
    ai_reason: str | None


class Products(BaseModel):
    products: list[Product] = Field(max_length=3)


class ProductScore(BaseModel):
    product_index: int = Field(alias="productIndex")
    score: int = Field(ge=1, le=10)
    reason: str = Field(min_length=1, max_length=100)


def openai_client() -> tuple[OpenAI, str]:
    gateway_key = os.environ.get("AI_GATEWAY_API_KEY")
    if gateway_key:
        return (
            OpenAI(api_key=gateway_key, base_url="https://ai-gateway.vercel.sh/v1"),
            "openai/gpt-4.1",
        )
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("AI_GATEWAY_API_KEY or OPENAI_API_KEY is required")
    return OpenAI(api_key=key), "gpt-4.1"


def generate_search_queries() -> list[str]:
    client, model = openai_client()
    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "user",
                "content": (
                    "Generate exactly three short gift search queries of one or two words "
                    f"for a {RECIPIENT.lower()} who {DESCRIPTION}. Focus on thoughtful "
                    "accessories, upgrades, and related unexpected items rather than basic "
                    "necessities. Return one plain query per line with no bullets."
                ),
            }
        ],
        max_completion_tokens=200,
    )
    content = response.choices[0].message.content or ""
    queries = [line.strip(" -0123456789.\t") for line in content.splitlines() if line.strip()]
    if len(queries) != 3:
        raise RuntimeError(f"OpenAI returned {len(queries)} queries instead of three")
    return queries


def score_products(products: list[Product]) -> list[Product]:
    product_list = "\n".join(
        f"{index + 1}. {product.title} - {product.price} - {product.rating}"
        for index, product in enumerate(products)
    )
    client, model = openai_client()
    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "user",
                "content": (
                    f"Score every gift from 1-10 for a {RECIPIENT.lower()} who {DESCRIPTION}. "
                    "Return only a JSON array where every object has productIndex, score, "
                    f"and a reason under 100 characters.\n\n{product_list}"
                ),
            }
        ],
        max_completion_tokens=1_000,
    )
    content = (response.choices[0].message.content or "[]").strip()
    content = content.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    raw_scores = json.loads(content)
    scores = [ProductScore.model_validate(item) for item in raw_scores]
    expected_indexes = set(range(1, len(products) + 1))
    if (
        len(scores) != len(products)
        or {score.product_index for score in scores} != expected_indexes
    ):
        raise RuntimeError("OpenAI did not return one unique score for every product")

    by_index = {score.product_index: score for score in scores}
    scored = []
    for index, product in enumerate(products, start=1):
        score = by_index[index]
        scored.append(
            product.model_copy(update={"ai_score": score.score, "ai_reason": score.reason})
        )
    return sorted(scored, key=lambda product: product.ai_score or 0, reverse=True)


async def search_products(query: str, index: int) -> list[Product]:
    api_key = os.environ.get("BROWSERBASE_API_KEY")
    if not api_key:
        raise RuntimeError("BROWSERBASE_API_KEY is required")

    print(f"Search {index + 1}: {query}")
    browser = await browserbase.launch(api_key=api_key, region="us-east-1")
    try:
        stagehand = await Stagehand.create(
            browser=browser,
        )
        try:
            pages = await browser.context.pages()
            page = pages[0] if pages else await browser.context.new_page()
            await page.goto("https://firebox.eu/", wait_until="domcontentloaded", timeout=60_000)
            await stagehand.act(f"Type {query} into the search bar", page=page)
            await stagehand.act("Click the search button", page=page)
            await page.wait_for_timeout(1_000)
            extracted = await stagehand.extract(
                "Extract the first three products from the search results",
                Products,
                page=page,
            )
            base_url = await page.url()
            products = []
            for product in extracted.data.products:
                if not product.title.strip() or not product.url.strip():
                    continue
                absolute_url = urljoin(base_url, product.url)
                parsed_url = urlparse(absolute_url)
                if parsed_url.scheme in {"http", "https"} and parsed_url.hostname:
                    products.append(product.model_copy(update={"url": absolute_url}))
            if not products:
                raise RuntimeError(f"No products found for {query!r}")
            return products
        finally:
            await stagehand.close()
    finally:
        await browser.close()


async def main() -> None:
    if len(DESCRIPTION.strip()) < 5:
        raise RuntimeError("Recipient description is too short")
    queries = await asyncio.to_thread(generate_search_queries)
    print(f"Generated queries: {queries}")

    products: list[Product] = []
    for index, query in enumerate(queries):
        try:
            products.extend(await search_products(query, index))
        except Exception as error:
            print(f"Search {index + 1} produced no usable products: {error}")
    if len(products) < 3:
        raise RuntimeError(f"Expected at least three products, received {len(products)}")

    scored = await asyncio.to_thread(score_products, products)
    top_three = scored[:3]
    if len(top_three) != 3 or any(product.ai_score is None for product in top_three):
        raise RuntimeError("Gift ranking did not produce three scored recommendations")
    print("Top three recommendations:")
    print(json.dumps([product.model_dump(mode="json") for product in top_three], indent=2))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"Gift finder failed: {error}")
        raise SystemExit(1) from error
