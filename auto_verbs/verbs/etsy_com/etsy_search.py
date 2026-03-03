"""
Etsy – Handmade Ceramic Mug Search
Search: "handmade ceramic mug" | Sort: Top Customer Reviews
Generated: 2026-02-28T06:32:38.178Z

Pure Playwright – no AI. Uses Etsy listing card selectors.
"""

import re
import os
import traceback
from playwright.sync_api import Playwright, sync_playwright

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws
import shutil

QUERY = "handmade ceramic mug"
MAX_RESULTS = 5
URL = "https://www.etsy.com/search?q=handmade%20ceramic%20mug&order=highest_reviews"


def dismiss_popups(page):
    for sel in [
        "button:has-text('Accept')",
        "button:has-text('Accept All')",
        "button:has-text('Got it')",
        "button:has-text('OK')",
        "#gdpr-single-choice-approve",
    ]:
        try:
            loc = page.locator(sel).first
            if loc.is_visible(timeout=800):
                loc.evaluate("el => el.click()")
                page.wait_for_timeout(300)
        except Exception:
            pass


def run(
    playwright: Playwright,
    search_query: str = QUERY,
    max_results: int = MAX_RESULTS,
) -> list:
    print("=" * 60)
    print("  Etsy – Handmade Ceramic Mug Search")
    print("=" * 60)
    print(f'  Query: "{search_query}"')
    print(f"  Sort: Top Customer Reviews")
    print(f"  Max results: {max_results}\n")

    port = get_free_port()
    profile_dir = get_temp_profile_dir("etsy_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # Visit homepage first so DataDome sets session cookies
        print("STEP 1a: Visit Etsy homepage (establish session)...")
        page.goto("https://www.etsy.com/", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(3000)
        dismiss_popups(page)
        print(f"   Homepage loaded: {page.title()}")

        print("STEP 1b: Navigate to Etsy search results...")
        page.goto(URL, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(3000)
        dismiss_popups(page)
        print(f"   Loaded: {page.url}\n")

        print("STEP 2: Extract listings...")
        card_loc = page.locator("[data-search-results] .v2-listing-card")
        total = card_loc.count()
        if total == 0:
            card_loc = page.locator(".search-listing-card")
            total = card_loc.count()
        print(f"   Found {total} listing cards (need {max_results})")

        seen_titles = set()
        idx = 0
        while len(results) < max_results and idx < total:
            card = card_loc.nth(idx)
            idx += 1
            try:
                # Title via aria-label (instant, no timeout)
                title = ""
                try:
                    a_el = card.locator("a[aria-label]").first
                    title = (a_el.get_attribute("aria-label") or "").strip()
                except Exception:
                    pass
                if not title or len(title) < 5 or title in seen_titles:
                    continue
                seen_titles.add(title)

                # Price via currency-value
                price = "N/A"
                try:
                    raw = card.locator("span.currency-value").first.inner_text(timeout=500).strip()
                    m = re.search(r'(\d[\d,]*\.\d{2})', raw)
                    price = "$" + m.group(1) if m else "$" + raw
                except Exception:
                    pass

                # Seller via "By <name>" in card text
                seller = "N/A"
                try:
                    text = card.inner_text(timeout=500)
                    m2 = re.search(r'\bBy (\S+)', text)
                    if m2:
                        seller = m2.group(1)
                except Exception:
                    pass

                results.append({"title": title, "price": price, "seller": seller})
            except Exception:
                continue

        print(f"\n" + "=" * 60)
        print(f"  DONE – {len(results)} results")
        print("=" * 60)
        for i, r in enumerate(results, 1):
            print(f"  {i}. {r['title']}")
            print(f"     Price:  {r['price']}")
            print(f"     Seller: {r['seller']}")
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
        print(f"Total results: {len(items)}")
