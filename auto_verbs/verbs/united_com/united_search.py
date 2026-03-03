"""
United – Round trip San Francisco → New York (Newark)
Departure ~2 months from today, return 3 days later.
Uses search boxes to enter cities (no hardcoded airport codes).
"""
import re, os, sys, traceback, shutil
from datetime import date, timedelta
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

MAX_RESULTS = 5

# Search parameters - use city names, not airport codes
ORIGIN_CITY = "San Francisco, CA"
DESTINATION_CITY = "Newark, NJ"


def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("united_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    flights = []
    try:
        depart = date.today() + timedelta(days=60)
        ret = depart + timedelta(days=3)
        d_str = depart.strftime("%b %d")  # "May 01" format for UI
        r_str = ret.strftime("%b %d")
        d_iso = depart.strftime("%Y-%m-%d")
        r_iso = ret.strftime("%Y-%m-%d")

        print(f"STEP 1: Navigate to United ({ORIGIN_CITY} → {DESTINATION_CITY}, {d_iso} to {r_iso})...")
        # Visit homepage first to establish session
        page.goto("https://www.united.com/", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(4000)

        # Dismiss cookie banner on homepage
        for sel in ["button:has-text('Accept cookies')", "button:has-text('Accept')",
                     "#onetrust-accept-btn-handler"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=1500):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        page.wait_for_timeout(2000)

        # Fill in the search form using city names
        print("STEP 2: Fill search form...")
        
        # Click and fill origin field
        origin_filled = False
        origin_selectors = [
            "#bookFlightOriginInput",
            "[aria-label*='origin' i]",
            "[aria-label*='from' i]",
            "input[placeholder*='From' i]",
            "[data-testid='origin-input']",
        ]
        for sel in origin_selectors:
            try:
                origin_input = page.locator(sel).first
                if origin_input.is_visible(timeout=2000):
                    origin_input.click()
                    page.wait_for_timeout(500)
                    origin_input.fill(ORIGIN_CITY)
                    page.wait_for_timeout(1500)
                    # Click first autocomplete suggestion
                    try:
                        sug = page.locator("li[role='option'], [class*='autocomplete'] li, [class*='suggestion']").first
                        if sug.is_visible(timeout=2000):
                            sug.click()
                    except Exception:
                        origin_input.press("Enter")
                    page.wait_for_timeout(500)
                    origin_filled = True
                    break
            except Exception:
                continue
        
        if not origin_filled:
            pass  # Will fallback to direct URL
        else:
            page.wait_for_timeout(1000)  # Wait for UI to update after origin selection
        
        # Click and fill destination field
        dest_filled = False
        dest_selectors = [
            "#bookFlightDestinationInput",
            "input[placeholder='Destination']",
            "[aria-label*='destination' i]",
            "[aria-label*='to' i]",
            "[data-testid='destination-input']",
        ]
        for sel in dest_selectors:
            try:
                dest_input = page.locator(sel).first
                if dest_input.is_visible(timeout=2000):
                    dest_input.click()
                    page.wait_for_timeout(500)
                    dest_input.fill(DESTINATION_CITY)
                    page.wait_for_timeout(1500)
                    # Click first autocomplete suggestion
                    try:
                        sug = page.locator("li[role='option'], [class*='autocomplete'] li, [class*='suggestion']").first
                        if sug.is_visible(timeout=2000):
                            sug.click()
                    except Exception:
                        dest_input.press("Enter")
                    page.wait_for_timeout(500)
                    dest_filled = True
                    break
            except Exception:
                continue
        
        if not dest_filled:
            pass  # Will fallback to direct URL
        
        # Set dates if form was filled
        if origin_filled and dest_filled:
            # Click departure date
            try:
                date_selectors = [
                    "#DepartDate",
                    "input[placeholder='Departure']",
                    "[aria-label*='Depart' i]",
                ]
                for sel in date_selectors:
                    try:
                        date_input = page.locator(sel).first
                        if date_input.is_visible(timeout=2000):
                            date_input.click()
                            page.wait_for_timeout(1000)
                            # Type the date in MM/DD/YYYY format
                            date_input.fill(depart.strftime("%m/%d/%Y"))
                            page.wait_for_timeout(500)
                            date_input.press("Tab")  # Move to next field
                            page.wait_for_timeout(500)
                            break
                    except Exception:
                        continue
            except Exception:
                pass
            
            # Click return date
            try:
                ret_selectors = [
                    "#ReturnDate",
                    "input[placeholder='Return']",
                ]
                for sel in ret_selectors:
                    try:
                        ret_input = page.locator(sel).first
                        if ret_input.is_visible(timeout=2000):
                            ret_input.click()
                            page.wait_for_timeout(500)
                            ret_input.fill(ret.strftime("%m/%d/%Y"))
                            page.wait_for_timeout(500)
                            break
                    except Exception:
                        continue
            except Exception:
                pass
            
            # Close the date picker by clicking the X button or pressing Escape
            try:
                close_selectors = [
                    "button[aria-label='Close']",
                    "button[aria-label='close']", 
                    "[class*='DatePicker'] button[aria-label*='close' i]",
                    "[class*='datepicker'] button:has-text('×')",
                    "[class*='calendar'] button[aria-label*='close' i]",
                    "button.atm-c-btn--bare[aria-label*='Close' i]",
                ]
                for sel in close_selectors:
                    try:
                        close_btn = page.locator(sel).first
                        if close_btn.is_visible(timeout=1000):
                            close_btn.click()
                            page.wait_for_timeout(500)
                            break
                    except Exception:
                        continue
                else:
                    # Press Escape to close any open dialog
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(500)
            except Exception:
                pass
            
            page.wait_for_timeout(1000)
            
            # Submit search
            try:
                # Look for the "Find flights" button specifically
                search_btn = page.locator("button[aria-label='Find flights'], button:has-text('Find flights')").first
                if search_btn.is_visible(timeout=3000):
                    search_btn.click(timeout=5000)
                    page.wait_for_timeout(10000)
                else:
                    # Fallback to generic search
                    search_btn = page.locator("button:has-text('Search')").first
                    if search_btn.is_visible(timeout=2000):
                        search_btn.click()
                        page.wait_for_timeout(10000)
            except Exception:
                pass
        else:
            # Fallback to direct URL if form filling failed
            url = (
                f"https://www.united.com/en/us/fsr/choose-flights?"
                f"f=SFO&t=EWR&d={d_iso}&r={r_iso}&cb=0&px=1&taxng=1&newHP=True&clm=7&st=bestmatches&tqp=R"
            )
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
        
        page.wait_for_timeout(5000)

        # Check for "unable to complete" error — retry with reload
        for attempt in range(3):
            body_check = page.inner_text("body")
            if "unable to complete" in body_check.lower():
                page.wait_for_timeout(3000)
                page.reload(wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(8000)
            else:
                break

        # Dismiss any remaining popups
        for sel in ["button:has-text('Accept cookies')", "#onetrust-accept-btn-handler",
                     "button:has-text('No thanks')", "[aria-label='Close']",
                     "button:has-text('Close banner')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(400)
            except Exception:
                pass

        # Wait for flights to load
        try:
            page.wait_for_selector("text=NONSTOP", timeout=20000)
        except Exception:
            try:
                page.wait_for_selector("text=$", timeout=10000)
            except Exception:
                pass
        page.wait_for_timeout(3000)

        # Scroll to load more results
        for _ in range(6):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(800)

        print("STEP 3: Extract flight data...")

        # ── Strategy 1: flight card selectors ──
        seen_prices = set()
        card_sels = [
            "[class*='flight-result']",
            "[class*='FlightCard']",
            "[data-testid*='flight']",
            "[class*='bookFlightCard']",
            "li[class*='flight']",
        ]
        for sel in card_sels:
            if len(flights) >= MAX_RESULTS:
                break
            try:
                cards = page.locator(sel).all()
                if not cards:
                    continue
                for card in cards:
                    if len(flights) >= MAX_RESULTS:
                        break
                    try:
                        text = card.inner_text(timeout=2000).strip()
                        lines = [l.strip() for l in text.splitlines() if l.strip()]
                        if len(lines) < 2:
                            continue

                        itinerary = "N/A"
                        price = "N/A"

                        # Look for times (e.g., "7:00 AM - 3:30 PM")
                        for ln in lines:
                            if re.search(r"\d{1,2}:\d{2}\s*(AM|PM|am|pm)", ln):
                                itinerary = ln[:120]
                                break

                        # Look for price
                        for ln in lines:
                            m = re.search(r"\$[\d,]+", ln)
                            if m:
                                price = m.group(0)
                                break

                        if itinerary != "N/A" or price != "N/A":
                            key = f"{itinerary}|{price}"
                            if key not in seen_prices:
                                seen_prices.add(key)
                                # Add duration/stops if found
                                for ln in lines:
                                    if re.search(r"\d+h\s*\d+m|\d+\s*hr|\d+\s*stop|nonstop|direct", ln, re.IGNORECASE):
                                        if itinerary != "N/A":
                                            itinerary += f" ({ln.strip()})"
                                        else:
                                            itinerary = ln.strip()
                                        break
                                flights.append({
                                    "itinerary": itinerary,
                                    "economy_price": price,
                                })
                    except Exception:
                        continue
            except Exception:
                continue

        # ── Strategy 2: body text parsing (NONSTOP/stops marker) ──
        if not flights:
            body = page.inner_text("body")
            lines = [l.strip() for l in body.splitlines() if l.strip()]

            i = 0
            while i < len(lines) and len(flights) < MAX_RESULTS:
                ln = lines[i]
                # Flight block marker: "NONSTOP" or "1 stop" etc.
                if re.match(r"^(NONSTOP|\d+\s*STOP)", ln, re.IGNORECASE):
                    dep_time = ""
                    arr_time = ""
                    duration = ""
                    flight_num = ""
                    price = "N/A"

                    # Parse the block (up to ~25 lines)
                    block = lines[i:i+25]
                    for bl in block:
                        # Departure time: "6:00 AM"
                        if re.match(r"^\d{1,2}:\d{2}\s*(AM|PM)$", bl) and not dep_time:
                            dep_time = bl
                        elif re.match(r"^\d{1,2}:\d{2}\s*(AM|PM)$", bl) and dep_time and not arr_time:
                            arr_time = bl
                        # Duration: "5H, 37M"
                        elif re.match(r"^\d+H,?\s*\d+M$", bl, re.IGNORECASE) and not duration:
                            duration = bl
                        # Flight number: "UA 419 (Boeing 757-200)"
                        elif re.match(r"^UA\s*\d+", bl) and not flight_num:
                            flight_num = bl
                        # Economy price: "From" then "$528"
                        elif re.match(r"^\$[\d,]+$", bl) and price == "N/A":
                            price = bl
                            break  # first price is usually Economy

                    if dep_time:
                        stops = ln
                        itinerary = f"{dep_time} – {arr_time}" if arr_time else dep_time
                        if duration:
                            itinerary += f" ({duration})"
                        if stops:
                            itinerary += f" {stops}"
                        if flight_num:
                            itinerary += f" | {flight_num}"

                        key = f"{dep_time}|{price}"
                        if key not in seen_prices:
                            seen_prices.add(key)
                            flights.append({
                                "itinerary": itinerary,
                                "economy_price": price,
                            })
                i += 1

        # ── Strategy 3: just find any $ prices with context ──
        if not flights:
            body = page.inner_text("body")
            lines = [l.strip() for l in body.splitlines() if l.strip()]
            for i, ln in enumerate(lines):
                if len(flights) >= MAX_RESULTS:
                    break
                m = re.search(r"\$[\d,]+", ln)
                if m and re.search(r"economy|cabin|class|from\s*\$", ln, re.IGNORECASE):
                    price = m.group(0)
                    itinerary = "N/A"
                    # Search backwards for time
                    for j in range(max(0, i - 10), i):
                        if re.search(r"\d{1,2}:\d{2}\s*(AM|PM|am|pm)", lines[j]):
                            itinerary = lines[j][:120]
                            break
                    key = f"{itinerary}|{price}"
                    if key not in seen_prices:
                        seen_prices.add(key)
                        flights.append({
                            "itinerary": itinerary,
                            "economy_price": price,
                        })

        if not flights:
            body_text = page.inner_text("body").strip()
            if not body_text:
                print("❌ ERROR: Page body is empty — possible bot protection.")
            elif "unable to complete" in body_text.lower():
                print("❌ ERROR: United API returned 'unable to complete your request'. May be rate-limited or dates unavailable.")
            elif "captcha" in body_text.lower() or "verify" in body_text.lower():
                print("❌ ERROR: Blocked by CAPTCHA/bot detection.")
            else:
                print("❌ ERROR: Extraction failed — no flights found.")

        print(f"\nDONE – {len(flights)} United Flights ({ORIGIN_CITY} → {DESTINATION_CITY}):")
        for i, f in enumerate(flights, 1):
            print(f"  {i}. {f['itinerary']} | Economy: {f['economy_price']}")

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
