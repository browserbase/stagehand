"""
Auto-generated Playwright script (Python)
Booking.com – Hotel Search
Search: Chicago
Check-in: 04/26/2026  Check-out: 04/28/2026  (2 nights)

Generated on: 2026-02-26T20:48:59.809Z
Recorded 14 browser interactions

Uses Playwright's native locator API with the user's Chrome profile.
"""

import re
import os
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta
from playwright.sync_api import Playwright, sync_playwright

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws
import shutil


def compute_dates():
    today = date.today()
    checkin = today + relativedelta(months=2)
    checkout = checkin + timedelta(days=2)
    return checkin, checkout


def run(
    playwright: Playwright,
    destination: str = "Chicago",
    max_results: int = 5,
) -> list:
    checkin, checkout = compute_dates()
    checkin_str = checkin.strftime("%Y-%m-%d")
    checkout_str = checkout.strftime("%Y-%m-%d")
    checkin_display = checkin.strftime("%m/%d/%Y")
    checkout_display = checkout.strftime("%m/%d/%Y")

    print(f"  Destination: {destination}")
    print(f"  Check-in: {checkin_display}  Check-out: {checkout_display}  (2 nights)\n")

    port = get_free_port()
    profile_dir = get_temp_profile_dir("booking_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []
    seen_names = set()

    try:
        # ── Navigate ──────────────────────────────────────────────────────
        print("Loading Booking.com...")
        page.goto("https://www.booking.com")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)
        print(f"  Loaded: {page.url}")

        # ── Dismiss popups / cookie banners ───────────────────────────────
        for selector in [
            "button#onetrust-accept-btn-handler",
            "[aria-label='Dismiss sign-in info.']",
            "button:has-text('Accept')",
            "button:has-text('Got it')",
            "button:has-text('OK')",
        ]:
            try:
                btn = page.locator(selector).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── STEP 1: Enter destination ─────────────────────────────────────
        print(f'STEP 1: Destination = "{destination}"...')

        # Booking.com search input
        search_input = page.locator(
            '[data-testid="destination-container"] input, '
            'input[name="ss"], '
            'input[placeholder*="Where are you going"]'
        ).first
        search_input.evaluate("el => el.click()")
        page.wait_for_timeout(500)
        search_input.fill("")
        search_input.type(destination, delay=50)
        print(f'  Typed "{destination}"')
        page.wait_for_timeout(2000)

        # Select first autocomplete suggestion
        try:
            suggestion = page.locator(
                '[data-testid="autocomplete-result"], '
                'li[role="option"], '
                '[class*="autocomplete"] li'
            ).first
            suggestion.wait_for(state="visible", timeout=5000)
            suggestion.evaluate("el => el.click()")
            print("  Selected first suggestion")
        except Exception:
            page.keyboard.press("Enter")
            print("  No autocomplete suggestion, pressed Enter")
        page.wait_for_timeout(1000)

        # ── STEP 2: Set dates ─────────────────────────────────────────────
        print(f"STEP 2: Dates — Check-in: {checkin_display}, Check-out: {checkout_display}...")

        # Click check-in date in the calendar
        # Booking.com uses data-date attributes on calendar cells
        checkin_cell = page.locator(f'[data-date="{checkin_str}"]').first
        try:
            checkin_cell.wait_for(state="visible", timeout=5000)
            checkin_cell.evaluate("el => el.click()")
            print(f"  Clicked check-in date: {checkin_str}")
        except Exception:
            # Calendar might not be open yet — try clicking the date field first
            print("  Calendar not visible, clicking date field...")
            date_field = page.locator(
                '[data-testid="date-display-field-start"], '
                '[data-testid="searchbox-dates-container"], '
                'button[data-testid="date-display-field-start"]'
            ).first
            date_field.evaluate("el => el.click()")
            page.wait_for_timeout(1000)

            # Navigate calendar months (forward or backward) to find the target date
            for _ in range(6):
                try:
                    checkin_cell = page.locator(f'[data-date="{checkin_str}"]').first
                    if checkin_cell.is_visible(timeout=1000):
                        break
                except Exception:
                    pass
                # Determine direction by comparing visible months to target
                target_ym = checkin_str[:7]  # "YYYY-MM"
                visible_dates = page.eval_on_selector_all(
                    '[data-date]',
                    'els => els.map(e => e.getAttribute("data-date")).sort()'
                )
                if visible_dates and target_ym < visible_dates[0][:7]:
                    # Target is before visible months → go backward
                    try:
                        page.locator('button[aria-label="Previous month"]').first.evaluate("el => el.click()")
                        page.wait_for_timeout(500)
                    except Exception:
                        break
                else:
                    # Target is after visible months → go forward
                    try:
                        page.locator('button[aria-label="Next month"]').last.evaluate("el => el.click()")
                        page.wait_for_timeout(500)
                    except Exception:
                        break

            checkin_cell = page.locator(f'[data-date="{checkin_str}"]').first
            checkin_cell.evaluate("el => el.click()")
            print(f"  Clicked check-in date: {checkin_str}")
        page.wait_for_timeout(500)

        # Click checkout date
        checkout_cell = page.locator(f'[data-date="{checkout_str}"]').first
        try:
            checkout_cell.wait_for(state="visible", timeout=3000)
            checkout_cell.evaluate("el => el.click()")
            print(f"  Clicked check-out date: {checkout_str}")
        except Exception:
            # May need to navigate forward or backward
            for _ in range(3):
                try:
                    checkout_cell = page.locator(f'[data-date="{checkout_str}"]').first
                    if checkout_cell.is_visible(timeout=1000):
                        checkout_cell.evaluate("el => el.click()")
                        print(f"  Clicked check-out date: {checkout_str}")
                        break
                except Exception:
                    pass
                target_ym = checkout_str[:7]
                visible_dates = page.eval_on_selector_all(
                    '[data-date]',
                    'els => els.map(e => e.getAttribute("data-date")).sort()'
                )
                if visible_dates and target_ym < visible_dates[0][:7]:
                    try:
                        page.locator('button[aria-label="Previous month"]').first.evaluate("el => el.click()")
                        page.wait_for_timeout(500)
                    except Exception:
                        break
                else:
                    try:
                        page.locator('button[aria-label="Next month"]').last.evaluate("el => el.click()")
                        page.wait_for_timeout(500)
                    except Exception:
                        break
        page.wait_for_timeout(500)

        # ── STEP 3: Click Search ──────────────────────────────────────────
        print("STEP 3: Search...")
        search_btn = page.locator(
            'button[type="submit"], '
            '[data-testid="searchbox-search-button"], '
            'button:has-text("Search")'
        ).first
        search_btn.evaluate("el => el.click()")
        print("  Clicked Search button")

        # Wait for results
        try:
            page.wait_for_url("**/searchresults**", timeout=15000)
            print(f"  Navigated to: {page.url}")
        except Exception:
            print(f"  URL after wait: {page.url}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)

        # ── STEP 4: Extract hotels ────────────────────────────────────────
        print(f"STEP 4: Extract up to {max_results} hotels...")

        # Booking.com property cards
        hotel_cards = page.locator(
            '[data-testid="property-card"], '
            '[data-testid="property-card-container"], '
            '[class*="PropertyCard"], '
            '[class*="sr_property_block"]'
        )
        count = hotel_cards.count()
        print(f"  Found {count} hotel cards")

        for i in range(count):
            if len(results) >= max_results:
                break
            card = hotel_cards.nth(i)
            try:
                # Extract hotel name
                name = "N/A"
                try:
                    name_el = card.locator(
                        '[data-testid="title"], '
                        '[class*="title"], '
                        'h3, h4, '
                        'a[data-testid="title-link"]'
                    ).first
                    name = name_el.inner_text(timeout=3000).strip()
                    # Clean up trailing "Opens in new window" etc.
                    name = re.sub(r'\s*Opens in new window\s*$', '', name).strip()
                except Exception:
                    pass

                # Extract price
                price = "N/A"
                try:
                    price_el = card.locator(
                        '[data-testid="price-and-discounted-price"], '
                        '[class*="price"], '
                        'span:has-text("$")'
                    ).first
                    price_text = price_el.inner_text(timeout=3000).strip()
                    pm = re.search(r"\$[\d,]+", price_text)
                    if pm:
                        price = pm.group(0)
                except Exception:
                    # Fallback: search all card text for price
                    try:
                        card_text = card.inner_text(timeout=3000)
                        pm = re.search(r"\$[\d,]+", card_text)
                        if pm:
                            price = pm.group(0)
                    except Exception:
                        pass

                if name == "N/A" and price == "N/A":
                    continue

                # Deduplicate by hotel name
                name_key = name.lower().strip()
                if name_key in seen_names:
                    continue
                seen_names.add(name_key)

                # Compute per-night price
                per_night = price
                if price != "N/A":
                    raw = int(price.replace("$", "").replace(",", ""))
                    per_night_val = raw // 2
                    per_night = f"${per_night_val:,}"

                results.append({
                    "name": name,
                    "total_price": price,
                    "per_night_price": per_night,
                })
            except Exception:
                continue

        # Fallback: regex on page text
        if not results:
            print("  Card extraction failed, trying text fallback...")
            body_text = page.evaluate("document.body.innerText") or ""
            # Look for patterns like hotel name followed by price
            lines = body_text.split("\n")
            for i, line in enumerate(lines):
                if len(results) >= max_results:
                    break
                pm = re.search(r"\$[\d,]+", line)
                if pm and len(line.strip()) < 200:
                    # Look backward for hotel name
                    name = "N/A"
                    for j in range(max(0, i - 5), i):
                        candidate = lines[j].strip()
                        if candidate and len(candidate) > 5 and not re.match(r"^\$", candidate):
                            name = candidate
                    if name != "N/A":
                        total = pm.group(0)
                        raw = int(total.replace("$", "").replace(",", ""))
                        per_night = f"${raw // 2:,}"
                        results.append({
                            "name": name,
                            "total_price": total,
                            "per_night_price": per_night,
                        })

        # ── Print results ─────────────────────────────────────────────────
        print(f"\nFound {len(results)} hotels in '{destination}':")
        print(f"  Check-in: {checkin_display}  Check-out: {checkout_display}  (2 nights)\n")
        for i, hotel in enumerate(results, 1):
            print(f"  {i}. {hotel['name']}")
            print(f"     Per-night Price: {hotel['per_night_price']}  (Total: {hotel['total_price']})")

    except Exception as e:
        import traceback
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
        items = run(playwright)
        print(f"\nTotal hotels found: {len(items)}")
