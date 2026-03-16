"""
Auto-generated Playwright script (Python)
Redfin Rental Search: Redmond, WA with price filter ($1500-$3000)

Generated on: 2026-02-24T17:54:17.204Z
Recorded 22 browser interactions
Note: This script was generated using AI-driven discovery patterns

Uses Playwright persistent context with real Chrome Default profile.
IMPORTANT: Close ALL Chrome windows before running!
"""

import re
import os
from playwright.sync_api import Playwright, sync_playwright, expect

from dataclasses import dataclass





def extract_listings(page, max_listings=5):
    """Extract apartment rental listings from the current search results page."""
    listings = []
    seen_addresses = set()

    # Try common Redfin rental card selectors
    card_selectors = [
        "[data-rf-test-id='photo-card']",
        ".RentalHomeCard",
        ".HomeCard",
        "[class*='HomeCard']",
        "[class*='RentalCard']",
        "[class*='rental-card']",
        ".MapHomeCard",
    ]

    cards = None
    for sel in card_selectors:
        found = page.locator(sel)
        if found.count() > 0:
            cards = found
            break

    if not cards or cards.count() == 0:
        print("Warning: Could not find listing cards on the page.")
        return listings

    total = cards.count()
    for i in range(total):
        if len(listings) >= max_listings:
            break
        card = cards.nth(i)
        try:
            text = card.inner_text(timeout=3000)
            lines = [l.strip() for l in text.split("\n") if l.strip()]

            listing = {}

            # --- Extract price (e.g. "$1,879+/mo", "Studio: $2,060") ---
            for line in lines:
                if re.search(r"\$[\d,]+", line) and "price" not in listing:
                    listing["price"] = line.strip()
                    break

            # --- Extract address from dedicated element ---
            address = None
            try:
                addr_el = card.locator(
                    "[class*='address' i], [class*='Address'], "
                    "[data-rf-test-id='abp-homeinfo-homeAddress'], "
                    "[class*='homecardV2__address' i]"
                ).first
                if addr_el.is_visible(timeout=1000):
                    address = addr_el.inner_text(timeout=1000).strip()
            except Exception:
                pass

            # Fallback: look for a line that looks like a street address
            if not address:
                for line in lines:
                    if re.search(r"\d+\s+\w+\s+(St|Ave|Blvd|Dr|Rd|Ln|Ct|Cir|Way|Pl)", line, re.IGNORECASE):
                        address = line.strip()
                        break

            # Fallback: try the property name (first meaningful line)
            if not address:
                for line in lines:
                    if (not re.search(r"^\$", line)
                            and not re.search(r"(WALKTHROUGH|ABOUT|FREE|WEEKS)", line, re.IGNORECASE)
                            and len(line) > 3):
                        address = line.strip()
                        break

            # Clean up address: remove newlines and pipe separators
            if address:
                address = re.sub(r"\s*\n\s*\|?\s*", ", ", address).strip(", ")
            listing["address"] = address or "N/A"

            # Deduplicate by address
            addr_key = listing["address"].lower().strip()
            if addr_key in seen_addresses:
                continue
            seen_addresses.add(addr_key)

            # --- Extract beds / baths / sqft ---
            for line in lines:
                # Only match short lines for beds/baths/sqft to avoid description text
                if len(line) > 80:
                    continue
                if re.search(r"\d+\s*(bed|bd)", line, re.IGNORECASE) and "beds" not in listing:
                    listing["beds"] = line.strip()
                elif re.search(r"\d+\s*(bath|ba)", line, re.IGNORECASE) and "baths" not in listing:
                    listing["baths"] = line.strip()
                elif re.search(r"[\d,]+\s*sq\s*ft", line, re.IGNORECASE) and "sqft" not in listing:
                    listing["sqft"] = line.strip()

            listings.append(listing)
        except Exception as e:
            print(f"Warning: Could not extract listing {i + 1}: {e}")

    return listings



@dataclass(frozen=True)
class RedfinSearchRequest:
    location: str
    max_results: int


@dataclass(frozen=True)
class RedfinHome:
    address: str
    price: str
    beds: str
    sqft: str


@dataclass(frozen=True)
class RedfinSearchResult:
    location: str
    homes: list[RedfinHome]


# Searches Redfin for homes for sale in a location and returns up to max_results listings.

def search_redfin_homes(playwright, request: RedfinSearchRequest) -> RedfinSearchResult:
    import shutil, tempfile, sys, os as _os
    sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), '..'))
    from cdp_utils import get_free_port, launch_chrome, wait_for_cdp_ws
    port = get_free_port()
    profile_dir = tempfile.mkdtemp(prefix="redfin_")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    raw = []
    try:
        query = request.location.replace(" ", "%20").replace(",", "%2C")
        url = f"https://www.redfin.com/city/16163/WA/Seattle/apartments-for-rent"
        print(f"Navigating to Redfin rentals for {request.location}...")
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(800)
        raw = extract_listings(page, request.max_results)
        browser.close()
    except Exception as e:
        print(f"Error: {e}")
    finally:
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)
    return RedfinSearchResult(
        location=request.location,
        homes=[RedfinHome(
            address=r.get("address","N/A"), price=r.get("price","N/A"),
            beds=r.get("beds","N/A"), sqft=r.get("sqft","N/A"),
        ) for r in raw],
    )


def test_search_redfin_homes() -> None:
    from datetime import date
    today = date.today()

    request = RedfinSearchRequest(
        location="Seattle, WA",
        max_results=5,
    )

    with sync_playwright() as pw:
        result = search_redfin_homes(pw, request)

    assert isinstance(result, RedfinSearchResult)
    assert len(result.homes) <= request.max_results
    print(f'\nFound {len(result.homes)} homes')
    for i, item in enumerate(result.homes, 1):
        print(f'  {i}. {item.address}')


if __name__ == "__main__":
    test_search_redfin_homes()
