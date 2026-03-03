"""
Southwest – Round trip Denver to Los Angeles
Pure Playwright – no AI.

Mirrors the working JS approach:
  - Type 3-letter airport code → click [role="option"] in dropdown
  - Type dates char-by-char into masked MM/DD input
  - Submit via #flightBookingSubmit
  - Scrape flight cards from results page
"""
import re, os, sys, time, traceback, shutil, tempfile
from datetime import date, timedelta
from playwright.sync_api import Playwright, sync_playwright

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def select_airport(page, input_selector: str, code: str) -> str:
    """Type airport code into combobox and select from autocomplete dropdown."""
    inp = page.locator(input_selector).first
    inp.evaluate("el => el.click()")
    page.wait_for_timeout(300)

    # Clear existing value and type the 3-letter code char-by-char
    inp.fill("")
    page.wait_for_timeout(200)
    for ch in code:
        inp.type(ch, delay=80)
    page.wait_for_timeout(2500)  # wait for autocomplete dropdown

    # Click the matching [role="option"] that contains the code
    # Skip "Area Airports" header options — we want the specific city
    options = page.locator(f'[role="option"]:has-text("{code}")').all()
    for option in options:
        try:
            text = option.inner_text(timeout=1000)
            if "area airports" in text.lower():
                continue  # skip area grouping header
            if option.is_visible(timeout=1500):
                option.evaluate("el => el.click()")
                page.wait_for_timeout(500)
                val = inp.input_value()
                print(f"    ✅ Selected '{text.strip()}' (value: {val})")
                return val
        except Exception:
            continue

    # Fallback: click first visible [role="option"] that isn't area header
    try:
        first_opt = page.locator(f'[role="option"]:has-text("{code}")').first
        if first_opt.is_visible(timeout=1500):
            first_opt.evaluate("el => el.click()")
            page.wait_for_timeout(500)
            val = inp.input_value()
            print(f"    ✅ Selected {code} via first option (value: {val})")
            return val
    except Exception:
        pass

    # Last fallback: Arrow down + Enter
    page.keyboard.press("ArrowDown")
    page.wait_for_timeout(200)
    page.keyboard.press("Enter")
    page.wait_for_timeout(500)
    val = inp.input_value()
    print(f"    ✅ ArrowDown+Enter for {code} (value: {val})")
    return val


def fill_date_field(page, input_selector: str, mm_dd: str):
    """Fill a masked date field (placeholder __/__) by typing digits only."""
    inp = page.locator(input_selector).first
    inp.evaluate("el => el.click()")
    page.wait_for_timeout(300)

    # Select all existing text so we overwrite it
    page.keyboard.press("Control+a")
    page.wait_for_timeout(200)

    # Type ONLY the digits — the mask inserts the slash automatically
    digits = mm_dd.replace("/", "")
    for ch in digits:
        inp.type(ch, delay=80)
    page.wait_for_timeout(300)

    # Blur to commit
    page.keyboard.press("Tab")
    page.wait_for_timeout(300)

    val = inp.input_value()
    print(f"    Date {input_selector}: typed '{mm_dd}' (digits '{digits}') → value='{val}'")
    return val


def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("southwest_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    flights: list[dict] = []

    try:
        depart = date.today() + timedelta(days=60)
        ret = depart + timedelta(days=5)
        dep_mmdd = depart.strftime("%m/%d")  # e.g. "04/28"
        ret_mmdd = ret.strftime("%m/%d")     # e.g. "05/03"

        # ── STEP 1: Navigate ─────────────────────────────────────────
        print("STEP 1: Navigate to Southwest booking page...")
        page.goto(
            "https://www.southwest.com/air/booking/",
            wait_until="domcontentloaded", timeout=30000,
        )
        page.wait_for_timeout(4000)

        # Dismiss popups / cookie banners
        for sel in [
            "button:has-text('Accept')",
            "#onetrust-accept-btn-handler",
            "button:has-text('No thanks')",
        ]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        # ── STEP 2: Fill form ─────────────────────────────────────────
        print("STEP 2: Fill flight search form...")

        # Origin airport
        print(f"  Setting origin: DEN")
        select_airport(page, "#originationAirportCode", "DEN")
        page.wait_for_timeout(1000)

        # Destination airport
        print(f"  Setting destination: LAX")
        select_airport(page, "#destinationAirportCode", "LAX")
        page.wait_for_timeout(1000)

        # Departure date (MM/DD)
        print(f"  Setting departure: {dep_mmdd}")
        fill_date_field(page, "#departureDate", dep_mmdd)
        page.wait_for_timeout(1000)

        # Return date (MM/DD)
        print(f"  Setting return: {ret_mmdd}")
        fill_date_field(page, "#returnDate", ret_mmdd)
        page.wait_for_timeout(1000)

        # Log form state
        form_state = page.evaluate("""() => {
            const g = s => document.querySelector(s)?.value || 'N/A';
            return {
                origin: g('#originationAirportCode'),
                dest:   g('#destinationAirportCode'),
                depart: g('#departureDate'),
                ret:    g('#returnDate'),
            };
        }""")
        print(f"  Form state: {form_state}")

        # ── STEP 3: Submit ────────────────────────────────────────────
        print("STEP 3: Click Search...")
        page.locator("#flightBookingSubmit").first.evaluate("el => el.click()")

        # Wait for results page (URL contains select-depart or select-)
        try:
            page.wait_for_url(re.compile(r"/air/booking/select[-.]"), timeout=30000)
            print(f"  ✅ Results page loaded: {page.url[:120]}")
        except Exception:
            print(f"  ⚠ URL didn't match pattern. Current: {page.url[:120]}")
            # Try JS click as fallback
            page.evaluate("document.querySelector('#flightBookingSubmit')?.click()")
            page.wait_for_timeout(15000)
            print(f"  Current URL after retry: {page.url[:120]}")

        page.wait_for_timeout(3000)

        # ── STEP 4: Extract flights ──────────────────────────────────
        print("STEP 4: Extract flight data...")

        # Scroll to load lazy content
        for _ in range(5):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(600)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # Strategy 1: Look for flight card elements
        flight_cards = page.locator('[class*="air-booking-select-detail"]').all()
        if not flight_cards:
            flight_cards = page.locator('[data-qa*="flight"], [class*="flight-stops"]').all()

        if flight_cards:
            print(f"  Found {len(flight_cards)} flight card elements")
            for card in flight_cards[:5]:
                try:
                    text = card.inner_text(timeout=3000)
                    # Extract flight number (e.g. "# 2133")
                    fnum_match = re.search(r"#\s*(\d{2,5})", text)
                    flight_num = f"WN {fnum_match.group(1)}" if fnum_match else "N/A"

                    # Extract departure/arrival times
                    times = re.findall(r"\d{1,2}:\d{2}\s*(?:AM|PM)", text, re.IGNORECASE)
                    itinerary = " → ".join(times[:2]) if times else "N/A"
                    stops = "Nonstop" if "nonstop" in text.lower() else "1+ stop"
                    if times:
                        itinerary = f"{flight_num} {itinerary} ({stops})"

                    # Extract Wanna Get Away price (first dollar amount = Basic/WGA)
                    wga_match = re.search(r"(?:wanna\s*get\s*away)[^\$]*\$\s*([\d,]+)", text, re.IGNORECASE)
                    if not wga_match:
                        prices = re.findall(r"\$([\d,]+)", text)
                        wga_price = "$" + prices[0] if prices else "N/A"
                    else:
                        wga_price = "$" + wga_match.group(1)

                    flights.append({
                        "flight_number": flight_num,
                        "itinerary": itinerary,
                        "wanna_get_away_price": wga_price,
                    })
                except Exception:
                    pass

        # Strategy 2: Fallback — parse visible body text
        if not flights:
            print("  Falling back to text parsing...")
            body = page.locator("body").inner_text(timeout=10000)
            lines = [l.strip() for l in body.split("\n") if l.strip()]

            i = 0
            while i < len(lines) and len(flights) < 5:
                line = lines[i]
                # Look for flight number pattern "# NNNN"
                fnum_match = re.search(r"#\s*(\d{2,5})", line)
                if fnum_match:
                    flight_num = f"WN {fnum_match.group(1)}"
                    # Look ahead for times and prices
                    itinerary = "N/A"
                    wga_price = "N/A"
                    for j in range(i, min(i + 15, len(lines))):
                        times = re.findall(r"\d{1,2}:\d{2}\s*(?:AM|PM)", lines[j], re.IGNORECASE)
                        if times and itinerary == "N/A":
                            stops = "Nonstop" if any("nonstop" in lines[k].lower() for k in range(i, min(i + 10, len(lines)))) else "1+ stop"
                            itinerary = f"{flight_num} {' → '.join(times[:2])} ({stops})"
                        pm = re.search(r"\$([\d,]+)", lines[j])
                        if pm and wga_price == "N/A" and j > i:
                            wga_price = "$" + pm.group(1)
                            break

                    if wga_price != "N/A":
                        flights.append({
                            "flight_number": flight_num,
                            "itinerary": itinerary,
                            "wanna_get_away_price": wga_price,
                        })
                i += 1

        # ── Results ───────────────────────────────────────────────────
        print(f"\nDONE – {len(flights)} Southwest Flights (DEN → LAX):")
        for i, f in enumerate(flights, 1):
            print(f"  {i}. {f['itinerary']} | Wanna Get Away: {f['wanna_get_away_price']}")

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
    return flights


if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
