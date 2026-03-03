"""
Auto-generated Playwright script (Python)  —  concretized v2
Apartments.com - Apartment Search
Location: Austin, TX
Price range: $1000 - $2000 / month

Generated on: 2026-03-01T04:17:18.429Z
Recorded 10 browser interactions

Uses homepage search bar for location (works with any free-form location).
Uses Playwright's native locator API with the user's Chrome profile.
"""

import re
import json
import os, sys, shutil
import subprocess
import time
import traceback
from playwright.sync_api import Playwright, sync_playwright, TimeoutError as PwTimeout

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def _kill_chrome():
    """Kill all Chrome processes to release the profile lock."""
    try:
        result = subprocess.run(
            ["taskkill", "/f", "/im", "chrome.exe"],
            capture_output=True, text=True, timeout=10
        )
        if "SUCCESS" in result.stdout:
            killed = result.stdout.count("SUCCESS")
            print(f"  Killed {killed} Chrome process(es)")
            time.sleep(3)  # wait for file locks to release
        else:
            print("  No Chrome processes found")
    except Exception:
        print("  Could not check for Chrome processes")


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

    # Kill any running Chrome to release the profile lock
    print("  Ensuring Chrome is closed...")
    _kill_chrome()

    port = get_free_port()
    # Use the real Chrome Default profile as user-data-dir.
    # Chrome creates its own nested Default/ subfolder inside this, but
    # the cookies, localStorage, etc. from the real profile are accessible.
    # Make sure Chrome is fully closed before running this script.
    real_profile = os.path.join(
        os.environ.get("LOCALAPPDATA", ""),
        "Google", "Chrome", "User Data", "Default",
    )
    if os.path.isdir(real_profile):
        profile_dir = real_profile
        print(f"  Using real Chrome profile: {profile_dir}")
        using_real_profile = True
    else:
        profile_dir = get_temp_profile_dir("apartments_com")
        print(f"  Using temp profile (real not found)")
        using_real_profile = False
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
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
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── STEP 0: Search for location ─────────────────────────────────
        # The homepage uses a custom div.smart-search-input widget (not a
        # real <input>).  We click it to activate, type via keyboard,
        # handle autocomplete, and then click the Search button.
        print(f"STEP 0: Search for '{location}'...")

        # Click the search widget to activate it
        search_div = page.locator("div.smart-search-input").first
        try:
            search_div.wait_for(state="visible", timeout=8000)
            # Use dispatchEvent to focus it properly
            search_div.evaluate("""el => {
                el.click();
                el.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
                el.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
            }""")
            print("  Activated search widget")
        except Exception:
            print("  Could not find div.smart-search-input, clicking by coordinate")
            page.mouse.click(620, 344)
        page.wait_for_timeout(1500)

        # After clicking, a real <input> may have appeared
        real_input = page.evaluate("""(() => {
            const candidates = document.querySelectorAll(
                'input[type="text"], input[type="search"], input:not([type]), input[placeholder]'
            );
            for (const inp of candidates) {
                if (inp.offsetParent !== null || inp.getClientRects().length > 0) {
                    inp.focus();
                    inp.click();
                    return { id: inp.id, placeholder: inp.placeholder || '' };
                }
            }
            return null;
        })()""")

        if real_input:
            print(f"  Found input: id=\"{real_input['id']}\" placeholder=\"{real_input['placeholder']}\"")
            inp = page.locator(f"#{real_input['id']}").first if real_input['id'] else page.locator("input:visible").first
            inp.evaluate("el => { el.focus(); el.click(); }")
            page.keyboard.press("Control+a")
            page.keyboard.press("Backspace")
            inp.type(location, delay=60)
        else:
            print("  No standard input — typing via keyboard into focused widget")
            page.keyboard.type(location, delay=60)
        print(f'  Typed "{location}"')
        page.wait_for_timeout(3000)  # wait for autocomplete

        # Try to click the first autocomplete suggestion (JS click on visible items)
        suggestion = page.evaluate("""(() => {
            // Apartments.com autocomplete suggestions
            const selectors = [
                '#defined-location-list li',
                '.autocompleteList li',
                '.suggestItem',
                '[class*="suggestion"] li',
                '[class*="autocomplete"] li',
                'li[role="option"]',
                '[role="listbox"] li',
            ];
            for (const sel of selectors) {
                const items = document.querySelectorAll(sel);
                for (const item of items) {
                    if (item.offsetParent !== null || item.getClientRects().length > 0) {
                        item.click();
                        return item.textContent.trim().substring(0, 80);
                    }
                }
            }
            return null;
        })()""")

        if suggestion:
            print(f"  Clicked autocomplete: \"{suggestion}\"")
            page.wait_for_timeout(1000)
        else:
            print("  No autocomplete suggestion found")

        # Click the Search button (the homepage has a submit button near the search bar)
        search_clicked = False
        for sel in [
            'button[type="submit"]',
            'button:has-text("Search")',
            'button[aria-label*="earch"]',
            '#searchBar button',
            '.searchBarContainer button',
        ]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=2000):
                    btn.evaluate("el => el.click()")
                    search_clicked = True
                    print(f"  Clicked Search button ({sel})")
                    break
            except Exception:
                pass
        if not search_clicked:
            # Fallback: press Enter
            page.keyboard.press("Enter")
            print("  Pressed Enter to search")

        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  URL: {page.url}")
        print(f"  Title: {page.title()}")

        # Handle Access Denied / Cloudflare challenge
        if "access denied" in (page.title() or "").lower() or "denied" in (page.title() or "").lower():
            print("  ⚠ Access Denied — waiting for challenge to resolve...")
            page.wait_for_timeout(10000)
            print(f"  Title after wait: {page.title()}")
            if "access denied" in (page.title() or "").lower():
                print("  Refreshing...")
                try:
                    page.reload()
                    page.wait_for_load_state("domcontentloaded")
                    page.wait_for_timeout(8000)
                    print(f"  Title after refresh: {page.title()}")
                except Exception as e:
                    print(f"  Refresh failed: {e}")
            if "access denied" in (page.title() or "").lower():
                # Last resort: try the results URL directly (may work now
                # that Cloudflare cookies are set from the first attempt)
                try:
                    slug = location.lower().replace(",", "").replace(" ", "-").strip("-")
                    direct_url = f"https://www.apartments.com/{slug}/"
                    print(f"  Retrying direct URL: {direct_url}")
                    page.goto(direct_url)
                    page.wait_for_load_state("domcontentloaded")
                    page.wait_for_timeout(8000)
                    print(f"  Title after retry: {page.title()}")
                except Exception as e:
                    print(f"  Retry failed: {e}")

        # Verify we're on results page
        on_results = ("apartments.com" in page.url
                      and page.url.rstrip("/") != "https://www.apartments.com"
                      and "access denied" not in (page.title() or "").lower())
        if on_results:
            print("  ✓ On results page")
        else:
            print("  ⚠ Not on results page — will attempt extraction anyway")
            print(f"  URL: {page.url}")

        # ── STEP 1: Open price filter dropdown ────────────────────────────
        print("STEP 1: Open price filter...")
        try:
            price_link = page.locator("#rentRangeLink").first
            price_link.wait_for(state="visible", timeout=5000)
            price_link.evaluate("el => el.click()")
            page.wait_for_timeout(1000)
            print("  Opened price dropdown")

            # ── STEP 2: Set minimum price ─────────────────────────────────
            print("STEP 2: Set min price = $" + format(price_min, ",") + "...")
            min_input = page.locator("#min-input").first
            min_input.wait_for(state="visible", timeout=3000)
            min_input.fill(str(price_min))
            min_input.evaluate("""el => {
                el.dispatchEvent(new Event('input', {bubbles: true}));
                el.dispatchEvent(new Event('change', {bubbles: true}));
            }""")
            page.wait_for_timeout(500)
            actual_min = min_input.input_value()
            print(f"  Set min to {actual_min} (wanted {price_min})")

            # ── STEP 3: Set maximum price ─────────────────────────────────
            print("STEP 3: Set max price = $" + format(price_max, ",") + "...")
            max_input = page.locator("#max-input").first
            max_input.wait_for(state="visible", timeout=3000)
            # Click to focus first (site may have shifted focus after min)
            max_input.click()
            page.wait_for_timeout(300)
            max_input.fill(str(price_max))
            max_input.evaluate("""el => {
                el.dispatchEvent(new Event('input', {bubbles: true}));
                el.dispatchEvent(new Event('change', {bubbles: true}));
            }""")
            page.wait_for_timeout(500)
            actual_max = max_input.input_value()
            if not actual_max:
                # Fallback: set value via JS directly
                print("  fill() didn't stick, setting via JS...")
                max_input.evaluate(f"""el => {{
                    el.focus();
                    el.value = '{price_max}';
                    el.dispatchEvent(new Event('input', {{bubbles: true}}));
                    el.dispatchEvent(new Event('change', {{bubbles: true}}));
                }}""")
                page.wait_for_timeout(300)
                actual_max = max_input.input_value()
            print(f"  Set max to {actual_max} (wanted {price_max})")

            # ── STEP 4: Click Done to apply filter ────────────────────────
            print("STEP 4: Apply filter...")
            done_btn = page.locator(".done-btn").first
            done_btn.evaluate("el => el.click()")
            print("  Clicked Done")
            page.wait_for_load_state("domcontentloaded")
            page.wait_for_timeout(5000)
            print(f"  URL: {page.url}")
        except Exception as e:
            print(f"  Price filter skipped (not on results page or element missing): {e}")

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
        try:
            browser.close()
        except Exception:
            pass
        chrome_proc.terminate()
        # Only delete temp profiles, never the real Chrome profile
        if not using_real_profile:
            shutil.rmtree(profile_dir, ignore_errors=True)
    return results


if __name__ == "__main__":
    with sync_playwright() as playwright:
        items = run(playwright)
        print(f"\nTotal listings: {len(items)}")
