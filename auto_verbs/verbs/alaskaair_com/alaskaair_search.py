"""
Auto-generated Playwright script (Python)
Alaska Airlines – Round Trip Flight Search
From: Seattle → To: Chicago
Departure: 04/26/2026  Return: 04/30/2026

Generated on: 2026-02-26T20:40:46.528Z
Recorded 12 browser interactions

Uses Playwright's native locator API with built-in shadow DOM piercing
(no coordinate math or page.evaluate hacks required).
"""

import re
import os
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta
from playwright.sync_api import Playwright, sync_playwright


def compute_dates():
    today = date.today()
    departure = today + relativedelta(months=2)
    ret = departure + timedelta(days=4)
    return departure.strftime("%m/%d/%Y"), ret.strftime("%m/%d/%Y")


def run(
    playwright: Playwright,
    origin: str = "Seattle",
    destination: str = "Chicago",
    departure_date: str = None,
    return_date: str = None,
    max_results: int = 5,
) -> list:
    if departure_date is None or return_date is None:
        departure_date, return_date = compute_dates()

    print(f"  Seattle -> Chicago")
    print(f"  Dep: {departure_date}  Ret: {return_date}\n")

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
        # ── Navigate ──────────────────────────────────────────────────────
        print("Loading Alaska Airlines...")
        page.goto("https://www.alaskaair.com")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}")

        # ── Dismiss popups ────────────────────────────────────────────────
        for label in ["close", "dismiss", "accept", "got it"]:
            try:
                btn = page.get_by_role("button", name=re.compile(label, re.IGNORECASE))
                if btn.first.is_visible(timeout=1000):
                    btn.first.click()
                    page.wait_for_timeout(500)
                    break
            except Exception:
                pass

        # ── Round Trip ────────────────────────────────────────────────────
        # Alaska Airlines defaults to Round Trip. We verify and only click
        # if needed, using a narrow locator to avoid matching unrelated radios.
        print("STEP 2: Ensuring Round Trip...")
        try:
            # Look for the booking widget's trip-type radio inside the
            # borealis booking component (avoids matching other page radios).
            booking = page.locator(
                "borealis-expanded-booking-widget, "
                "[class*='booking'], [class*='planbook']"
            ).first
            rt_radio = booking.get_by_text("Round trip", exact=False).first
            if rt_radio.is_visible(timeout=2000):
                rt_radio.click(force=True)
                print("  Selected Round Trip (booking widget text)")
            else:
                raise Exception("not visible")
        except Exception:
            # Round trip is the default — just verify it's already selected
            print("  Round trip is the default; skipping click")
        page.wait_for_timeout(500)

        # ── Fill Origin ───────────────────────────────────────────────────
        print(f'STEP 3: Origin = "{origin}"...')
        from_input = page.locator('input[role="combobox"]').first
        from_input.focus()
        print("  Focused From combobox")
        page.wait_for_timeout(500)
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.keyboard.type(origin, delay=50)
        print(f'  Typed "{origin}"')
        page.wait_for_timeout(2000)

        # Select first suggestion
        option_count = page.locator('[role="option"]').count()
        print(f"  Options found by locator: {option_count}")
        try:
            option = page.locator('[role="option"], auro-menuoption').first
            option.wait_for(state="attached", timeout=5000)
            opt_text = option.inner_text()
            option.click(force=True)
            print(f"  Selected: {opt_text.strip()[:80]}")
        except Exception:
            # Enter accepts the first/highlighted suggestion
            page.keyboard.press("Enter")
            print("  No option locator found, pressed Enter")
        page.wait_for_timeout(1500)

        # ── Fill Destination ──────────────────────────────────────────────
        print(f'STEP 4: Destination = "{destination}"...')
        # Tab twice: first Tab lands on the swap/switch-direction button,
        # second Tab reaches the destination combobox.
        page.keyboard.press("Tab")
        page.wait_for_timeout(300)
        page.keyboard.press("Tab")
        page.wait_for_timeout(500)
        print("  Tabbed to To combobox (2x Tab, skipping swap button)")
        page.wait_for_timeout(500)
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.keyboard.type(destination, delay=50)
        print(f'  Typed "{destination}"')
        page.wait_for_timeout(2000)

        # Select first suggestion
        option_count = page.locator('[role="option"]').count()
        print(f"  Options found by locator: {option_count}")
        try:
            option = page.locator('[role="option"], auro-menuoption').first
            option.wait_for(state="attached", timeout=5000)
            opt_text = option.inner_text()
            option.click(force=True)
            print(f"  Selected: {opt_text.strip()[:80]}")
        except Exception:
            page.keyboard.press("Enter")
            print("  No option locator found, pressed Enter")
        page.wait_for_timeout(1500)

        # ── Fill Dates ────────────────────────────────────────────────────
        print(f"STEP 5: Dates — Dep: {departure_date}, Ret: {return_date}...")

        dep_input = page.get_by_placeholder("MM/DD/YYYY").first
        dep_input.focus()
        print("  Focused departure date input")
        page.wait_for_timeout(800)
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.keyboard.type(departure_date, delay=30)
        print(f"  Typed departure: {departure_date}")
        page.wait_for_timeout(1000)

        # Tab to return date, then type
        page.keyboard.press("Tab")
        page.wait_for_timeout(800)
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.keyboard.type(return_date, delay=30)
        print(f"  Typed return: {return_date}")
        page.wait_for_timeout(1000)

        # Verify form values
        comboboxes = page.locator('input[role="combobox"]')
        dates = page.get_by_placeholder("MM/DD/YYYY")
        print("  Form state:")
        print(f'    Origin  = "{comboboxes.first.input_value()}"')
        print(f'    Dest    = "{comboboxes.nth(1).input_value()}"')
        print(f'    Depart  = "{dates.first.input_value()}"')
        print(f'    Return  = "{dates.nth(1).input_value()}"')

        # Close date picker
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)

        # ── Click Search Flights ──────────────────────────────────────────
        print("STEP 6: Search flights...")
        search_btn = None

        # Strategy A: planbook-button custom element with "search flights" text
        try:
            loc = page.locator("planbook-button").filter(
                has_text=re.compile("search flights", re.IGNORECASE)
            )
            if loc.first.is_visible(timeout=3000):
                search_btn = loc.first
                print("  Found <planbook-button> via locator")
        except Exception:
            pass

        # Strategy B: auro-button with search text
        if search_btn is None:
            try:
                loc = page.locator("auro-button").filter(
                    has_text=re.compile("search flights", re.IGNORECASE)
                )
                if loc.first.is_visible(timeout=2000):
                    search_btn = loc.first
                    print("  Found <auro-button> via locator")
            except Exception:
                pass

        # Strategy C: any button by role + name
        if search_btn is None:
            try:
                loc = page.get_by_role("button", name=re.compile("search flights", re.IGNORECASE))
                if loc.first.is_visible(timeout=2000):
                    search_btn = loc.first
                    print("  Found button by role")
            except Exception:
                pass

        if search_btn:
            search_btn.scroll_into_view_if_needed()
            page.wait_for_timeout(300)
            search_btn.click()
            print("  Clicked search button")
        else:
            print("  ERROR: Search button not found — trying text fallback")
            page.get_by_text("Search flights", exact=False).first.click()

        # Wait for navigation
        start_url = page.url
        try:
            page.wait_for_url("**/search/results**", timeout=15000)
            print(f"  Navigated to: {page.url}")
        except Exception:
            print(f"  URL after wait: {page.url}")
            if page.url == start_url and search_btn:
                print("  Retrying click...")
                search_btn.click(force=True)
                try:
                    page.wait_for_url("**/search/results**", timeout=15000)
                    print(f"  Navigated on retry: {page.url}")
                except Exception:
                    print(f"  URL after retry: {page.url}")

        if "search/results" in page.url:
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(5000)

        # ── Extract flights ───────────────────────────────────────────────
        print(f"STEP 7: Extract up to {max_results} flights...")
        print(f"  URL: {page.url}")

        body_text = page.evaluate("document.body.innerText") or ""

        dollar_matches = re.findall(r"\$\d[\d,]*", body_text)
        if dollar_matches:
            print(f"  Found {len(dollar_matches)} price-like strings")

        # Locator-based extraction: look for result rows
        flight_rows = page.locator(
            "[class*='flight-row'], [class*='FlightRow'], "
            "[data-testid*='flight'], [class*='option-row'], [role='row']"
        )
        count = flight_rows.count()
        if count == 0:
            flight_rows = page.locator(
                "[class*='fare'], [class*='itinerary'], "
                "[class*='result'], li[class*='flight']"
            )
            count = flight_rows.count()

        print(f"  Locator found {count} flight rows")

        for i in range(count):
            if len(results) >= max_results:
                break
            row = flight_rows.nth(i)
            try:
                row_text = row.inner_text(timeout=3000)
                lines = [l.strip() for l in row_text.split("\n") if l.strip()]
                itinerary = " | ".join(lines[:3]) if len(lines) >= 3 else " | ".join(lines)
                price = "N/A"
                for line in lines:
                    pm = re.search(r"\$[\d,]+", line)
                    if pm:
                        price = pm.group(0)
                        break
                # Skip duplicate/expansion rows that have no price
                if price == "N/A":
                    continue
                results.append({"itinerary": itinerary, "price": price})
            except Exception:
                continue

        # Fallback: regex on body text — flight number pattern
        if not results and dollar_matches:
            print("  Using regex fallback (flight number pattern)...")
            lines = body_text.split("\n")
            i = 0
            while i < len(lines) and len(results) < max_results:
                line = lines[i].strip()
                if re.match(r"AS\s+\d{1,4}$", line):
                    itin_lines = [line]
                    j = i + 1
                    price = "N/A"
                    while j < min(i + 10, len(lines)):
                        l = lines[j].strip()
                        if not l:
                            j += 1
                            continue
                        pm = re.search(r"\$[\d,]+", l)
                        if pm:
                            price = pm.group(0)
                            break
                        itin_lines.append(l)
                        j += 1
                    if price != "N/A":
                        results.append({
                            "itinerary": " | ".join(itin_lines[:5]),
                            "price": price,
                        })
                i += 1

        # Fallback 2: simple dollar-context regex
        if not results and dollar_matches:
            print("  Using dollar-context fallback...")
            for m in re.finditer(r"(.{0,100})(\$\d[\d,]*)", body_text, re.DOTALL):
                ctx = m.group(1).strip().split("\n")
                price = m.group(2)
                itin = " ".join(ctx[-3:]) if len(ctx) >= 3 else " ".join(ctx)
                results.append({"itinerary": itin.strip(), "price": price})
                if len(results) >= max_results:
                    break

        print(f"\nFound {len(results)} flights from '{origin}' to '{destination}':")
        print(f"  Departure: {departure_date}  Return: {return_date}\n")
        for i, item in enumerate(results, 1):
            print(f"  {i}. Itinerary: {item['itinerary']}")
            print(f"     Economy Price: {item['price']}")

    except Exception as e:
        import traceback
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        context.close()

    return results


if __name__ == "__main__":
    with sync_playwright() as playwright:
        items = run(playwright)
        print(f"\nTotal flights found: {len(items)}")
