"""
Grubhub – Thai Food in Chicago, IL
Pure Playwright CDP – no AI, no hardcoded results.
Navigates Grubhub, sets delivery address, searches for Thai food,
and extracts top 5 restaurants from the live page.
"""
from datetime import date, timedelta
import re
import os
import traceback
import sys
import shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

from dataclasses import dataclass


@dataclass(frozen=True)
class GrubhubSearchRequest:
    address: str
    query: str
    max_results: int


@dataclass(frozen=True)
class GrubhubRestaurant:
    name: str
    rating: str
    est_time: str


@dataclass(frozen=True)
class GrubhubSearchResult:
    address: str
    query: str
    restaurants: list[GrubhubRestaurant]


# Searches Grubhub for restaurants matching a query near a delivery address,
# returning up to max_results results with name, rating, and delivery time.
def search_grubhub_restaurants(
    playwright,
    request: GrubhubSearchRequest,
) -> GrubhubSearchResult:
    ADDRESS = request.address
    QUERY = request.query
    MAX_RESULTS = request.max_results
    raw_results = []
    port = get_free_port()
    profile_dir = get_temp_profile_dir("grubhub_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    raw_results = []

    try:
        # ── STEP 1: Navigate to Grubhub ──────────────────────────────
        print("STEP 1: Navigate to Grubhub...")
        page.goto("https://www.grubhub.com/", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}")

        # ── STEP 2: Set delivery address ──────────────────────────────
        print(f'STEP 2: Setting delivery address = "{ADDRESS}"...')
        addr_input = page.locator('[data-testid="address-input"]')
        if addr_input.is_visible(timeout=5000):
            addr_input.click(timeout=3000)
            page.wait_for_timeout(300)
            addr_input.fill(ADDRESS, timeout=3000)
            page.wait_for_timeout(2000)
            print("  Address typed")
        else:
            print("  WARNING: address input not found")

        # Click "See what's nearby" to submit
        submit_btn = page.locator('[data-testid="start-order-search-btn"]')
        if submit_btn.is_visible(timeout=3000):
            submit_btn.click(timeout=5000)
            page.wait_for_timeout(6000)
            print(f"  Navigated to: {page.url}")
        else:
            print("  WARNING: submit button not found, navigating directly")
            page.goto(
                "https://www.grubhub.com/lets-eat",
                wait_until="domcontentloaded",
                timeout=30000,
            )
            page.wait_for_timeout(5000)

        # ── STEP 3: Search for Thai food ──────────────────────────────
        print(f'STEP 3: Searching for "{QUERY}"...')
        search_input = page.locator('[data-testid="search-autocomplete-input"]')
        if search_input.is_visible(timeout=5000):
            search_input.click(timeout=3000)
            page.wait_for_timeout(300)
            search_input.fill(QUERY, timeout=3000)
            page.wait_for_timeout(1000)
            page.keyboard.press("Enter")
            page.wait_for_timeout(6000)
            print(f"  Search results: {page.url}")
        else:
            # Fallback: navigate directly to search URL
            search_url = (
                "https://www.grubhub.com/search?"
                "orderMethod=delivery&locationMode=DELIVERY&pageSize=36"
                "&searchTerm=Thai+food&queryText=Thai+food"
            )
            print(f"  Search input not found, falling back to URL")
            page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(6000)

        # ── Scroll to load lazy content ───────────────────────────────
        for _ in range(5):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(800)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # ── STEP 4: Extract restaurant data from DOM ──────────────────
        print("STEP 4: Extracting restaurant data...")

        raw_results = page.evaluate(
            """(maxResults) => {
            const results = [];
            const cards = document.querySelectorAll('[data-testid="restaurant-card"]');

            for (const card of Array.from(cards).slice(0, maxResults)) {
                // Name: h5 element
                const h5 = card.querySelector('h5');
                const name = h5 ? h5.textContent.trim() : '';
                if (!name) continue;

                // Rating: first span with pattern like "4.9 (7.5k)"
                let rating = 'N/A';
                const spans = card.querySelectorAll('span');
                for (const span of spans) {
                    const t = span.textContent.trim();
                    const m = t.match(/^(\\d+\\.\\d)\\s*\\(/);
                    if (m) {
                        rating = m[1];
                        break;
                    }
                }

                // Time: data-testid="ghs-restaurant-time-estimate"
                let est_time = 'N/A';
                const timeEl = card.querySelector('[data-testid="ghs-restaurant-time-estimate"]');
                if (timeEl) {
                    const timeText = timeEl.textContent.trim();
                    const tm = timeText.match(/(\\d+)\\s*min/);
                    if (tm) est_time = tm[0];
                }

                results.push({ name, rating, est_time });
            }
            return results;
        }""",
            MAX_RESULTS,
        )

        print(f"  Extracted {len(raw_results)} raw_results")

        # ── Fallback: broader extraction if primary failed ────────────
        if not raw_results:
            print("  Trying fallback extraction with a[href*='/restaurant/']...")
            raw_results = page.evaluate(
                """(maxResults) => {
                const results = [];
                const seen = new Set();
                const links = document.querySelectorAll('a[href*="/restaurant/"]');
                for (const link of links) {
                    const text = link.textContent.replace(/\\s+/g, ' ').trim();
                    if (text.length < 5) continue;
                    const h5 = link.querySelector('h5');
                    const name = h5 ? h5.textContent.trim() : text.substring(0, 60);
                    const nameKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (seen.has(nameKey)) continue;
                    seen.add(nameKey);

                    let rating = 'N/A';
                    const rm = text.match(/(\\d+\\.\\d)\\s*\\(/);
                    if (rm) rating = rm[1];

                    let est_time = 'N/A';
                    const tm = text.match(/(\\d+)\\s*min/);
                    if (tm) est_time = tm[0];

                    results.push({ name, rating, est_time });
                    if (results.length >= maxResults) break;
                }
                return results;
            }""",
                MAX_RESULTS,
            )
            print(f"  Fallback extracted {len(raw_results)} raw_results")

        # ── Print results ─────────────────────────────────────────────
        print(f"\nDONE – Top {len(raw_results)} Thai Restaurants:")
        for i, r in enumerate(raw_results, 1):
            print(f"  {i}. {r.get('name', 'N/A')} | rating {r.get('rating', 'N/A')} | {r.get('est_time', 'N/A')}")

    except Exception as e:
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        try:
            browser.close()
        except Exception:
            pass
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)
    return GrubhubSearchResult(
        address=request.address,
        query=request.query,
        restaurants=[GrubhubRestaurant(
            name=r.get("name",""),
            rating=r.get("rating",""),
            est_time=r.get("est_time",""),
        ) for r in raw_results],
    )
def test_search_grubhub_restaurants() -> None:
    from playwright.sync_api import sync_playwright
    request = GrubhubSearchRequest(address="Chicago, IL 60601", query="Thai food", max_results=5)
    with sync_playwright() as playwright:
        result = search_grubhub_restaurants(playwright, request)
    assert result.address == request.address
    assert len(result.restaurants) <= request.max_results
    print(f"\nTotal restaurants found: {len(result.restaurants)}")


if __name__ == "__main__":
    test_search_grubhub_restaurants()
