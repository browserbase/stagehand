"""
Auto-generated Playwright script (Python)
Best Buy – Product Search
Search: "4K monitor", sorted by Customer Rating
Extract top 5 products with name, price, and customer rating.

Generated on: 2026-02-28T03:25:38.131Z
Recorded 3 browser interactions

Uses Playwright's native locator API with the user's Chrome profile.
"""

import os
import traceback
from urllib.parse import quote
from playwright.sync_api import Playwright, sync_playwright

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws
import shutil


def run(
    playwright: Playwright,
    search_term: str = "4K monitor",
    max_results: int = 5,
) -> list:
    print("=" * 59)
    print("  Best Buy – Product Search")
    print("=" * 59)
    print(f"  Search: \"{search_term}\"")
    print(f"  Sort by: Customer Rating")
    print(f"  Extract up to {max_results} products\n")

    port = get_free_port()
    profile_dir = get_temp_profile_dir("bestbuy_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate directly to sorted search results ────────────────────
        search_url = f"https://www.bestbuy.com/site/searchpage.jsp?st={quote(search_term)}&sp=%2Bcustomerrating"
        print(f"Loading search results (sorted by Customer Rating)...")
        print(f"  URL: {search_url}")
        page.goto(search_url)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}\n")

        # ── Extract products ──────────────────────────────────────────────
        print(f"Extracting top {max_results} products...\n")

        # Scroll to load products
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 400)")
            page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # Best Buy product grid items are .product-list-item
        items = page.locator('.product-list-item')
        count = items.count()
        print(f"  Found {count} product items")

        seen = set()
        for i in range(count):
            if len(results) >= max_results:
                break
            item = items.nth(i)
            try:
                text = item.inner_text(timeout=3000)
                if not text or len(text) < 30:
                    continue

                # Parse product name - skip badge labels
                lines = [l.strip() for l in text.split("\n") if l.strip()]
                badge_labels = {"sponsored", "best selling", "new", "sale", "top rated",
                                "top deal", "clearance", "open-box", "advertisement"}
                name = None
                for line in lines:
                    if line.lower() in badge_labels:
                        continue
                    if len(line) >= 10:
                        name = line
                        break
                if not name:
                    continue

                key = name.lower()
                if key in seen:
                    continue
                seen.add(key)

                # Price
                price = "N/A"
                import re as _re
                price_match = _re.search(r'\$[\d,]+\.?\d*', text)
                if price_match:
                    price = price_match.group(0)

                # Rating
                rating = "N/A"
                r_match = _re.search(r'Rating\s+([\d.]+)\s+out\s+of\s+5\s+stars\s+with\s+([\d,]+)\s+reviews', text, _re.IGNORECASE)
                if r_match:
                    rating = f"{r_match.group(1)} out of 5 ({r_match.group(2)} reviews)"
                else:
                    alt_match = _re.search(r'([\d.]+)\s*(?:out of|/)\s*5', text, _re.IGNORECASE)
                    if alt_match:
                        rating = f"{alt_match.group(1)}/5"

                results.append({
                    "name": name,
                    "price": price,
                    "rating": rating,
                })
            except Exception:
                continue

        # ── Print results ─────────────────────────────────────────────────
        print(f"\nFound {len(results)} products:\n")
        for i, prod in enumerate(results, 1):
            print(f"  {i}. {prod['name']}")
            print(f"     Price:  {prod['price']}")
            print(f"     Rating: {prod['rating']}")
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
    return results


if __name__ == "__main__":
    with sync_playwright() as playwright:
        items = run(playwright)
        print(f"Total products: {len(items)}")
