"""
Auto-generated Playwright script (Python)
Redfin Rental Search: Redmond, WA with price filter ($1500-$3000)

Generated on: 2026-02-24T17:54:17.204Z
Recorded 22 browser interactions
Note: This script was generated using AI-driven discovery patterns
"""

import re
import os
from playwright.sync_api import Playwright, sync_playwright, expect


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


def run(playwright: Playwright) -> None:
    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default",
    )

    context = playwright.chromium.launch_persistent_context(
        user_data_dir,
        channel="chrome",
        headless=False,
        viewport=None,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--disable-extensions",
            "--start-maximized",
        ],
    )
    page = context.pages[0] if context.pages else context.new_page()

    # Navigate to Redfin Rentals
    page.goto("https://www.redfin.com/rentals")
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(3000)

    # Click main search input field
    page.get_by_role("searchbox", name=re.compile(r"Search for properties", re.IGNORECASE)).first.click()
    page.wait_for_timeout(500)

    # Type location
    search_box = page.get_by_role("searchbox", name=re.compile(r"Search for properties", re.IGNORECASE)).first
    search_box.fill("Redmond, WA")

    # Wait for autocomplete suggestions
    page.wait_for_timeout(2000)

    # Select autocomplete suggestion; fallback to Enter
    try:
        page.locator("[data-rf-test-id='search-input-menu'] a, .SearchInputHome_suggestionItem__lRJk6, [class*='suggestion'] a").first.click(timeout=5000)
    except Exception:
        search_box.press("Enter")

    page.wait_for_timeout(1000)

    # Wait for search results page to load
    page.wait_for_timeout(3000)
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(2000)

    # Ensure we are on the rental results page
    # Autocomplete suggestions redirect to "For Sale" — rewrite URL to /apartments-for-rent
    current_url = page.url
    if "/apartments-for-rent" not in current_url and "rent" not in current_url.lower():
        rental_url = current_url.rstrip("/") + "/apartments-for-rent"
        page.goto(rental_url)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)

    # Click Price filter button (with fallbacks)
    price_clicked = False
    for price_selector in [
        ("button", re.compile(r"price", re.IGNORECASE)),
        ("button", re.compile(r"rent", re.IGNORECASE)),
        ("button", re.compile(r"\\$", re.IGNORECASE)),
    ]:
        try:
            page.get_by_role(price_selector[0], name=price_selector[1]).first.click(timeout=5000)
            price_clicked = True
            break
        except Exception:
            continue

    if not price_clicked:
        for css in ["button:has-text('Price')", "button:has-text('Rent')", "[data-rf-test-id*='price']"]:
            try:
                el = page.locator(css).first
                if el.is_visible(timeout=3000):
                    el.click()
                    price_clicked = True
                    break
            except Exception:
                continue

    # Wait for price filter dropdown
    page.wait_for_timeout(2000)

    # Enter min price
    min_input = page.get_by_placeholder(re.compile(r"min", re.IGNORECASE)).first
    min_input.click()
    min_input.fill("1500")
    page.wait_for_timeout(500)

    # Enter max price
    max_input = page.get_by_placeholder(re.compile(r"max", re.IGNORECASE)).first
    max_input.click()
    max_input.fill("3000")
    page.wait_for_timeout(500)

    # Apply the price filter
    try:
        page.get_by_role("button", name=re.compile(r"Apply|Done|Update", re.IGNORECASE)).first.click(timeout=5000)
    except Exception:
        max_input.press("Enter")

    # Wait for filtered results to load
    page.wait_for_timeout(3000)

    # Extract apartment listings from the page
    listings = extract_listings(page, max_listings=5)

    print(f"\nFound {len(listings)} rental listings in Redmond, WA ($1500-$3000):\n")
    for i, apt in enumerate(listings, 1):
        addr = apt.get("address", "N/A")
        price = apt.get("price", "N/A")
        beds = apt.get("beds", "")
        baths = apt.get("baths", "")
        sqft = apt.get("sqft", "")
        details = " | ".join(filter(None, [beds, baths, sqft]))
        print(f"  {i}. {addr}")
        print(f"     Price: {price}  {details}")

    # ---------------------
    # Cleanup
    # ---------------------
    context.close()


with sync_playwright() as playwright:
    run(playwright)
