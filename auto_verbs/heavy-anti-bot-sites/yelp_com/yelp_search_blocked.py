"""
Auto-generated Playwright script (Python)
Yelp – Coffee Shop Search
Search: "best coffee shops" in "Portland, OR"
Sort by: Highest Rated
Extract up to 5 results with name, rating, reviews, price range.

Generated on: 2026-03-02T23:09:24.593Z
Recorded 3 browser interactions

Uses Playwright's native locator API with the user's Chrome profile.
"""

import os, sys, shutil
import re
import traceback
from urllib.parse import quote_plus
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def run(
    playwright: Playwright,
    search_term: str = "best coffee shops",
    location: str = "Portland, OR",
    max_results: int = 5,
) -> list:
    print("=" * 59)
    print("  Yelp – Coffee Shop Search")
    print("=" * 59)
    print(f'  Search: "{search_term}" in "{location}"')
    print(f"  Sort by: Highest Rated")
    print(f"  Extract up to {max_results} results\n")
    port = get_free_port()
    profile_dir = get_temp_profile_dir("yelp_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate directly to search results ───────────────────────
        search_url = f"https://www.yelp.com/search?find_desc={quote_plus(search_term)}&find_loc={quote_plus(location)}&sortby=rating"
        print(f"Loading: {search_url}")
        page.goto(search_url, timeout=30000)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}\n")

        # ── Dismiss popups ────────────────────────────────────────────
        for sel in [
            "#onetrust-accept-btn-handler",
            "button:has-text('Accept All')",
            "button:has-text('Accept')",
            "button:has-text('Got it')",
            "button:has-text('OK')",
            "[aria-label='Close']",
        ]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── Scroll to load content ────────────────────────────────────
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # ── Extract results ───────────────────────────────────────────
        print(f"Extracting up to {max_results} results...\n")

        body_text = page.evaluate("document.body.innerText") or ""
        lines = [l.strip() for l in body_text.split("\n") if l.strip()]

        i = 0
        while i < len(lines) and len(results) < max_results:
            line = lines[i]
            # Look for numbered results pattern: "1. Name" or just business card-like entries
            num_match = re.match(r'^(\d+)\.\s+(.+)$', line)
            if num_match:
                name = num_match.group(2).strip()
                shop = {
                    "name": name,
                    "rating": "N/A",
                    "reviews": "N/A",
                    "price_range": "N/A",
                }
                # Look ahead for rating, reviews, price
                for j in range(i + 1, min(len(lines), i + 12)):
                    cand = lines[j].strip()
                    cl = cand.lower()
                    # Rating (e.g. "4.5" or "4.5 star rating")
                    if re.match(r'^\d\.\d$', cand) and shop["rating"] == "N/A":
                        shop["rating"] = cand
                        continue
                    # Reviews (e.g. "123 reviews" or "(123)")
                    rev_match = re.search(r'(\d+)\s*reviews?', cl)
                    if rev_match and shop["reviews"] == "N/A":
                        shop["reviews"] = rev_match.group(1)
                        continue
                    # Price range (e.g. "$$" or "$$$")
                    if re.match(r'^\4$', cand):
                        shop["price_range"] = cand
                        continue

                if shop["name"] not in [r["name"] for r in results]:
                    results.append(shop)
            i += 1

        # ── Print results ─────────────────────────────────────────────
        print(f"\nFound {len(results)} coffee shops:\n")
        for i, s in enumerate(results, 1):
            print(f"  {i}. {s['name']}")
            print(f"     Rating:     {s['rating']}")
            print(f"     Reviews:    {s['reviews']}")
            print(f"     Price:      {s['price_range']}")
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
