"""
Playwright script (Python) — Airbnb Vacation Rental Search
Destination: Lake Tahoe
Check-in: 2 months from today  Check-out: 3 nights later  (2 guests)

Concretized with zero AI calls — all DOM-based with URL param injection for dates.
Uses the user's Chrome profile for persistent login state.
"""

import re
import os
import urllib.parse
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta
from playwright.sync_api import Playwright, sync_playwright

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws
import shutil


MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def compute_dates(nights: int = 3):
    today = date.today()
    checkin = today + relativedelta(months=2)
    checkout = checkin + timedelta(days=nights)
    return checkin, checkout


def run(
    playwright: Playwright,
    destination: str = "Lake Tahoe",
    num_guests: int = 2,
    nights: int = 3,
    max_results: int = 5,
) -> list:
    checkin, checkout = compute_dates(nights)
    checkin_str = checkin.strftime("%Y-%m-%d")
    checkout_str = checkout.strftime("%Y-%m-%d")
    checkin_display = checkin.strftime("%m/%d/%Y")
    checkout_display = checkout.strftime("%m/%d/%Y")

    print(f"  Destination: {destination}")
    print(f"  Check-in: {checkin_display}  Check-out: {checkout_display}  ({nights} nights, {num_guests} guests)\n")

    port = get_free_port()
    profile_dir = get_temp_profile_dir("airbnb_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate ──────────────────────────────────────────────────
        print("Loading Airbnb...")
        page.goto("https://www.airbnb.com")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(4000)
        print(f"  Loaded: {page.url}")

        # ── Dismiss popups ────────────────────────────────────────────
        for selector in [
            "button:has-text('Close')",
            "button:has-text('Got it')",
            "button:has-text('OK')",
            "[aria-label='Close']",
        ]:
            try:
                btn = page.locator(selector).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass
        page.wait_for_timeout(1000)

        # ── STEP 1: Enter destination ─────────────────────────────────
        print(f'STEP 1: Destination = "{destination}"...')
        search_input = page.locator(
            'input[name="query"], input[placeholder*="Search"], input[id*="bigsearch"]'
        ).first
        try:
            search_input.wait_for(state="visible", timeout=5000)
            search_input.evaluate("el => el.click()")
        except Exception:
            page.locator(
                '[data-testid="structured-search-input-field-query"], '
                'button:has-text("Anywhere")'
            ).first.evaluate("el => el.click()")
            page.wait_for_timeout(1000)
            search_input = page.locator(
                'input[name="query"], input[placeholder*="Search"]'
            ).first
            search_input.evaluate("el => el.click()")
        page.wait_for_timeout(500)

        page.keyboard.press("Control+a")
        page.keyboard.type(destination, delay=50)
        print(f'  Typed "{destination}"')
        page.wait_for_timeout(2000)

        # Select suggestion
        try:
            suggestion = page.locator(
                '[data-testid="option-0"], '
                '[id*="bigsearch-query-location-suggestion-0"], '
                '[role="option"]'
            ).first
            suggestion.wait_for(state="visible", timeout=5000)
            suggestion.evaluate("el => el.click()")
            print("  Selected first suggestion")
        except Exception:
            page.keyboard.press("Enter")
            print("  No suggestion, pressed Enter")
        page.wait_for_timeout(1500)

        # ── STEP 2: Dates — deferred to URL params ───────────────────
        print(f"STEP 2: Dates — will be injected via URL params after search")
        print(f"  Check-in: {checkin_str}, Check-out: {checkout_str}")

        # ── STEP 3: Set guests ────────────────────────────────────────
        print(f"STEP 3: Guests = {num_guests}...")
        # Open guest picker
        guest_opened = False
        for sel in [
            '[data-testid="structured-search-input-field-guests-button"]',
            'button:has-text("Add guests")',
            'button:has-text("Who")',
            'button:has-text("guest")',
        ]:
            try:
                el = page.locator(sel).first
                if el.is_visible(timeout=2000):
                    el.evaluate("el => el.click()")
                    guest_opened = True
                    break
            except Exception:
                pass
        if not guest_opened:
            page.evaluate("""() => {
                const btns = document.querySelectorAll('button, div[role="button"]');
                for (const btn of btns) {
                    const text = (btn.textContent || btn.getAttribute('aria-label') || '').toLowerCase();
                    if (text.includes('guest') || text.includes('who') || text.includes('add guest')) {
                        if (btn.offsetParent !== null) { btn.click(); return true; }
                    }
                }
                return false;
            }""")
        page.wait_for_timeout(1000)

        # Click Adults + button N times
        for _ in range(num_guests):
            try:
                inc = page.locator(
                    '[data-testid="stepper-adults-increase-button"], '
                    'button[aria-label*="increase" i][aria-label*="adult" i]'
                ).first
                inc.evaluate("el => el.click()")
                page.wait_for_timeout(300)
            except Exception:
                print("  WARNING: could not click adults increase button")
                break
        print(f"  Set {num_guests} adults")
        page.wait_for_timeout(500)

        # ── STEP 4: Search ────────────────────────────────────────────
        print("STEP 4: Search...")
        search_clicked = False
        for sel in [
            '[data-testid="structured-search-input-search-button"]',
            'button[type="submit"]',
            'button:has-text("Search")',
        ]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=2000):
                    btn.evaluate("el => el.click()")
                    search_clicked = True
                    break
            except Exception:
                pass
        if not search_clicked:
            page.keyboard.press("Enter")
            print("  Pressed Enter to search")
        else:
            print("  Clicked Search button")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(8000)
        print(f"  URL: {page.url}")

        # ── STEP 4b: Inject dates via URL params ─────────────────────
        print("STEP 4b: Injecting dates & guests via URL params...")
        current_url = page.url
        try:
            parsed = urllib.parse.urlparse(current_url)
            params = urllib.parse.parse_qs(parsed.query)
            params["checkin"] = [checkin_str]
            params["checkout"] = [checkout_str]
            params["adults"] = [str(num_guests)]
            params.pop("flexible_trip_lengths[]", None)
            params.pop("date_picker_type", None)
            new_query = urllib.parse.urlencode(params, doseq=True)
            new_url = urllib.parse.urlunparse(parsed._replace(query=new_query))
        except Exception:
            dest_slug = destination.replace(" ", "-")
            new_url = (
                f"https://www.airbnb.com/s/{urllib.parse.quote(dest_slug)}/homes"
                f"?checkin={checkin_str}&checkout={checkout_str}&adults={num_guests}"
            )

        print(f"  New URL: {new_url}")
        page.goto(new_url)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(6000)
        print(f"  Reloaded with dates: {checkin_str} -> {checkout_str}, {num_guests} guests")
        print(f"  Final URL: {page.url}")

        # ── STEP 5: Extract listings ──────────────────────────────────
        print(f"STEP 5: Extract up to {max_results} listings...")

        # Scroll to load lazy content
        for _ in range(5):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(800)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # DOM extraction using Airbnb card selectors
        js_listings = page.evaluate(
            r"""((maxResults) => {
            const results = [];
            const seen = new Set();
            const cardSelectors = [
                '[data-testid="card-container"]',
                '[itemprop="itemListElement"]',
                '[class*="StayCard"]',
                '[class*="listing-card"]',
                '[class*="PropertyCard"]',
                '[data-testid="listing-card"]',
                'div[aria-labelledby]',
            ];
            let cards = [];
            for (const sel of cardSelectors) {
                const c = document.querySelectorAll(sel);
                if (c.length >= 1 && c.length <= 60) { cards = c; break; }
            }
            if (cards.length === 0) {
                for (const sel of cardSelectors) {
                    const c = document.querySelectorAll(sel);
                    if (c.length > 0) { cards = c; break; }
                }
            }
            for (const card of Array.from(cards).slice(0, maxResults * 3)) {
                const text = (card.textContent || '').replace(/\s+/g, ' ').trim();
                if (text.length < 10) continue;
                let title = 'N/A';
                const titleEl = card.querySelector(
                    '[data-testid="listing-card-title"], [id*="title"], h3, [class*="title"], a[aria-label]'
                );
                if (titleEl) {
                    title = (titleEl.getAttribute('aria-label') || titleEl.textContent || '').trim().substring(0, 120);
                }
                if (title === 'N/A' || title.length < 3) {
                    const link = card.querySelector('a');
                    if (link) title = (link.getAttribute('aria-label') || link.textContent || '').trim().substring(0, 120);
                }
                let price = 'N/A';
                const priceMatch = text.match(/\$(\d[\d,]*)/);
                if (priceMatch) price = '$' + priceMatch[1];
                let rating = 'N/A';
                const ratingMatch = text.match(/(\d\.\d+)\s*(?:\(|out of|\·)/);
                if (ratingMatch) rating = ratingMatch[1];
                else {
                    const rm2 = text.match(/(\d\.\d+)/);
                    if (rm2 && parseFloat(rm2[1]) >= 1.0 && parseFloat(rm2[1]) <= 5.0)
                        rating = rm2[1];
                }
                const key = title.toLowerCase().substring(0, 50);
                if (seen.has(key)) continue;
                seen.add(key);
                if (title !== 'N/A' || price !== 'N/A')
                    results.push({title, price, rating});
                if (results.length >= maxResults) break;
            }
            return results;
        })("""
            + str(max_results)
            + ")"
        )

        results = [
            {"title": l["title"], "price": l["price"], "rating": l["rating"]}
            for l in js_listings
        ]

        # Fallback: body text regex
        if not results:
            print("  Card extraction failed, trying text fallback...")
            body_text = page.evaluate("document.body.innerText") or ""
            for line in body_text.split("\n"):
                if len(results) >= max_results:
                    break
                pm = re.search(r"\$(\d[\d,]*)", line)
                if pm and 10 < len(line.strip()) < 200:
                    results.append(
                        {
                            "title": line.strip()[:100],
                            "price": "$" + pm.group(1),
                            "rating": "N/A",
                        }
                    )

        # ── Print results ─────────────────────────────────────────────
        print(f"\nFound {len(results)} listings in '{destination}':")
        print(
            f"  Check-in: {checkin_display}  Check-out: {checkout_display}"
            f"  ({nights} nights, {num_guests} guests)\n"
        )
        for i, listing in enumerate(results, 1):
            print(f"  {i}. {listing['title']}")
            print(f"     Price: {listing['price']}/night  Rating: {listing['rating']}")

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
        print(f"\nTotal listings found: {len(items)}")
