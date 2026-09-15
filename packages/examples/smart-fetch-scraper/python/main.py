# Stagehand + Browserbase: Smart Fetch Scraper - See README.md for full documentation
#
# Tries the Browserbase Fetch API first (fast, no browser session needed).
# If the page is JS-rendered or the content is insufficient, falls back to
# a full Stagehand browser session with AI-powered extraction.
#
# Note: the Fetch API can return content as `raw` HTML, clean `markdown`,
# or schema-extracted `json` — pass `format="markdown"` or `format="json"`
# (with a JSON schema) to `bb.fetch_api.create` to skip writing your own
# HTML parser. Docs: https://docs.browserbase.com/platform/fetch/overview

import asyncio
import json
import os
import re
import sys

from browserbase import Browserbase
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from stagehand import Stagehand, browserbase

# Load environment variables from .env file
load_dotenv()

# ============= CONFIGURATION =============

# Minimum character threshold — if Fetch API returns less than this,
# the page is likely JS-rendered and we fall back to a browser session.
MIN_CONTENT_LENGTH = 500

# Minimum ratio of visible text to raw HTML — pages below this are likely shells.
MIN_TEXT_DENSITY = 0.05

# Patterns that indicate the page requires JavaScript to render real content.
JS_REQUIRED_PATTERNS = [
    re.compile(r"enable javascript", re.IGNORECASE),
    re.compile(r"javascript is (required|disabled|not enabled)", re.IGNORECASE),
    re.compile(r"please enable javascript", re.IGNORECASE),
    re.compile(r"this (site|page|app) requires javascript", re.IGNORECASE),
    re.compile(r"checking your browser", re.IGNORECASE),  # Cloudflare challenge
    re.compile(r"<noscript>[^<]{200,}", re.IGNORECASE),  # large noscript block = JS-gated content
]


# Schema for the structured data extracted by the browser fallback.
# Adapt this to match the content you want to pull from the target page.
class PageItem(BaseModel):
    """Schema for an individual page item."""

    title: str = Field(description="The headline or item title")
    url: str = Field(description="The link URL")
    metadata: str = Field(description="Any subtitle, score, author, or timestamp info")


class PageDataSchema(BaseModel):
    """Schema for extracted page data."""

    title: str = Field(description="The page title")
    items: list[PageItem] = Field(
        description="The main list of items, articles, or entries on the page"
    )


# =========================================


def needs_browser_fallback(content: str, status_code: int) -> str | None:
    """
    Returns the reason the Fetch API result should trigger a browser fallback,
    or None if the content looks usable.
    """
    # Non-2xx status: the page didn't load successfully
    if status_code < 200 or status_code >= 300:
        return f"non-2xx status code ({status_code})"

    # Too short: likely a JS shell
    if len(content) < MIN_CONTENT_LENGTH:
        return f"content too short ({len(content)} < {MIN_CONTENT_LENGTH} chars)"

    # JS-challenge / bot-detection page
    for pattern in JS_REQUIRED_PATTERNS:
        if pattern.search(content):
            return f"JS-required pattern matched: {pattern.pattern}"

    # Low text density: strip all HTML tags and measure how much real text remains
    text_only = re.sub(r"<[^>]+>", " ", content)
    text_only = re.sub(r"\s+", " ", text_only).strip()
    density = len(text_only) / len(content) if content else 0
    if density < MIN_TEXT_DENSITY:
        return f"text density too low ({density * 100:.1f}% < {MIN_TEXT_DENSITY * 100}%)"

    return None


async def try_fetch_api(url: str) -> dict | None:
    """
    Attempt to fetch a page using the Browserbase Fetch API.
    This is a lightweight HTTP request — no browser spins up.
    Returns dict with content and status_code, or None if the content fails usability checks.
    """
    bb = Browserbase(api_key=os.environ.get("BROWSERBASE_API_KEY"))

    print("[Fetch API] Attempting lightweight fetch...")

    try:
        # Tip: pass `format="markdown"` or `format="json"` (with a `schema`)
        # here to have Browserbase return cleaner content or structured data
        # directly — see https://docs.browserbase.com/platform/fetch/overview
        # Use asyncio.to_thread for synchronous SDK calls
        data = await asyncio.to_thread(bb.fetch_api.create, url=url, allow_redirects=True)

        content_len = len(data.content)
        print(f"[Fetch API] Got response: status={data.status_code}, length={content_len} chars")

        fallback_reason = needs_browser_fallback(data.content, data.status_code)
        if fallback_reason:
            print(f"[Fetch API] Content not usable — {fallback_reason}")
            return None

        return {"content": data.content, "status_code": data.status_code}
    except Exception as error:
        message = str(error)
        print(f"[Fetch API] Failed: {message}")
        return None


def parse_from_html(html: str) -> dict:
    """
    Parse basic data from raw HTML without a browser.
    Uses simple regex-based extraction — swap in BeautifulSoup for richer parsing.
    """
    title_match = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
    title = title_match.group(1).strip() if title_match else "Unknown"
    link_count = len(re.findall(r"<a\s", html, re.IGNORECASE))
    return {"title": title, "link_count": link_count}


async def extract_with_browser(url: str) -> dict:
    """
    Fall back to a full Stagehand browser session for JS-heavy pages.
    Uses AI-powered extraction to pull structured data from the rendered DOM.
    """
    print("\n[Browser] Starting Stagehand session...")

    api_key = os.environ.get("BROWSERBASE_API_KEY")
    if not api_key:
        raise RuntimeError("BROWSERBASE_API_KEY is required")
    browser = await browserbase.launch(
        api_key=api_key,
        proxies=True,
        browser_settings={
            "advanced_stealth": True,
            "block_ads": True,
            "solve_captchas": True,
        },
    )
    try:
        stagehand = await Stagehand.create(
            browser=browser,
        )
        try:
            pages = await browser.context.pages()
            page = pages[0] if pages else await browser.context.new_page()
            await page.goto(url, wait_until="domcontentloaded", timeout=60_000)
            print("[Browser] Page loaded, extracting structured data with AI...")
            extracted = await stagehand.extract(
                (
                    "Extract the page title and all the main items/articles/entries "
                    "visible on this page. For each item get its title, URL, and any "
                    "metadata like score, author, or timestamp."
                ),
                PageDataSchema,
                page=page,
            )
            data = extracted.data
            if not data.title or not data.items:
                raise RuntimeError("Browser fallback returned no structured items")
            return data.model_dump(mode="json")
        finally:
            await stagehand.close()
    finally:
        await browser.close()
        print("[Browser] Session closed")


async def main():
    """
    Main application entry point.

    Strategy: Fetch API first, browser fallback if needed.
    """
    # Get target URL from command line arguments
    if len(sys.argv) < 2:
        print("Usage: python main.py <url>")
        print("Example: python main.py https://news.ycombinator.com")
        sys.exit(1)

    target_url = sys.argv[1]

    print(f"Smart Fetch Scraper — target: {target_url}")
    print("Strategy: Fetch API first, browser fallback if needed\n")

    try:
        # Step 1: Try the fast path
        fetch_result = await try_fetch_api(target_url)

        if fetch_result:
            print("\n[Fetch API] Success! Parsing HTML content...")
            parsed = parse_from_html(fetch_result["content"])
            print(f"  Title: {parsed['title']}")
            print(f"  Links found: {parsed['link_count']}")
            print(f"  Status code: {fetch_result['status_code']}")
            print(f"  Content length: {len(fetch_result['content'])} chars")
            print("\nThe Fetch API returned sufficient content.")
            print("For richer structured extraction, the browser fallback is also available.\n")

            # Optionally, you can still use the browser for richer extraction:
            # structured = await extract_with_browser(target_url)
            # print(json.dumps(structured, indent=2))

            print("Preview (first 500 chars):")
            print(fetch_result["content"][:500])
        else:
            # Step 2: Fetch API didn't return usable content — use a real browser
            print("\n[Fetch API] Insufficient content, falling back to browser...\n")

            structured = await extract_with_browser(target_url)
            print("\nExtracted data:")
            print(json.dumps(structured, indent=2))

    except Exception as error:
        print(f"Error during scrape: {error}")
        raise


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as err:
        print(f"Error: {err}")
        print("Common issues:")
        print("  - Check .env has BROWSERBASE_API_KEY")
        print("  - Verify network connectivity")
        print("Docs: https://docs.stagehand.dev")
        sys.exit(1)
