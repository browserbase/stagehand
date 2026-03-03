"""
Auto-generated Playwright script (Python)
Costco Product Search: "kids winter jacket"

Generated on: 2026-02-26T19:32:18.266Z
Recorded 11 browser interactions
Note: This script was generated using AI-driven discovery patterns
"""

import re
import os
from playwright.sync_api import Playwright, sync_playwright, expect

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws
import shutil


def run(playwright: Playwright, search_query: str = "kids winter jacket", max_results: int = 5) -> list:
    """
    Search Costco.com for the given query and return up to max_results items,
    each with name and price.
    """
    port = get_free_port()
    profile_dir = get_temp_profile_dir("costco_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()

    results = []

    try:
        # Navigate to Costco
        page.goto("https://www.costco.com")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)

        # Find and fill the search box
        search_input = page.get_by_role("combobox", name=re.compile(r"Search Costco", re.IGNORECASE)).first
        if not search_input.is_visible(timeout=3000):
            search_input = page.get_by_role("searchbox", name=re.compile(r"Search", re.IGNORECASE)).first
        search_input.evaluate("el => el.click()")
        search_input.fill(search_query)
        page.wait_for_timeout(500)

        # Click the Search button
        try:
            search_btn = page.get_by_role("button", name=re.compile(r"^Search$", re.IGNORECASE)).first
            search_btn.evaluate("el => el.click()")
        except Exception:
            search_input.press("Enter")

        # Wait for search results to load
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)

        # Extract product listings from the results page
        # Costco uses MUI and product links have '.product.' in href
        all_links = page.get_by_role("link").all()
        product_candidates = []
        seen_hrefs = set()
        for link in all_links:
            try:
                href = link.get_attribute("href", timeout=1000) or ""
                label = link.inner_text(timeout=1000).strip()
                # Product pages have '.product.' in the URL
                if ".product." in href and len(label) > 10 and href not in seen_hrefs:
                    seen_hrefs.add(href)
                    product_candidates.append({"element": link, "name": label, "href": href})
            except Exception:
                continue

        # For each product link, find the nearby price by walking up ancestor levels
        for candidate in product_candidates[:max_results]:
            name = candidate["name"]
            price = "N/A"
            try:
                el = candidate["element"]
                for level in range(1, 8):
                    xpath = "xpath=" + "/".join([".."] * level)
                    parent = el.locator(xpath)
                    if parent.count() == 0:
                        continue
                    parent_text = parent.first.inner_text(timeout=2000)
                    price_match = re.search(r"\$[\d,]+\.?\d*", parent_text)
                    if price_match:
                        price = price_match.group(0)
                        break
            except Exception:
                pass
            results.append({"name": name, "price": price})

        if not results:
            print("Warning: Could not find product listings.")

        # Print results
        print(f"\nFound {len(results)} results for '{search_query}':\n")
        for i, item in enumerate(results, 1):
            print(f"  {i}. {item['name']}")
            print(f"     Price: {item['price']}")

    except Exception as e:
        print(f"Error searching Costco: {e}")
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
        print(f"\nTotal items found: {len(items)}")
