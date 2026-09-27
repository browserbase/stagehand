"""Collect and verify live homepage links with Stagehand V4."""

import asyncio
import json
import os
from dataclasses import asdict, dataclass
from urllib.parse import urlparse

from dotenv import load_dotenv
from pydantic import BaseModel, Field

from stagehand import Stagehand, StagehandBrowser, browserbase

load_dotenv()

BASE_URL = "https://www.browserbase.com"
MAX_LINKS = int(os.environ.get("MAX_LINKS", "10"))
SOCIAL_DOMAINS = {
    "twitter.com",
    "x.com",
    "facebook.com",
    "linkedin.com",
    "instagram.com",
    "youtube.com",
    "tiktok.com",
    "reddit.com",
    "discord.com",
}


@dataclass(frozen=True)
class Link:
    url: str
    link_text: str


@dataclass(frozen=True)
class LinkResult:
    link_text: str
    url: str
    success: bool
    page_title: str | None = None
    content_matches: bool | None = None
    assessment: str | None = None
    error: str | None = None


class Verification(BaseModel):
    page_title: str
    content_matches: bool
    assessment: str = Field(description="Brief assessment of at most eight words")


class ExtractedLink(BaseModel):
    url: str = Field(description="Absolute HTTP(S) destination URL")
    link_text: str


class ExtractedLinks(BaseModel):
    links: list[ExtractedLink]


async def create_session() -> tuple[StagehandBrowser, Stagehand]:
    api_key = os.environ.get("BROWSERBASE_API_KEY")
    if not api_key:
        raise RuntimeError("BROWSERBASE_API_KEY is required")
    browser = await browserbase.launch(api_key=api_key)
    try:
        stagehand = await Stagehand.create(
            browser=browser,
        )
    except Exception:
        await browser.close()
        raise
    return browser, stagehand


async def collect_links() -> list[Link]:
    browser, stagehand = await create_session()
    try:
        pages = await browser.context.pages()
        page = pages[0] if pages else await browser.context.new_page()
        await page.goto(BASE_URL, wait_until="domcontentloaded", timeout=60_000)
        extracted = await stagehand.extract(
            (
                "Extract all rendered links on the page with their visible link text or "
                "accessible label and their absolute HTTP(S) href. Return actual destination "
                "URLs."
            ),
            ExtractedLinks,
            page=page,
        )
        unique: dict[str, Link] = {}
        for item in extracted.data.links:
            url = str(item.url)
            if url.startswith(("http://", "https://")):
                unique.setdefault(url, Link(url=url, link_text=item.link_text))
        if not unique:
            # Accessibility snapshots can omit link hrefs on heavily animated pages.
            # Preserve semantic extraction as the primary path and read exact DOM hrefs
            # only when it returns no usable links.
            dom_links = await page.evaluate(
                """(() => Array.from(document.querySelectorAll('a[href]')).map((anchor) => ({
                    url: anchor.href,
                    link_text: (anchor.textContent || anchor.getAttribute('aria-label') || '').trim()
                })))()"""
            )
            for item in dom_links:
                url = str(item.get("url", ""))
                if url.startswith(("http://", "https://")):
                    unique.setdefault(
                        url,
                        Link(url=url, link_text=str(item.get("link_text", ""))),
                    )
        links = list(unique.values())[:MAX_LINKS]
        if not links:
            raise RuntimeError("No HTTP links were collected from the homepage")
        print(f"Collected {len(unique)} unique links; verifying {len(links)}")
        return links
    finally:
        await stagehand.close()
        await browser.close()


async def verify_link(link: Link) -> LinkResult:
    browser = None
    stagehand = None
    try:
        browser, stagehand = await create_session()
        pages = await browser.context.pages()
        page = pages[0] if pages else await browser.context.new_page()
        response = await page.goto(link.url, wait_until="domcontentloaded", timeout=30_000)
        if response is not None and not response.ok:
            raise RuntimeError(f"HTTP {response.status} {response.status_text}".strip())
        current_url = await page.url()
        if not current_url or current_url == "about:blank":
            raise RuntimeError("Page did not load a valid URL")

        hostname = (urlparse(current_url).hostname or "").lower()
        if any(hostname == domain or hostname.endswith(f".{domain}") for domain in SOCIAL_DOMAINS):
            return LinkResult(
                link_text=link.link_text,
                url=link.url,
                success=True,
                page_title=await page.title(),
                content_matches=True,
                assessment="Social destination loaded successfully",
            )

        extracted = await stagehand.extract(
            (
                f"A user clicked a link labeled {link.link_text!r} and arrived at "
                f"{current_url!r}. Decide whether the destination is an appropriate "
                "result of that click. Return the page title and an assessment of at "
                "most eight words."
            ),
            Verification,
            page=page,
        )
        verification = extracted.data
        return LinkResult(
            link_text=link.link_text,
            url=link.url,
            success=True,
            page_title=verification.page_title,
            content_matches=verification.content_matches,
            assessment=verification.assessment,
        )
    except Exception as error:
        return LinkResult(
            link_text=link.link_text,
            url=link.url,
            success=False,
            error=str(error),
        )
    finally:
        if stagehand is not None:
            await stagehand.close()
        if browser is not None:
            await browser.close()


async def main() -> None:
    links = await collect_links()
    results = [await verify_link(link) for link in links]
    report = {
        "total_links": len(results),
        "successful": sum(result.success for result in results),
        "failed": sum(not result.success for result in results),
        "results": [asdict(result) for result in results],
    }
    print(json.dumps(report, indent=2))
    failed = [result for result in results if not result.success or result.content_matches is False]
    if failed:
        raise RuntimeError(f"{len(failed)} of {len(results)} links failed verification")


if __name__ == "__main__":
    asyncio.run(main())
