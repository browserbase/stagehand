"""
Auto-generated Playwright script (Python)  —  concretized v2
Apartments.com - Apartment Search
Location: Austin, TX
Price range: $1000 - $2000 / month

Generated on: 2026-02-28T02:07:10.014Z
Recorded 5 browser interactions

Uses homepage search bar for location (works with any free-form location).
Uses Playwright's native locator API with the user's Chrome profile.
"""

import re
import json
import os
import traceback
from playwright.sync_api import Playwright, sync_playwright, TimeoutError as PwTimeout


def run(
    playwright: Playwright,
    location: str = "Austin, TX",
    price_min: int = 1000,
    price_max: int = 2000,
    max_results: int = 5,
) -> list:
    print("=" * 59)
    print("  Apartments.com - Apartment Search (concretized v2)")
    print("=" * 59)
    print(f"  Location:    {location}")
    print("  Price range: $" + format(price_min, ",") + " - $" + format(price_max, ",") + " / month\n")

    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default",
    )
    context = playwright.chromium.launch_persistent_context(
        user_data_dir,
        channel="chrome",
        headless=False,
        viewport={"width": 1920, "height": 1080},
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--disable-extensions",
            "--start-maximized",
            "--window-size=1920,1080",
        ],
    )
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate to homepage ──────────────────────────────────────────
        print("Loading https://www.apartments.com ...")
        page.goto("https://www.apartments.com")
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
                    btn.click()
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── STEP 0: Search for location ───────────────────────────────────
        print(f"STEP 0: Search for '{location}'...")
        # The homepage uses a custom div.smart-search-input widget.
        # Click the search area, then look for a real input to type into.
        search_area = page.locator(".smart-search-input, #heroSearchInput, #quickSearchLookup, input[type='search'], input[placeholder*='search' i]").first
        try:
            search_area.wait_for(state="visible", timeout=5000)
            search_area.click()
            page.wait_for_timeout(1000)
        except Exception:
            # Fallback: just click the center of the hero section
            page.locator("section").first.click()
            page.wait_for_timeout(1000)
        # After clicking, check if a standard input appeared
        search_input = None
        for sel in ["input[type='text']:visible", "input[type='search']:visible", "input:not([type]):visible", "#quickSearchLookup", "#heroSearchInput"]:
            try:
                candidate = page.locator(sel).first
                if candidate.is_visible(timeout=2000):
                    search_input = candidate
                    break
            except Exception:
                pass
        if search_input:
            search_input.click()
            page.keyboard.press("Control+a")
            page.keyboard.press("Backspace")
            search_input.type(location, delay=80)
        else:
            # Type directly — the active element may accept keystrokes
            page.keyboard.type(location, delay=80)
        page.wait_for_timeout(2500)  # wait for autocomplete
        # Try clicking first autocomplete suggestion
        suggestion_clicked = False
        for sel in [".autocompleteList li", "[role='option']", "[role='listbox'] li"]:
            try:
                sug = page.locator(sel).first
                if sug.is_visible(timeout=1500):
                    sug.click()
                    suggestion_clicked = True
                    print(f"  Clicked autocomplete suggestion")
                    break
            except Exception:
                pass
        if not suggestion_clicked:
            page.keyboard.press("Enter")
            print("  Pressed Enter to search")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Searched. URL: {page.url}")

        # ── STEP 1: Open price filter dropdown ────────────────────────────
        print("STEP 1: Open price filter...")
        price_link = page.locator("#rentRangeLink").first
        price_link.wait_for(state="visible", timeout=5000)
        price_link.click()
        page.wait_for_timeout(1000)
        print("  Opened price dropdown")

        # ── STEP 2: Set minimum price ─────────────────────────────────────
        print("STEP 2: Set min price = $" + format(price_min, ",") + "...")
        min_input = page.locator("#min-input").first
        min_input.wait_for(state="visible", timeout=3000)
        min_input.click()
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        min_input.type(str(price_min), delay=50)
        page.wait_for_timeout(500)
        print(f"  Typed {price_min}")

        # ── STEP 3: Set maximum price ─────────────────────────────────────
        print("STEP 3: Set max price = $" + format(price_max, ",") + "...")
        max_input = page.locator("#max-input").first
        max_input.wait_for(state="visible", timeout=3000)
        max_input.click()
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        max_input.type(str(price_max), delay=50)
        page.wait_for_timeout(500)
        print(f"  Typed {price_max}")

        # ── STEP 4: Click Done to apply filter ────────────────────────────
        print("STEP 4: Apply filter...")
        done_btn = page.locator(".done-btn").first
        done_btn.click()
        print("  Clicked Done")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  URL: {page.url}")

        # ── STEP 5: Extract listings ──────────────────────────────────────
        print(f"STEP 5: Extract up to {max_results} listings...")

        # Scroll to load listings
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # Extract using property cards
        cards = page.locator("article.placard")
        count = cards.count()
        if count == 0:
            cards = page.locator('[data-listingid]')
            count = cards.count()
        print(f"  Found {count} property cards")

        seen_names = set()
        for i in range(count):
            if len(results) >= max_results:
                break
            card = cards.nth(i)
            try:
                # Name
                name = "N/A"
                try:
                    name_el = card.locator(
                        '[class*="property-title"], '
                        'span.js-placardTitle, '
                        'h3, h2, '
                        'a[class*="title"]'
                    ).first
                    name = name_el.inner_text(timeout=3000).strip()
                except Exception:
                    pass

                # Address
                address = "N/A"
                try:
                    addr_el = card.locator(
                        '[class*="property-address"], '
                        'div.property-address, '
                        'address, '
                        'p[class*="addr"]'
                    ).first
                    address = addr_el.inner_text(timeout=3000).strip()
                except Exception:
                    pass

                # Price — collect all priceTextBox entries in the rent rollup
                price = "N/A"
                try:
                    price_boxes = card.locator('div.priceTextBox')
                    pcount = price_boxes.count()
                    if pcount > 0:
                        prices = []
                        for pi in range(pcount):
                            prices.append(price_boxes.nth(pi).inner_text(timeout=2000).strip())
                        price = " - ".join([prices[0], prices[-1]]) if len(prices) > 1 else prices[0]
                except Exception:
                    # Fallback selectors
                    try:
                        price_el = card.locator(
                            'div.rentRollup, '
                            '[class*="property-pricing"], '
                            'p.property-pricing'
                        ).first
                        raw = price_el.inner_text(timeout=3000).strip()
                        # Extract dollar amounts from the raw text
                        import re as _re
                        found = _re.findall(r"\$[\d,]+\+?", raw)
                        price = " - ".join([found[0], found[-1]]) if len(found) > 1 else (found[0] if found else raw)
                    except Exception:
                        pass

                # Beds / Baths — collect all bedTextBox entries
                beds_baths = "N/A"
                try:
                    bed_boxes = card.locator('div.bedTextBox')
                    bcount = bed_boxes.count()
                    if bcount > 0:
                        beds = []
                        for bi in range(bcount):
                            beds.append(bed_boxes.nth(bi).inner_text(timeout=2000).strip())
                        beds_baths = " - ".join([beds[0], beds[-1]]) if len(beds) > 1 else beds[0]
                except Exception:
                    try:
                        bb_el = card.locator(
                            '[class*="property-beds"], '
                            'p.property-beds'
                        ).first
                        beds_baths = bb_el.inner_text(timeout=3000).strip()
                    except Exception:
                        pass

                if name == "N/A" and price == "N/A":
                    continue

                name_key = name.lower().strip()
                if name_key in seen_names:
                    continue
                seen_names.add(name_key)

                results.append({
                    "name": name,
                    "address": address,
                    "price": price,
                    "beds_baths": beds_baths,
                })
            except Exception:
                continue

        # Fallback: text-based extraction
        if not results:
            print("  Card extraction failed, trying text fallback...")
            body_text = page.evaluate("document.body.innerText") or ""
            lines = body_text.split("\n")
            for i, line in enumerate(lines):
                if len(results) >= max_results:
                    break
                pm = re.search(r"\$[\d,]+", line)
                if pm and len(line.strip()) < 150:
                    name = "N/A"
                    address = "N/A"
                    for j in range(max(0, i - 5), i):
                        candidate = lines[j].strip()
                        if candidate and len(candidate) > 3 and not re.match(r"^[\$]", candidate):
                            if name == "N/A":
                                name = candidate
                            elif address == "N/A":
                                address = candidate
                    ctx = " ".join(lines[max(0, i-2):min(len(lines), i+5)])
                    beds_match = re.search(r"(\d+)\s*(?:Bed|BR)", ctx, re.IGNORECASE)
                    baths_match = re.search(r"(\d+)\s*(?:Bath|BA)", ctx, re.IGNORECASE)
                    beds_baths = ""
                    if beds_match:
                        beds_baths += beds_match.group(1) + " Bed"
                    if baths_match:
                        beds_baths += " " + baths_match.group(1) + " Bath"
                    beds_baths = beds_baths.strip() or "N/A"
                    results.append({
                        "name": name,
                        "address": address,
                        "price": pm.group(0),
                        "beds_baths": beds_baths,
                    })

        # ── Print results ─────────────────────────────────────────────────
        print(f"\nFound {len(results)} listings in '{location}':")
        print("  Price range: $" + format(price_min, ",") + " - $" + format(price_max, ",") + " / month\n")
        for i, apt in enumerate(results, 1):
            print(f"  {i}. {apt['name']}")
            print(f"     Address:    {apt['address']}")
            print(f"     Price:      {apt['price']}")
            print(f"     Beds/Baths: {apt['beds_baths']}")

    except Exception as e:
        print(f"\nError: {e}")
        traceback.print_exc()
    finally:
        context.close()
    return results


if __name__ == "__main__":
    with sync_playwright() as playwright:
        items = run(playwright)
        print(f"\nTotal listings: {len(items)}")
