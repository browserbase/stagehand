"""
Auto-generated Playwright script (Python)
Bank of America – Branch & ATM Locator
Location: Redmond, WA 98052
Max results: 5

Generated on: 2026-02-27T23:39:05.640Z
Recorded 8 browser interactions

Uses Playwright's native locator API with the user's Chrome profile.
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


def run(
    playwright: Playwright,
    location: str = "Redmond, WA 98052",
    max_results: int = 5,
) -> list:
    print("=" * 59)
    print("  Bank of America – Branch & ATM Locator")
    print("=" * 59)
    print(f"  Location: {location}")
    print(f"  Max results: {max_results}\n")

    port = get_free_port()
    profile_dir = get_temp_profile_dir("bankofamerica_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate ──────────────────────────────────────────────────────
        print("Loading Bank of America Locator...")
        page.goto("https://www.bankofamerica.com/locator/")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}")

        # ── Dismiss popups / cookie banners ───────────────────────────────
        for selector in [
            "button#onetrust-accept-btn-handler",
            "button:has-text('Accept')",
            "button:has-text('Accept All')",
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

        # ── STEP 1: Enter location in search box ─────────────────────────
        print(f"STEP 1: Search for '{location}'...")
        # Concrete selectors from recorded JS run
        search_input = page.locator(
            "#q, "
            "input[name='locator-search-value'], "
            "input[aria-label='Enter address, ZIP code or landmark'], "
            "#map-search-form input[type='text']"
        ).first
        try:
            search_input.wait_for(state="visible", timeout=10000)
        except Exception:
            # Fallback: find any visible text input inside the search form
            search_input = page.locator("form input[type='text']:visible").first
            search_input.wait_for(state="visible", timeout=5000)
        search_input.evaluate("el => el.click()")
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        search_input.type(location, delay=50)
        print(f"  Typed '{location}'")
        page.wait_for_timeout(1000)

        # ── STEP 2: Submit search ─────────────────────────────────────────
        print("STEP 2: Submit search...")
        # Try clicking a search/submit button (concrete selectors from recorded JS run)
        submitted = False
        for sel in [
            "#search-button",
            "button[aria-label='Click to submit search form']",
            "#map-search-form button[type='submit']",
            "button[type='submit']",
            "button:has-text('Search')",
        ]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=2000):
                    btn.evaluate("el => el.click()")
                    submitted = True
                    print("  Clicked Search button")
                    break
            except Exception:
                pass
        if not submitted:
            page.keyboard.press("Enter")
            print("  Pressed Enter")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  URL: {page.url}")

        # ── STEP 3: Extract results ───────────────────────────────────────
        print(f"STEP 3: Extract up to {max_results} results...")

        # Wait for result cards to load
        page.wait_for_timeout(3000)

        # Concrete selectors discovered from the live page DOM:
        #   Card:     li.map-list-item-wrap.is-visible
        #   Name:     button.location-name  (short name like "Redmond")
        #   Type:     div.location-type     (e.g. "Financial Center & ATM")
        #   Distance: div.distance:not(.feet) span  (e.g. "0.3 mi")
        #   Address:  first line of div.map-list-item-inner innerText
        cards = page.locator("li.map-list-item-wrap.is-visible")
        count = cards.count()
        print(f"  Found {count} result cards")

        seen_names = set()
        for i in range(count):
            if len(results) >= max_results:
                break
            card = cards.nth(i)
            try:
                # Name + type
                name = "N/A"
                loc_type = ""
                try:
                    name = card.locator("button.location-name").first.inner_text(timeout=2000).strip()
                except Exception:
                    pass
                try:
                    loc_type = card.locator("div.location-type").first.inner_text(timeout=2000).strip()
                except Exception:
                    pass
                if name != "N/A" and loc_type:
                    name = f"{name} {loc_type}"

                # Address (first line of .map-list-item-inner)
                address = "N/A"
                try:
                    inner_text = card.locator("div.map-list-item-inner").first.inner_text(timeout=2000).strip()
                    if inner_text:
                        address = inner_text.split("\n")[0].strip()
                except Exception:
                    pass

                # Distance
                distance = "N/A"
                try:
                    dist_el = card.locator("div.distance:not(.feet) span").first
                    distance = dist_el.inner_text(timeout=2000).strip()
                except Exception:
                    card_text = card.inner_text(timeout=2000)
                    dist_match = re.search(r"([\d.]+)\s*mi", card_text, re.IGNORECASE)
                    if dist_match:
                        distance = dist_match.group(0)

                if name == "N/A":
                    continue
                name_key = name.lower().strip()
                if name_key in seen_names:
                    continue
                seen_names.add(name_key)

                results.append({
                    "name": name,
                    "address": address,
                    "distance": distance,
                })
            except Exception:
                continue

        # Fallback: regex-based extraction from full page text
        if not results:
            print("  Card extraction failed, trying text fallback...")
            body_text = page.evaluate("document.body.innerText") or ""
            lines = [l.strip() for l in body_text.split("\n") if l.strip()]
            for i, line in enumerate(lines):
                if len(results) >= max_results:
                    break
                dm = re.search(r"([\d.]+)\s*mi", line, re.IGNORECASE)
                if dm and len(line) < 20:
                    name = "N/A"
                    address = "N/A"
                    # Walk backwards to find name and address
                    for j in range(i - 1, max(0, i - 6), -1):
                        candidate = lines[j]
                        if re.match(r"\d+\s+\w", candidate) and address == "N/A":
                            address = candidate
                        elif len(candidate) > 3 and name == "N/A" and candidate not in ("Make my favorite",):
                            name = candidate
                    results.append({
                        "name": name,
                        "address": address,
                        "distance": dm.group(0),
                    })

        # ── Print results ─────────────────────────────────────────────────
        print(f"\nFound {len(results)} locations near '{location}':\n")
        for i, loc in enumerate(results, 1):
            print(f"  {i}. {loc['name']}")
            print(f"     Address:  {loc['address']}")
            print(f"     Distance: {loc['distance']}")

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
        print(f"\nTotal locations: {len(items)}")
