"""
Auto-generated Playwright script (Python)
Groupon – Deal Search
Search keyword: synthetic oil change

Generated on: 2026-03-11T00:10:03.265Z
"""

import re
import os
import sys
import traceback
import shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def run(playwright: Playwright, keyword: str = "synthetic oil change", max_results: int = 5) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("groupon")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    deals = []

    try:
        print(f"STEP 1: Open Groupon and search for '{keyword}'...")
        page.goto("https://www.groupon.com/", wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(4000)

        for sel in [
            "#onetrust-accept-btn-handler",
            "button:has-text('Accept')",
            "button:has-text('Accept All')",
            "button:has-text('Got it')",
            "[aria-label='Close']",
        ]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=800):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(400)
            except Exception:
                pass

        search = page.locator("input[name='query'], input[type='search'], input[placeholder*='Search']").first
        search.wait_for(state="visible", timeout=10000)
        search.click()
        page.keyboard.press("Control+a")
        page.keyboard.type(keyword, delay=35)
        page.keyboard.press("Enter")
        page.wait_for_timeout(7000)

        for _ in range(4):
            page.evaluate("window.scrollBy(0, 700)")
            page.wait_for_timeout(700)

        print("STEP 2: Extract top deals...")

        anchors = page.locator("a[href*='/deals/']")
        count = anchors.count()
        seen = set()
        for i in range(count):
            if len(deals) >= max_results:
                break
            a = anchors.nth(i)
            href = a.get_attribute("href") or ""
            if not href:
                continue
            if href.startswith("/"):
                href = f"https://www.groupon.com{href}"
            if href in seen:
                continue
            seen.add(href)

            block_text = ""
            name = ""
            try:
                block_text = a.evaluate(
                    """
                    (el) => {
                      const block = el.closest('article, li, section, div') || el;
                      return (block.innerText || el.innerText || '');
                    }
                    """
                )
                block_text = re.sub(r"\s+", " ", block_text).strip()
            except Exception:
                pass

            try:
                name = (a.get_attribute("aria-label") or "").strip()
                if not name:
                    name = re.sub(r"\s+", " ", (a.inner_text(timeout=1000) or "")).strip()
            except Exception:
                pass

            if not name and block_text:
                name = block_text[:180]

            if len(name) < 10:
                continue

            m_price = re.search(r"\$\d[\d,]*(?:\.\d{2})?", block_text)
            m_discount = re.search(r"(\d{1,3})\s*%\s*(?:off)?", block_text, re.IGNORECASE)

            deals.append({
                "name": name[:180],
                "deal_price": m_price.group(0) if m_price else "N/A",
                "discount_percentage": f"{m_discount.group(1)}%" if m_discount else "N/A",
                "url": href,
            })

        print(f"\nDONE – Top {len(deals)} Deals:")
        for i, d in enumerate(deals, 1):
            print(f"  {i}. {d.get('name', 'N/A')}")
            print(f"     Price: {d.get('deal_price', 'N/A')} | Discount: {d.get('discount_percentage', 'N/A')}")

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

    return deals


if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
