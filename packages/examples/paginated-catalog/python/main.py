import asyncio
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel, Field
from stagehand import Stagehand, browserbase

load_dotenv()


class Book(BaseModel):
    title: str = Field(min_length=1)
    price: str = Field(min_length=1)
    availability: str = Field(min_length=1)


class CatalogPage(BaseModel):
    books: list[Book] = Field(min_length=1)


async def main() -> None:
    api_key = os.environ.get("BROWSERBASE_API_KEY")
    if not api_key:
        raise RuntimeError("BROWSERBASE_API_KEY is required")
    provider = os.environ.get("MODEL_PROVIDER")
    if provider not in (None, "gateway"):
        raise RuntimeError("MODEL_PROVIDER must be gateway or unset")
    openai_key = os.environ.get("OPENAI_API_KEY")
    if provider != "gateway" and not openai_key:
        raise RuntimeError("OPENAI_API_KEY is required unless MODEL_PROVIDER=gateway")
    max_pages = int(os.environ.get("MAX_PAGES", "50"))
    if max_pages < 1:
        raise RuntimeError("MAX_PAGES must be a positive integer")

    browser = await browserbase.launch(api_key=api_key)
    try:
        stagehand = await Stagehand.create(
            browser=browser,
            **({} if provider == "gateway" else {
                "model": "openai/gpt-5.4-mini", "model_api_key": openai_key
            }),
        )
        try:
            page = await browser.context.active_page()
            if page is None:
                raise RuntimeError("No active page")
            await page.goto(os.environ.get("CATALOG_URL", "https://books.toscrape.com/"))
            visited: set[str] = set()
            books: list[Book] = []
            for index in range(max_pages):
                url = await page.url()
                if url in visited:
                    raise RuntimeError(f"Pagination cycle at {url}")
                visited.add(url)
                result = await stagehand.extract(
                    "Extract every book in the product grid, including title, displayed price, and availability.",
                    CatalogPage, page=page,
                )
                books.extend(CatalogPage.model_validate(result.data).books)
                next_actions = (await stagehand.observe(
                    "Find the enabled Next pagination link. Return no actions if there is no next page.",
                    page=page,
                )).data
                if not next_actions:
                    output = Path("out/catalog.json")
                    output.parent.mkdir(exist_ok=True)
                    output.write_text(json.dumps({
                        "pages": len(visited), "count": len(books),
                        "books": [book.model_dump() for book in books],
                    }, indent=2) + "\n")
                    print(f"Saved {len(books)} books from {len(visited)} pages to {output}")
                    break
                if index + 1 == max_pages:
                    raise RuntimeError(f"MAX_PAGES={max_pages} reached before the final page")
                acted = await stagehand.act(next_actions[0], page=page)
                if not acted.data.success:
                    raise RuntimeError(f"Next-page act failed: {acted.data.message}")
                await page.wait_for_load_state("domcontentloaded")
                if await page.url() == url:
                    raise RuntimeError(f"Next-page action did not navigate from {url}")
        finally:
            await stagehand.close()
    finally:
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
