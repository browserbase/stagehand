"""
Auto-generated Playwright script (Python)
Amazon Product Search: "travel adapter worldwide" → Sort by Best Sellers → Add first item to cart

Generated on: 2026-02-26T20:45:46.033Z
Recorded 20 browser interactions
Note: This script was generated using AI-driven discovery patterns
"""

import re
import time
import os
from playwright.sync_api import Playwright, sync_playwright, expect

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws
import shutil


def run(playwright: Playwright) -> None:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("amazon_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()

    # Navigate to Amazon
    page.goto("https://www.amazon.com")
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(3000)

    # Click the search box
    search_box = page.get_by_role("searchbox", name=re.compile(r"Search", re.IGNORECASE)).first
    search_box.evaluate("el => el.click()")
    page.wait_for_timeout(500)

    # Type search query
    search_box.fill("travel adapter worldwide")
    page.wait_for_timeout(500)

    # Press Enter or click Search button to submit
    search_box.press("Enter")

    # Wait for search results to load
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(3000)

    # Sort by Best Sellers - use URL parameter approach (most reliable)
    current_url = page.url
    if "&s=" in current_url:
        import urllib.parse
        sorted_url = re.sub(r"&s=[^&]*", "&s=exact-aware-popularity-rank", current_url)
    elif "?" in current_url:
        sorted_url = current_url + "&s=exact-aware-popularity-rank"
    else:
        sorted_url = current_url + "?s=exact-aware-popularity-rank"
    page.goto(sorted_url)
    page.wait_for_load_state("domcontentloaded")

    # Wait for sorted results to fully render
    page.wait_for_timeout(5000)

    # Click on the first product in search results
    # Product title is the second link in each search result card (the first is the image)
    first_result = page.locator("[data-component-type='s-search-result']").first
    product_links = first_result.locator("a[href*='/dp/']")
    product_link = product_links.nth(1)
    try:
        product_link.wait_for(state="visible", timeout=10000)
        product_link.evaluate("el => el.click()")
    except Exception:
        product_links.first.evaluate("el => el.click()")

    # Wait for product page to load
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(3000)

    # Extract and print product name and price
    try:
        product_name = page.locator("#productTitle").inner_text(timeout=5000).strip()
    except Exception:
        try:
            product_name = page.locator("#title, #titleSection h1, span#productTitle, h1.product-title-word-break").first.inner_text(timeout=5000).strip()
        except Exception:
            product_name = page.title().replace(" - Amazon.com", "").strip()
    try:
        price_el = page.locator("span.a-price .a-offscreen").first
        product_price = price_el.inner_text(timeout=5000).strip()
    except Exception:
        product_price = "N/A"
    print(f"Product: {product_name}")
    print(f"Price: {product_price}")

    # Click "Add to Cart" button
    try:
        page.get_by_role("button", name=re.compile(r"Add to Cart", re.IGNORECASE)).first.evaluate("el => el.click()")
    except Exception:
        try:
            page.locator("#add-to-cart-button").evaluate("el => el.click()")
        except Exception:
            print("Warning: Could not find Add to Cart button")

    # Wait for confirmation
    page.wait_for_timeout(3000)
    print("Successfully added the first item to the shopping cart!")

    # ---------------------
    # Cleanup
    # ---------------------
    try:
        browser.close()
    except Exception:
        pass
    chrome_proc.terminate()
    shutil.rmtree(profile_dir, ignore_errors=True)


with sync_playwright() as playwright:
    run(playwright)
