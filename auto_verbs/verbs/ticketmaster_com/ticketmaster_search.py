"""
Ticketmaster – Concerts in Los Angeles
Generated: 2026-03-10T23:50:27.317Z
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

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
        print("STEP 1: Navigate to Ticketmaster concert search...")
        page.goto("https://www.ticketmaster.com/search?q=concerts&loc=Los+Angeles%2C+CA&daterange=thisweekend",
                   wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        for sel in ["button:has-text('Accept')", "button:has-text('Got It')", "#onetrust-accept-btn-handler"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        for _ in range(5):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(800)

        print("STEP 2: Extract event data...")
        body = page.locator("body").inner_text(timeout=10000)

        events = []

        if not events:
            # Try to parse from body
            lines = body.split("\n")
            current_event = {}
            for line in lines:
                line = line.strip()
                if not line:
                    if current_event.get("name"):
                        events.append(current_event)
                        current_event = {}
                    continue
                if "$" in line and not current_event.get("price"):
                    m = re.search(r"\$[\d,]+", line)
                    if m:
                        current_event["price"] = m.group(0)
                elif re.search(r"\d{1,2}/\d{1,2}/\d{2,4}|\w+ \d{1,2},", line) and not current_event.get("datetime"):
                    current_event["datetime"] = line[:60]
                elif len(line) > 5 and len(line) < 100 and not current_event.get("name"):
                    current_event["name"] = line
                if len(events) >= 5:
                    break

        print(f"\nDONE – Top {len(events)} Events:")
        for i, e in enumerate(events, 1):
            print(f"  {i}. {e.get('name', 'N/A')}")
            print(f"     Venue: {e.get('venue', 'N/A')} | {e.get('datetime', 'N/A')} | {e.get('price', 'N/A')}")

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
