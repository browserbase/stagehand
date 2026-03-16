"""
Auto-generated Playwright script (Python)
BBC News – Top Headlines Extraction
Extract top 5 headline news stories with headline and URL.

Generated on: 2026-02-28T02:28:29.293Z
Recorded 3 browser interactions

Uses Playwright's native locator API with the user's Chrome profile.
"""

import os
import traceback
from playwright.sync_api import Playwright, sync_playwright

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws
import shutil

from dataclasses import dataclass

@dataclass(frozen=True)
class BbcNewsRequest:
    max_results: int

@dataclass(frozen=True)
class BbcHeadline:
    headline: str
    url: str

@dataclass(frozen=True)
class BbcNewsResult:
    headlines: list[BbcHeadline]


# Extracts the top headline stories from the BBC News homepage, returning up to max_results items.
def extract_bbc_headlines(
    playwright,
    request: BbcNewsRequest,
) -> BbcNewsResult:
    max_results = request.max_results
    raw_results = []
    print("=" * 59)
    print("  BBC News – Top Headlines Extraction")
    print("=" * 59)
    print(f"  Extract up to {max_results} headline stories\n")

    port = get_free_port()
    profile_dir = get_temp_profile_dir("bbc_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    raw_results = []

    try:
        # ── Navigate to BBC News ──────────────────────────────────────────
        print("Loading BBC News...")
        page.goto("https://www.bbc.com/news")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}\n")

        # ── Dismiss cookie / consent banners ──────────────────────────────
        for selector in [
            "button:has-text('Accept')",
            "button:has-text('Accept All')",
            "button:has-text('Yes, I agree')",
            "button:has-text('OK')",
            "button:has-text('Got it')",
            "button:has-text('Close')",
            "[aria-label='Close']",
        ]:
            try:
                btn = page.locator(selector).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── Extract headline stories ──────────────────────────────────────
        print(f"Extracting top {max_results} headlines...\n")

        # Find all card-headline elements directly (more reliable than
        # searching inside card containers which may include nav items).
        headlines_els = page.locator('[data-testid="card-headline"]')
        count = headlines_els.count()
        print(f"  Found {count} card-headline elements")

        seen = set()
        for i in range(count):
            if len(raw_results) >= max_results:
                break
            h_el = headlines_els.nth(i)
            try:
                headline = h_el.inner_text(timeout=2000).strip()
                if not headline:
                    continue

                key = headline.lower()
                if key in seen:
                    continue
                seen.add(key)

                # Walk up to the nearest <a> ancestor to get the URL
                url = h_el.evaluate(
                    """el => {
                        let node = el;
                        while (node) {
                            if (node.tagName === 'A' && node.href) return node.href;
                            node = node.parentElement;
                        }
                        return '';
                    }"""
                ) or "N/A"

                raw_results.append({
                    "headline": headline,
                    "url": url,
                })
            except Exception:
                continue

        # ── Print raw_results ─────────────────────────────────────────────────
        print(f"\nFound {len(raw_results)} headline stories:\n")
        for i, story in enumerate(raw_results, 1):
            print(f"  {i}. {story['headline']}")
            print(f"     URL: {story['url']}")
            print()

    except Exception as e:
        print(f"\nError: {e}")
        traceback.print_exc()
    finally:
        try:
            browser.close()
        except Exception:
            pass
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)
    return BbcNewsResult(
        headlines=[BbcHeadline(headline=r["headline"], url=r["url"]) for r in raw_results],
    )
def test_extract_bbc_headlines() -> None:
    from playwright.sync_api import sync_playwright
    request = BbcNewsRequest(max_results=5)
    with sync_playwright() as playwright:
        result = extract_bbc_headlines(playwright, request)
    assert len(result.headlines) <= request.max_results
    print(f"\nTotal headlines found: {len(result.headlines)}")


if __name__ == "__main__":
    test_extract_bbc_headlines()
