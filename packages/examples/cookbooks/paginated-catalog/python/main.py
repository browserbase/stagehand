import asyncio
import json
import os
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field
from stagehand import Stagehand, browserbase

load_dotenv()


class Book(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=1)
    price: str = Field(min_length=1)
    availability: str = Field(min_length=1)


class CatalogPage(BaseModel):
    books: list[Book] = Field(min_length=1)


class SavedPage(CatalogPage):
    url: str


class Checkpoint(BaseModel):
    version: Literal[1] = 1
    source: str
    complete: bool = False
    pages: list[SavedPage] = Field(default_factory=list)


def atomic_json(path: Path, data: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as file:
        os.chmod(temporary, 0o600)
        file.write(json.dumps(data, indent=2) + "\n")
    temporary.replace(path)


async def main() -> None:
    api_key = os.environ.get("BROWSERBASE_API_KEY")
    if not api_key:
        raise RuntimeError("BROWSERBASE_API_KEY is required")
    openai_key = os.environ.get("OPENAI_API_KEY")
    if not openai_key:
        raise RuntimeError("OPENAI_API_KEY is required")
    max_pages = int(os.environ.get("MAX_PAGES", "2"))
    if not 1 <= max_pages <= 100:
        raise RuntimeError("MAX_PAGES must be an integer between 1 and 100")

    browser = await browserbase.launch(api_key=api_key, timeout=300)
    try:
        print(f"Session: https://www.browserbase.com/sessions/{browser.session_id}")
        stagehand = await Stagehand.create(
            browser=browser,
            model="openai/gpt-5.6-sol",
            model_api_key=openai_key,
        )
        try:
            page = await browser.context.active_page()
            if page is None:
                raise RuntimeError("No active page")
            source = os.environ.get(
                "CATALOG_URL",
                "https://books.toscrape.com/catalogue/category/books/mystery_3/index.html",
            )
            origin = urlsplit(source)
            if origin.scheme not in ("http", "https") or not origin.netloc:
                raise RuntimeError("CATALOG_URL must use HTTP or HTTPS")
            output_dir = Path(os.environ.get("OUT_DIR", "out"))
            output_dir.mkdir(parents=True, exist_ok=True)
            checkpoint_path = output_dir / "checkpoint.json"
            state = (
                Checkpoint.model_validate_json(checkpoint_path.read_text())
                if checkpoint_path.exists()
                else Checkpoint(source=source)
            )
            if state.complete and not state.pages:
                raise RuntimeError("Completed checkpoint has no pages")
            if state.source != source:
                raise RuntimeError(
                    "Checkpoint belongs to another CATALOG_URL; use a fresh output directory"
                )
            visited = {saved.url for saved in state.pages}
            if len(visited) != len(state.pages) or any(
                urlsplit(saved.url)[:2] != origin[:2] for saved in state.pages
            ):
                raise RuntimeError(
                    "Checkpoint contains a cycle or an unapproved origin"
                )
            if not state.complete:
                saved_url = state.pages[-1].url if state.pages else None
                await page.goto(saved_url or source)
                revisit = saved_url is not None
                while True:
                    url = await page.url()
                    if urlsplit(url)[:2] != origin[:2]:
                        raise RuntimeError(f"Navigation left the catalog origin: {url}")
                    if revisit and url != saved_url:
                        raise RuntimeError(
                            "Checkpoint page redirected; start a fresh export"
                        )
                    if not revisit:
                        if url in visited:
                            raise RuntimeError(f"Pagination cycle at {url}")
                        if len(state.pages) >= max_pages:
                            raise RuntimeError(
                                f"MAX_PAGES={max_pages} reached; checkpoint saved"
                            )
                        result = await stagehand.extract(
                            "Extract every book in the product grid, "
                            "including title, displayed price, and availability.",
                            CatalogPage,
                            page=page,
                        )
                        books = CatalogPage.model_validate(result.data).books
                        state.pages.append(SavedPage(url=url, books=books))
                        visited.add(url)
                        atomic_json(checkpoint_path, state.model_dump())
                    revisit = False
                    if (
                        await page.locator(
                            os.environ.get("NEXT_SELECTOR", "li.next a")
                        ).count()
                        == 0
                    ):
                        state.complete = True
                        atomic_json(checkpoint_path, state.model_dump())
                        break
                    next_actions = (
                        await stagehand.observe(
                            "Find the enabled Next pagination link. "
                            "Return no actions if there is no next page.",
                            page=page,
                        )
                    ).data
                    if not next_actions:
                        raise RuntimeError(
                            "Next link exists but observe returned no action"
                        )
                    acted = await stagehand.act(next_actions[0], page=page)
                    if not acted.data.success:
                        raise RuntimeError(
                            f"Next-page act failed: {acted.data.message}"
                        )
                    await page.wait_for_load_state("domcontentloaded")
                    if await page.url() == url:
                        raise RuntimeError(
                            f"Next-page action did not navigate from {url}"
                        )
            unique = {}
            for saved in state.pages:
                for book in saved.books:
                    unique[(book.title, book.price, book.availability)] = (
                        book.model_dump()
                    )
            output = output_dir / "catalog.json"
            atomic_json(
                output,
                {
                    "pages": len(state.pages),
                    "count": len(unique),
                    "books": list(unique.values()),
                },
            )
            print(
                f"Saved {len(unique)} books from {len(state.pages)} pages to {output}"
            )
        finally:
            await stagehand.close()
    finally:
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
