"""
Expedia – Hotels in San Diego
Search: Hotels in San Diego, CA | Check-in: ~60 days out | Check-out: 3 nights later
Sort: Recommended | Top 5 (name, price per night, rating)

Pure Playwright – no AI. Launches real Chrome directly (like Stagehand JS) and
connects via CDP to avoid anti-bot detection. No navigator.webdriver=true.

Resolves arbitrary destination input via Expedia's typeahead API to get canonical
name, regionId, and latLong — then builds a direct search URL.
Uses shared cdp_utils for Chrome launch.
"""

import json
import re
import os
import sys
import tempfile
import traceback
from datetime import date, timedelta
from urllib.parse import quote_plus
from urllib.request import urlopen, Request

from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import (
    get_free_port,
    launch_chrome,
    wait_for_cdp_ws,
    cdp_cleanup,
)

DEST = "San Diego, CA"
MAX_RESULTS = 5


# ── Destination resolver ─────────────────────────────────────────────────

def resolve_destination(query: str) -> dict:
    """
    Call Expedia's typeahead API to resolve arbitrary input
    (e.g. "SD", "san diego", "NYC") into canonical destination info:
      - name:     "San Diego, California, United States of America"
      - regionId: "3073"
      - latLong:  "32.715736,-117.161087"
    Falls back to just URL-encoding the raw query if the API fails.
    """
    try:
        api_url = (
            f"https://www.expedia.com/api/v4/typeahead/{quote_plus(query)}"
            f"?locale=en_US&siteid=1&maxresults=1"
        )
        req = Request(api_url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                          "AppleWebKit/537.36 (KHTML, like Gecko) "
                          "Chrome/131.0.0.0 Safari/537.36",
        })
        resp = urlopen(req, timeout=10)
        data = json.loads(resp.read())
        hit = data["sr"][0]
        result = {
            "name": hit["regionNames"]["fullName"],
            "regionId": hit.get("gaiaId") or hit.get("hotelId", ""),
            "latLong": (
                f"{hit['coordinates']['lat']},{hit['coordinates']['long']}"
                if "coordinates" in hit else ""
            ),
        }
        print(f"   Resolved '{query}' → {result['name']} "
              f"(region={result['regionId']})")
        return result
    except Exception as e:
        print(f"   ⚠ Typeahead API failed ({e}) — using raw query")
        return {"name": query, "regionId": "", "latLong": ""}


def build_search_url(dest_info: dict, checkin: str, checkout: str,
                     adults: int = 2, sort: str = "RECOMMENDED") -> str:
    """Build the Expedia Hotel-Search URL from resolved destination info."""
    params = [
        f"destination={quote_plus(dest_info['name'])}",
        f"startDate={checkin}",
        f"endDate={checkout}",
        f"adults={adults}",
        f"sort={sort}",
    ]
    if dest_info["regionId"]:
        params.append(f"regionId={dest_info['regionId']}")
    if dest_info["latLong"]:
        params.append(f"latLong={quote_plus(dest_info['latLong'])}")
    return "https://www.expedia.com/Hotel-Search?" + "&".join(params)


# ── Page helpers ──────────────────────────────────────────────────────────

def dismiss_popups(page):
    """Dismiss cookie / promo popups."""
    for sel in [
        "button:has-text('Accept')",
        "button:has-text('Accept All')",
        "button:has-text('Close')",
        "button:has-text('No Thanks')",
        "button:has-text('Got it')",
        "button[aria-label='Close']",
        "[data-stid='close-button']",
    ]:
        try:
            loc = page.locator(sel).first
            if loc.is_visible(timeout=600):
                loc.evaluate("el => el.click()")
                page.wait_for_timeout(300)
        except Exception:
            pass


# ── Main ──────────────────────────────────────────────────────────────────

def run(
    playwright: Playwright,
    destination: str = DEST,
    max_results: int = MAX_RESULTS,
) -> list:
    print("=" * 60)
    print(f"  Expedia – Hotels in {destination}")
    print("=" * 60)

    # Calculate dates: ~60 days out, 3-night stay
    checkin = date.today() + timedelta(days=60)
    checkout = checkin + timedelta(days=3)
    ci_str = checkin.strftime("%Y-%m-%d")
    co_str = checkout.strftime("%Y-%m-%d")
    print(f"  Check-in:  {ci_str}")
    print(f"  Check-out: {co_str}")
    print(f"  Max results: {max_results}\n")

    # Resolve destination via typeahead API
    print("STEP 1: Resolve destination…")
    dest_info = resolve_destination(destination)

    # Build search URL
    url = build_search_url(dest_info, ci_str, co_str)
    print(f"   URL: {url}\n")

    # Launch real Chrome directly (like Stagehand JS does)
    tmp_profile = tempfile.mkdtemp(prefix="expedia_")
    port = get_free_port()
    chrome_proc = None
    browser = None
    hotels = []

    print(f"  Temp profile: {tmp_profile}")
    print(f"  CDP port: {port}")

    try:
        print("  Launching real Chrome (no Playwright automation markers)...")
        chrome_proc = launch_chrome(tmp_profile, port)
        ws_url = wait_for_cdp_ws(port)
        print(f"  ✅ Chrome running (pid={chrome_proc.pid}), connecting via CDP...")

        # Connect Playwright to the already-running Chrome via CDP
        browser = playwright.chromium.connect_over_cdp(ws_url)
        context = browser.contexts[0]
        page = context.pages[0] if context.pages else context.new_page()

        print("STEP 2: Navigate to search results…")
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(6000)
        dismiss_popups(page)
        print(f"   Loaded: {page.url}\n")

        # Wait for hotel cards to appear
        loaded = False
        for wait_sel in [
            "[data-stid='property-listing']",
            "[data-stid='lodging-card-responsive']",
            "[data-stid='section-results']",
            ".uitk-card",
            "h3",
        ]:
            try:
                page.wait_for_selector(wait_sel, timeout=8000)
                print(f"   ✅ Selector '{wait_sel}' appeared")
                loaded = True
                break
            except Exception:
                pass

        if not loaded:
            print("   ⚠ No known result selector appeared — will try fallbacks")

        # Scroll to trigger lazy loading — more scrolling for 5+ cards
        for _ in range(10):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(600)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(500)

        print("STEP 3: Extract hotel listings…")

        # ──────────────────────────────────────────────────────
        # Strategy 1: page.evaluate() — Expedia data-stid selectors + h3 fallback
        # ──────────────────────────────────────────────────────
        hotels = page.evaluate("""(max) => {
            const results = [];
            const seen = new Set();

            // Phase A: structured cards (lodging-card-responsive, property-listing, uitk-card)
            let cards = document.querySelectorAll('[data-stid="lodging-card-responsive"]');
            if (cards.length === 0) cards = document.querySelectorAll('[data-stid="property-listing"]');
            if (cards.length === 0) cards = document.querySelectorAll('.uitk-card');

            for (const card of cards) {
                if (results.length >= max) break;

                let name = '';
                const heading = card.querySelector('h3') || card.querySelector('h4') || card.querySelector('[data-stid="content-hotel-title"]');
                if (heading) name = heading.innerText.trim();
                if (!name) {
                    const strong = card.querySelector('strong, [class*="title"], [class*="name"]');
                    if (strong) name = strong.innerText.trim();
                }
                if (!name || name.length < 3) continue;
                name = name.replace(/^Photo gallery for /i, '');

                let price = 'N/A';
                const priceEl = card.querySelector('[data-stid="content-hotel-price"]')
                    || card.querySelector('[class*="price"]')
                    || card.querySelector('[data-test-id="price"]');
                if (priceEl) {
                    const m = priceEl.innerText.match(/\\$(\\d[\\d,]*)/);
                    if (m) price = '$' + m[1];
                }
                if (price === 'N/A') {
                    const m = card.innerText.match(/\\$(\\d[\\d,]*)/);
                    if (m) price = '$' + m[1];
                }

                let rating = 'N/A';
                const ratingEl = card.querySelector('[class*="rating"], [data-stid*="rating"]');
                if (ratingEl) {
                    const rm = ratingEl.innerText.match(/(\\d+\\.\\d)/);
                    if (rm) rating = rm[1];
                }

                const key = name.toLowerCase();
                if (!seen.has(key)) {
                    seen.add(key);
                    results.push({ name: name.substring(0, 100), price_per_night: price, rating });
                }
            }

            // Phase B: if not enough, scan ALL h3 elements and walk up to parent card for price
            if (results.length < max) {
                const headings = document.querySelectorAll('h3');
                for (const h of headings) {
                    if (results.length >= max) break;
                    let name = h.innerText.trim();
                    if (!name || name.length < 3 || name.length > 100) continue;
                    name = name.replace(/^Photo gallery for /i, '');
                    const key = name.toLowerCase();
                    if (seen.has(key)) continue;

                    // Walk up to find a parent container with a price
                    let price = 'N/A';
                    let parent = h.closest('div[class*="card"], div[class*="listing"], section, article, li') || h.parentElement;
                    for (let p = 0; p < 6 && parent; p++) {
                        const text = parent.innerText || '';
                        const m = text.match(/\\$(\\d[\\d,]*)/);
                        if (m) { price = '$' + m[1]; break; }
                        parent = parent.parentElement;
                    }
                    if (price !== 'N/A') {
                        seen.add(key);
                        results.push({ name: name.substring(0, 100), price_per_night: price, rating: 'N/A' });
                    }
                }
            }

            return results;
        }""", max_results)

        if hotels:
            print(f"   ✅ Strategy 1 (cards + h3 scan): {len(hotels)} hotels")

        # ──────────────────────────────────────────────────────
        # Strategy 2: Text fallback — parse body text with regex
        # ──────────────────────────────────────────────────────
        if not hotels:
            print("   ⚠ Strategy 1 returned 0 — trying text fallback…")
            body = page.locator("body").inner_text(timeout=15000)
            lines = [l.strip() for l in body.split("\n") if l.strip()]

            hotel_re = re.compile(
                r"hotel|inn|resort|suites|lodge|hilton|marriott|hyatt|"
                r"comfort|hampton|courtyard|holiday|ramada|radisson|"
                r"sheraton|westin|doubletree|embassy|fairfield|"
                r"residence|springhill|la quinta|best western|wyndham|"
                r"crowne|kimpton|omni|del mar|old town|gaslamp",
                re.IGNORECASE,
            )
            skip_phrases = [
                "search", "filter", "sort", "show", "map", "sponsored",
                "compare", "viewed", "see how", "price alert", "sign in",
                "member", "earn", "reward", "free cancellation",
            ]

            i = 0
            while i < len(lines) and len(hotels) < max_results:
                line = lines[i]
                lower = line.lower()

                if (hotel_re.search(line)
                        and 5 < len(line) < 100
                        and not any(lower.startswith(p) for p in skip_phrases)
                        and any(c.isalpha() for c in line)):
                    price = "N/A"
                    for j in range(i, min(i + 10, len(lines))):
                        m = re.search(r"\$(\d[\d,]*)", lines[j])
                        if m:
                            price = "$" + m.group(1)
                            break
                    hotels.append({"name": line[:100], "price_per_night": price, "rating": "N/A"})
                    i += 6
                else:
                    i += 1

            if hotels:
                print(f"   ✅ Strategy 2 (text parsing): {len(hotels)} hotels")

        print(f"\n" + "=" * 60)
        print(f"  DONE – {len(hotels)} hotels")
        print("=" * 60)
        for i, h in enumerate(hotels, 1):
            print(f"  {i}. {h['name']}")
            print(f"     Price/night: {h['price_per_night']}")
            if h.get('rating', 'N/A') != 'N/A':
                print(f"     Rating:      {h['rating']}")
            print()

    except Exception as e:
        print(f"\nError: {e}")
        traceback.print_exc()
    finally:
        cdp_cleanup(browser, chrome_proc, tmp_profile)

    return hotels


if __name__ == "__main__":
    with sync_playwright() as playwright:
        items = run(playwright)
        print(f"Total results: {len(items)}")
