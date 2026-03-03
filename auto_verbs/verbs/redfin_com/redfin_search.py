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


def get_chrome_default_profile() -> str:
    """Get the Chrome Default profile path (not User Data, but Default subfolder)."""
    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default",
    )
    if os.path.isdir(user_data_dir):
        return user_data_dir
    raise FileNotFoundError("Could not find Chrome Default profile")


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
    # Use REAL Chrome Default profile (Chrome must be closed first!)
    user_data_dir = get_chrome_default_profile()
    print(f"Using Chrome profile: {user_data_dir}")
    print("NOTE: Close ALL Chrome windows before running!\n")
    
    context = playwright.chromium.launch_persistent_context(
        user_data_dir,
        channel="chrome",
        headless=False,
        viewport={"width": 1280, "height": 900},
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--disable-extensions",
            "--start-maximized",
        ],
    )
    page = context.pages[0] if context.pages else context.new_page()
    
    # Navigate to Redfin rentals page and search (like the JS version)
    print("STEP 1: Navigate to Redfin rentals...")
    page.goto("https://www.redfin.com/rentals", wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    
    # Dismiss any popups first
    for sel in ["button:has-text('Accept')", "button:has-text('Got It')",
                 "[aria-label='Close']", "button:has-text('No Thanks')",
                 "#onetrust-accept-btn-handler"]:
        try:
            loc = page.locator(sel).first
            if loc.is_visible(timeout=800):
                loc.evaluate("el => el.click()")
                page.wait_for_timeout(500)
        except Exception:
            pass
    
    # Find and click the search box
    print("STEP 2: Search for Redmond, WA...")
    search_box = None
    
    # Find the best visible search box (there are multiple, pick one with valid bounding box)
    try:
        all_search = page.locator("#search-box-input").all()
        best_sb = None
        best_width = 0
        for sb in all_search:
            try:
                if sb.is_visible(timeout=500):
                    bb = sb.bounding_box()
                    if bb and bb['y'] >= 0 and bb['width'] > best_width:
                        best_width = bb['width']
                        best_sb = sb
            except:
                continue
        if best_sb:
            search_box = best_sb
    except Exception as e:
        print(f"   Search box lookup error: {e}")
    
    # Fallback: try other selectors
    if not search_box:
        for sel in ["input.search-input-box", "input[type='search']"]:
            try:
                sb = page.locator(sel).first
                if sb.is_visible(timeout=500):
                    search_box = sb
                    break
            except:
                continue
    
    if search_box:
        search_box.click()
        page.wait_for_timeout(500)
        search_box.fill("Redmond, WA")
        page.wait_for_timeout(2000)
        
        # Click autocomplete suggestion or press Enter
        suggestion_clicked = False
        suggestion_selectors = [
            "[data-rf-test-id='search-input-menu'] a",
            "[class*='suggestion'] a",
            "[class*='autocomplete'] a",
            "li[role='option']",
        ]
        for sel in suggestion_selectors:
            try:
                sug = page.locator(sel).first
                if sug.is_visible(timeout=2000):
                    sug.click()
                    suggestion_clicked = True
                    break
            except Exception:
                continue
        
        if not suggestion_clicked:
            search_box.press("Enter")
        
        page.wait_for_timeout(5000)
    else:
        print("   Could not find search box - trying direct URL...")
        page.goto("https://www.redfin.com/city/15285/WA/Redmond/apartments-for-rent")
        page.wait_for_timeout(5000)
    
    # Ensure we're on the rentals page (not for sale)
    current_url = page.url
    print(f"   URL: {current_url}")
    
    if "/apartments-for-rent" not in current_url and "/rentals" not in current_url.lower():
        # Rewrite URL to rentals
        if "/WA/Redmond" in current_url or "/city/" in current_url:
            rental_url = re.sub(r"(/WA/Redmond).*", r"\1/apartments-for-rent", current_url)
            if rental_url != current_url:
                print(f"   Redirecting to rentals: {rental_url}")
                page.goto(rental_url)
                page.wait_for_timeout(3000)

    # Click Price filter button (with fallbacks)
    price_clicked = False
    for price_selector in [
        ("button", re.compile(r"price", re.IGNORECASE)),
        ("button", re.compile(r"rent", re.IGNORECASE)),
        ("button", re.compile(r"\\$", re.IGNORECASE)),
    ]:
        try:
            page.get_by_role(price_selector[0], name=price_selector[1]).first.evaluate("el => el.click()")
            price_clicked = True
            break
        except Exception:
            continue

    if not price_clicked:
        for css in ["button:has-text('Price')", "button:has-text('Rent')", "[data-rf-test-id*='price']"]:
            try:
                el = page.locator(css).first
                if el.is_visible(timeout=3000):
                    el.evaluate("el => el.click()")
                    price_clicked = True
                    break
            except Exception:
                continue

    # Try to set price filter (optional - skip if UI changed)
    price_filtered = False
    if price_clicked:
        page.wait_for_timeout(2000)
        try:
            # Enter min price
            min_input = page.get_by_placeholder(re.compile(r"min", re.IGNORECASE)).first
            if min_input.is_visible(timeout=3000):
                min_input.evaluate("el => el.click()")
                min_input.fill("1500")
                page.wait_for_timeout(500)

                # Enter max price
                max_input = page.get_by_placeholder(re.compile(r"max", re.IGNORECASE)).first
                max_input.evaluate("el => el.click()")
                max_input.fill("3000")
                page.wait_for_timeout(500)

                # Apply the price filter
                try:
                    page.get_by_role("button", name=re.compile(r"Apply|Done|Update", re.IGNORECASE)).first.evaluate("el => el.click()")
                except Exception:
                    max_input.press("Enter")
                
                price_filtered = True
                page.wait_for_timeout(3000)
        except Exception as e:
            print(f"   Note: Price filter not applied ({e})")
    
    if not price_filtered:
        print("   Showing results without price filter")
        page.wait_for_timeout(2000)

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
    try:
        context.close()
    except Exception:
        pass


with sync_playwright() as playwright:
    run(playwright)
