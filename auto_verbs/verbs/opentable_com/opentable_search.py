"""
OpenTable – Restaurant search Seattle WA
Generated: 2026-02-28T15:43:45.283Z
Pure Playwright – no AI.
"""
import re, os, traceback, shutil, tempfile
from datetime import date, timedelta
from playwright.sync_api import Playwright, sync_playwright

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, launch_chrome, wait_for_cdp_ws

MAX_RESULTS = 5

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = tempfile.mkdtemp(prefix="opentable_")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    restaurants = []
    try:
        dt = date.today() + timedelta(days=60)
        d_str = dt.strftime("%Y-%m-%d")

        print(f"STEP 1: Navigate to OpenTable (Seattle, {d_str}, party 2, 7PM)...")
        url = f"https://www.opentable.com/s?dateTime={d_str}T19%3A00%3A00&covers=2&metroId=4&regionIds=232&term=Seattle"
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(8000)

        # dismiss popups
        for sel in ["button:has-text('Accept')", "button:has-text('Got it')", "[aria-label='Close']"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        for _ in range(5):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(600)

        print("STEP 2: Extract restaurant cards...")

        # ── Strategy 1: structured card selector ──
        cards = page.locator("[data-test='restaurant-card']").all()
        print(f"   Found {len(cards)} restaurant cards")

        for card in cards:
            if len(restaurants) >= MAX_RESULTS:
                break
            try:
                txt = card.inner_text(timeout=3000)
                lines = [l.strip() for l in txt.splitlines() if l.strip()]
                if not lines:
                    continue

                name = lines[0]
                # Skip "Icon" prefix that sometimes appears
                if name.lower() in ("icon",):
                    name = lines[1] if len(lines) > 1 else ""
                    lines = lines[1:]
                if not name or len(name) < 2:
                    continue

                rating_label = ""
                review_count = ""
                price_range = ""
                cuisine = ""
                times = []

                for ln in lines[1:]:
                    # Skip "Promoted" tag
                    if ln.lower() == "promoted":
                        continue
                    # Rating label: Exceptional, Awesome, Good, etc.
                    if not rating_label and ln in ("Exceptional", "Awesome", "Good", "Great"):
                        rating_label = ln
                        continue
                    # Review count: "(1491)"
                    if not review_count and re.match(r'^\(\d[\d,]*\)$', ln):
                        review_count = ln
                        continue
                    # Price range: $ signs
                    if not price_range and re.match(r'^\${1,4}$', ln):
                        price_range = ln
                        continue
                    # Cuisine / neighborhood: starts with "•"
                    if not cuisine and ln.startswith("•"):
                        cuisine = ln.strip("• ").strip()
                        continue
                    # Available times: match "H:MM PM" pattern
                    time_match = re.match(r'^(\d{1,2}:\d{2}\s*[AP]M)\*?$', ln)
                    if time_match:
                        times.append(time_match.group(1))

                rating_str = f"{rating_label} {review_count}".strip() if rating_label else "N/A"
                restaurants.append({
                    "name": name,
                    "cuisine": cuisine or "N/A",
                    "price": price_range or "N/A",
                    "rating": rating_str,
                    "available_times": ", ".join(times) if times else "N/A",
                })
            except Exception:
                continue

        # ── Strategy 2: body text fallback ──
        if not restaurants:
            print("   Strategy 1 found 0 cards — trying body text...")
            body = page.inner_text("body")
            lines = [l.strip() for l in body.splitlines() if l.strip()]
            rating_labels = {"Exceptional", "Awesome", "Good", "Great"}
            i = 0
            while i < len(lines) - 3 and len(restaurants) < MAX_RESULTS:
                ln = lines[i]
                # A restaurant name is followed by an optional "Promoted",
                # then a rating label
                if (3 <= len(ln) <= 80 and ln[0].isalpha()
                        and ln not in rating_labels
                        and not re.match(r'^(Skip|Home|United|Booked|Find|Map|How|Copyright|Privacy|Terms|Keyboard|Cookie)', ln)):
                    # Check if within next 3 lines there's a rating label
                    lookahead = lines[i+1:i+4]
                    found_rating = ""
                    for la in lookahead:
                        if la in rating_labels:
                            found_rating = la
                            break
                    if found_rating:
                        name = ln
                        # Gather cuisine and times from subsequent lines
                        cuisine = ""
                        times = []
                        for j in range(i+1, min(i+12, len(lines))):
                            jl = lines[j]
                            if not cuisine and jl.startswith("•"):
                                cuisine = jl.strip("• ").strip()
                            tm = re.match(r'^(\d{1,2}:\d{2}\s*[AP]M)\*?$', jl)
                            if tm:
                                times.append(tm.group(1))
                        restaurants.append({
                            "name": name,
                            "cuisine": cuisine or "N/A",
                            "price": "N/A",
                            "rating": found_rating,
                            "available_times": ", ".join(times) if times else "N/A",
                        })
                        i += 6  # skip past this entry
                        continue
                i += 1

        if not restaurants:
            print("❌ ERROR: Extraction failed — no restaurants found from the page.")

        print(f"\nDONE – Top {len(restaurants)} Restaurants:")
        for i, r in enumerate(restaurants, 1):
            print(f"  {i}. {r['name']} | {r['cuisine']} | {r['price']} | {r['rating']} | {r['available_times']}")

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
    return restaurants

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
