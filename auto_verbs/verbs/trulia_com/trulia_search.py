"""
Trulia – Homes for Rent in San Jose, CA (2+ bedrooms)
Pure Playwright – no AI.
"""
import re, os, sys, traceback, shutil, tempfile
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

MAX_RESULTS = 5


def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("trulia_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    listings = []
    try:
        print("STEP 1: Navigate to Trulia rental search...")
        page.goto(
            "https://www.trulia.com/for_rent/San_Jose,CA/2p_beds/",
            wait_until="domcontentloaded", timeout=30000,
        )
        page.wait_for_timeout(6000)

        # Dismiss popups
        for sel in ["button:has-text('Accept')", "#onetrust-accept-btn-handler",
                     "[aria-label='Close']", "button:has-text('Got It')",
                     "button:has-text('No Thanks')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # Scroll to load
        for _ in range(5):
            page.evaluate("window.scrollBy(0, 700)")
            page.wait_for_timeout(800)

        print("STEP 2: Extract rental listings...")

        # Strategy 1: PropertyCard elements
        seen = set()
        cards = page.locator("[class*='PropertyCard']").all()
        print(f"   PropertyCard count: {len(cards)}")
        for card in cards:
            if len(listings) >= MAX_RESULTS:
                break
            try:
                text = card.inner_text(timeout=2000).strip()
                lines = [l.strip() for l in text.splitlines() if l.strip()]
                if len(lines) < 4:
                    continue

                rent = "N/A"
                beds = "N/A"
                baths = "N/A"
                address_parts = []

                for ln in lines:
                    # Skip nav/badge lines
                    if ln.lower() in ("use arrow keys to navigate", "check availability",
                                      "total price") or ln.isupper():
                        continue
                    # Price
                    if re.match(r"\$[\d,]+", ln) and rent == "N/A":
                        rent = ln
                    # Beds
                    elif re.search(r"(\d[\d-]*)\s*Beds?", ln, re.IGNORECASE):
                        m = re.search(r"(\d[\d-]*)\s*Beds?", ln, re.IGNORECASE)
                        beds = m.group(1) if m else beds
                    # Baths
                    elif re.search(r"(\d[\d-]*)\s*Baths?", ln, re.IGNORECASE):
                        m = re.search(r"(\d[\d-]*)\s*Baths?", ln, re.IGNORECASE)
                        baths = m.group(1) if m else baths
                    # Address lines (after price/beds/baths, before Check Availability)
                    elif re.search(r"\d+\s+\w+.*(Rd|Ave|St|Dr|Blvd|Ct|Way|Ln|Pl)", ln, re.IGNORECASE) or \
                         re.search(r"San Jose|CA\s+\d{5}", ln, re.IGNORECASE):
                        address_parts.append(ln.rstrip(","))

                address = ", ".join(address_parts) if address_parts else ""
                if address:
                    key = address.lower()
                    if key not in seen:
                        seen.add(key)
                        listings.append({
                            "address": address,
                            "rent": rent,
                            "beds": beds,
                            "baths": baths,
                        })
            except Exception:
                continue

        # Strategy 2: body text fallback
        if not listings:
            print("   Strategy 1 found 0 — trying body text...")
            body = page.inner_text("body")
            lines = [l.strip() for l in body.splitlines() if l.strip()]
            i = 0
            while i < len(lines) and len(listings) < MAX_RESULTS:
                ln = lines[i]
                if re.search(r"\$[\d,]+", ln):
                    price = ln
                    # Look around for address and bed/bath info
                    context_lines = lines[max(0, i-3):i+5]
                    address = ""
                    beds = "N/A"
                    baths = "N/A"
                    for cl in context_lines:
                        if re.search(r"(San Jose|CA|,\s*CA)", cl, re.IGNORECASE) and not address:
                            address = cl
                        beds_m = re.search(r"(\d+)\s*(?:bd|bed|br)", cl, re.IGNORECASE)
                        baths_m = re.search(r"(\d+)\s*(?:ba|bath)", cl, re.IGNORECASE)
                        if beds_m:
                            beds = beds_m.group(1)
                        if baths_m:
                            baths = baths_m.group(1)
                    if address:
                        key = address.lower()
                        if key not in seen:
                            seen.add(key)
                            listings.append({
                                "address": address,
                                "rent": price,
                                "beds": beds,
                                "baths": baths,
                            })
                i += 1

        if not listings:
            print("❌ ERROR: Extraction failed — no listings found.")

        print(f"\nDONE – Top {len(listings)} Rental Listings:")
        for i, l in enumerate(listings, 1):
            print(f"  {i}. {l['address']}")
            print(f"     Rent: {l['rent']}  |  Beds: {l['beds']}  |  Baths: {l['baths']}")

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
    return listings


if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
