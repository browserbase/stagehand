"""
Nike – Men's Running Shoes Search
Sort: Price Low-High | Generated: 2026-02-28T06:46:07.994Z
Pure Playwright – no AI.
"""
import re, os, traceback
from playwright.sync_api import Playwright, sync_playwright

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws
import shutil

QUERY = "running shoes men"
MAX_RESULTS = 5

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("nike_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []
    try:
        print("STEP 1: Navigate to Nike search...")
        page.goto("https://www.nike.com/w?q=running+shoes+men&sort=price", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        # Dismiss cookie/popup
        for sel in ["button:has-text('Accept')", "button:has-text('Accept All Cookies')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # Scroll to load products
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(1000)

        print("STEP 2: Extract product cards...")
        cards = page.locator(".product-card, [data-testid='product-card'], .product-grid__card").all()
        print(f"   Found {len(cards)} product cards")

        for card in cards:
            if len(results) >= MAX_RESULTS:
                break
            try:
                name = ""
                try:
                    name = card.locator(".product-card__title, [data-testid='product-card__title']").first.inner_text(timeout=1000).strip()
                except Exception:
                    try:
                        name = card.locator("a").first.inner_text(timeout=1000).strip()
                    except Exception:
                        pass
                if not name or len(name) < 3:
                    continue

                price = "N/A"
                try:
                    price = card.locator(".product-card__price, [data-testid='product-card__price'], .product-price").first.inner_text(timeout=1000).strip()
                except Exception:
                    pass

                colors = "N/A"
                try:
                    colors = card.locator(".product-card__subtitle, .product-card__product-count").first.inner_text(timeout=1000).strip()
                except Exception:
                    pass

                results.append({"name": name, "price": price, "colors": colors})
            except Exception:
                continue

        if not results:
            print("❌ ERROR: Extraction failed — no shoes found from the page.")

        print(f"\nDONE – {len(results)} shoes:")
        for i, r in enumerate(results, 1):
            print(f"  {i}. {r['name']} – {r['price']} ({r['colors']})")

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
    return results

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
