"""
Ticketmaster – Concerts in Los Angeles (This Weekend)
Pure Playwright – no AI.
"""
import re, os, sys, traceback, shutil, tempfile
from datetime import date, timedelta
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

MAX_RESULTS = 5


def get_this_weekend():
    """Return (Saturday, Sunday) dates for this weekend."""
    today = date.today()
    # days until Saturday (weekday 5)
    days_until_sat = (5 - today.weekday()) % 7
    if days_until_sat == 0 and today.weekday() != 5:
        days_until_sat = 7
    saturday = today + timedelta(days=days_until_sat)
    sunday = saturday + timedelta(days=1)
    return saturday, sunday


def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("ticketmaster_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    events = []
    try:
        saturday, sunday = get_this_weekend()
        print(f"STEP 1: Navigate to Ticketmaster (filtering for {saturday.strftime('%b %d')} - {sunday.strftime('%b %d')})...")
        page.goto(
            "https://www.ticketmaster.com/search?q=concerts+in+los+angeles",
            wait_until="domcontentloaded", timeout=30000,
        )
        page.wait_for_timeout(5000)

        # Dismiss popups / cookie banners
        for sel in ["button:has-text('Accept')", "button:has-text('Got It')",
                     "#onetrust-accept-btn-handler", "[aria-label='Close']",
                     "button:has-text('No Thanks')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── Use date picker to select this weekend ──
        print("STEP 1b: Selecting weekend dates via date picker...")
        date_picker_opened = False

        # Try to open date picker
        date_picker_triggers = [
            "button:has-text('Date')",
            "button:has-text('Dates')",
            "[aria-label*='date']",
            "[data-testid*='date']",
            "button:has-text('When')",
            "[class*='date-filter']",
            "[class*='DateFilter']",
        ]
        for trigger in date_picker_triggers:
            try:
                btn = page.locator(trigger).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(2000)
                    date_picker_opened = True
                    print(f"   Opened date picker via: {trigger}")
                    break
            except Exception:
                continue

        if date_picker_opened:
            # Try to select the weekend dates in the calendar
            # Format dates for aria-label matching (e.g., "March 7, 2026")
            # Windows strftime doesn't support %-d, use %d and strip leading zero
            sat_label = saturday.strftime("%B %d, %Y").lstrip("0").replace(" 0", " ")
            sun_label = sunday.strftime("%B %d, %Y").lstrip("0").replace(" 0", " ")

            dates_selected = False

            # Try clicking Saturday first
            sat_sels = [
                f"button:has-text('{saturday.day}')",
                f"[aria-label*='{sat_label}']",
                f"[data-date='{saturday.isoformat()}']",
                f"td:has-text('{saturday.day}')",
            ]
            for sel in sat_sels:
                try:
                    # Only click if it's within a calendar/picker context
                    loc = page.locator(sel).first
                    if loc.is_visible(timeout=1500):
                        loc.evaluate("el => el.click()")
                        page.wait_for_timeout(1000)
                        dates_selected = True
                        print(f"   Selected Saturday ({saturday.day})")
                        break
                except Exception:
                    continue

            # Try clicking Sunday for end date (if range picker)
            if dates_selected:
                sun_sels = [
                    f"button:has-text('{sunday.day}')",
                    f"[aria-label*='{sun_label}']",
                    f"[data-date='{sunday.isoformat()}']",
                    f"td:has-text('{sunday.day}')",
                ]
                for sel in sun_sels:
                    try:
                        loc = page.locator(sel).first
                        if loc.is_visible(timeout=1500):
                            loc.evaluate("el => el.click()")
                            page.wait_for_timeout(1000)
                            print(f"   Selected Sunday ({sunday.day})")
                            break
                    except Exception:
                        continue

            # Apply/confirm the date selection
            apply_sels = [
                "button:has-text('Apply')",
                "button:has-text('Done')",
                "button:has-text('OK')",
                "button:has-text('Search')",
                "button:has-text('Update')",
            ]
            for sel in apply_sels:
                try:
                    btn = page.locator(sel).first
                    if btn.is_visible(timeout=1500):
                        btn.evaluate("el => el.click()")
                        page.wait_for_timeout(3000)
                        print("   Applied date filter")
                        break
                except Exception:
                    continue
        else:
            print("   Could not open date picker — continuing with default results")

        # Scroll to load lazy content
        for _ in range(6):
            page.evaluate("window.scrollBy(0, 700)")
            page.wait_for_timeout(800)

        print("STEP 2: Extract event data...")

        body = page.inner_text("body")
        lines = [l.strip() for l in body.splitlines() if l.strip()]

        # Pattern: body text has repeating blocks:
        #   "March 22, 2026"  (date)
        #   "MAR" / "22"      (abbreviated)
        #   "Sunday 06:07 PM" (day+time)
        #   "Open additional information for"
        #   <EVENT NAME>      (the actual event title)
        #   <VENUE>           (city, state + venue)
        #   "Find Tickets"
        seen = set()
        date_full_re = re.compile(r"^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}$")
        daytime_re = re.compile(r"^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*\s+\d{1,2}:\d{2}\s*(AM|PM)$", re.IGNORECASE)
        current_date = ""
        current_time = ""

        i = 0
        while i < len(lines) and len(events) < MAX_RESULTS:
            ln = lines[i]
            # Track current date
            if date_full_re.match(ln):
                current_date = ln
                i += 1
                continue
            # Track current day/time
            if daytime_re.match(ln):
                current_time = ln
                i += 1
                continue
            # Detect "Open additional information for"
            if ln.startswith("Open additional information"):
                # Next line is always the concatenated blob (has date like 3/22/26)
                # Skip it; actual name is i+2, venue is i+3
                offset = 1
                if i + offset < len(lines) and re.search(r"\d+/\d+/\d+", lines[i + offset]):
                    offset = 2  # skip concatenated line
                if i + offset < len(lines):
                    name_line = lines[i + offset]
                    venue_line = lines[i + offset + 1] if i + offset + 1 < len(lines) else ""
                    if (name_line.lower() != "find tickets"
                            and len(name_line) > 5
                            and not name_line.startswith("Open ")):
                        key = name_line.lower()
                        if key not in seen:
                            seen.add(key)
                            # Clean venue — may be concatenated like "Anaheim, CAAngel Stadium"
                            venue_clean = venue_line
                            if venue_line.lower() == "find tickets":
                                venue_clean = "N/A"
                            else:
                                m = re.match(r"(.+?,\s*[A-Z]{2})(.+)", venue_line)
                                if m:
                                    venue_clean = f"{m.group(1)} – {m.group(2)}"
                            events.append({
                                "name": name_line,
                                "venue": venue_clean or "N/A",
                                "datetime": f"{current_date} {current_time}".strip() or "N/A",
                                "price": "N/A",
                            })
                i += 1
                continue
            i += 1

        if not events:
            print("❌ ERROR: Extraction failed — no events found.")

        print(f"\nDONE – Top {len(events)} Events:")
        for i, e in enumerate(events, 1):
            print(f"  {i}. {e['name']}")
            print(f"     Venue: {e['venue']}")
            print(f"     Date: {e['datetime']}")
            print(f"     Price: {e['price']}")

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
    return events


if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
