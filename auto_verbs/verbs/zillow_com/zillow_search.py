"""
Zillow – Homes for Sale in Bellevue, WA ($500K–$1M, 3+ beds)
Pure Playwright – no AI.
"""
import re, os, sys, traceback, shutil, tempfile
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

MAX_RESULTS = 5


def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("zillow_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    listings = []
    try:
        print("STEP 1: Navigate to Zillow search...")
        # Use search query URL with price/beds filters
        page.goto(
            "https://www.zillow.com/bellevue-wa/?searchQueryState=%7B%22pagination%22%3A%7B%7D%2C%22isMapVisible%22%3Atrue%2C%22filterState%22%3A%7B%22price%22%3A%7B%22min%22%3A500000%2C%22max%22%3A1000000%7D%2C%22beds%22%3A%7B%22min%22%3A3%7D%2C%22sort%22%3A%7B%22value%22%3A%22globalrelevanceex%22%7D%7D%7D",
            wait_until="domcontentloaded", timeout=30000,
        )
        page.wait_for_timeout(6000)

        # Dismiss popups
        for sel in ["button:has-text('Accept')", "#onetrust-accept-btn-handler",
                     "[aria-label='Close']", "button:has-text('Got It')",
                     "button:has-text('Skip')", "#px-captcha"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # Scroll to load listings
        for _ in range(5):
            page.evaluate("window.scrollBy(0, 700)")
            page.wait_for_timeout(800)

        print("STEP 2: Extract home listings...")

        # Strategy 1: Zillow property cards
        seen = set()
        card_sels = [
            "[data-test='property-card']",
            "article[data-test='property-card']",
            "[class*='ListItem'] article",
            "[class*='property-card']",
            "[id*='zpid']",
            "ul[class*='photo-cards'] li",
        ]
        for sel in card_sels:
            if len(listings) >= MAX_RESULTS:
                break
            try:
                cards = page.locator(sel).all()
                if not cards:
                    continue
                print(f"   Selector '{sel}' → {len(cards)} elements")
                for card in cards:
                    if len(listings) >= MAX_RESULTS:
                        break
                    try:
                        text = card.inner_text(timeout=2000).strip()
                        lines = [l.strip() for l in text.splitlines() if l.strip()]
                        if len(lines) < 2:
                            continue

                        address = ""
                        price = "N/A"
                        beds = "N/A"
                        baths = "N/A"
                        sqft = "N/A"

                        for ln in lines:
                            if re.search(r"\$[\d,]+", ln) and price == "N/A":
                                price = ln
                            elif re.search(r"\d+\s*(?:bd|bed|br)", ln, re.IGNORECASE):
                                beds_m = re.search(r"(\d+)\s*(?:bd|bed|br)", ln, re.IGNORECASE)
                                baths_m = re.search(r"(\d+)\s*(?:ba|bath)", ln, re.IGNORECASE)
                                sqft_m = re.search(r"([\d,]+)\s*(?:sqft|sq\s*ft)", ln, re.IGNORECASE)
                                if beds_m:
                                    beds = beds_m.group(1)
                                if baths_m:
                                    baths = baths_m.group(1)
                                if sqft_m:
                                    sqft = sqft_m.group(1)
                            elif re.search(r"([\d,]+)\s*(?:sqft|sq\s*ft)", ln, re.IGNORECASE) and sqft == "N/A":
                                sqft_m = re.search(r"([\d,]+)\s*(?:sqft|sq\s*ft)", ln, re.IGNORECASE)
                                if sqft_m:
                                    sqft = sqft_m.group(1)
                            elif re.search(r"(Bellevue|WA|,\s*WA)", ln, re.IGNORECASE) and not address:
                                address = ln
                            elif not address and len(ln) > 10 and len(ln) < 100:
                                # Could be address — skip known non-address patterns
                                skip_words = ["save", "new", "open", "photo", "price",
                                              "bed", "bath", "sqft", "$"]
                                if not any(sw in ln.lower() for sw in skip_words):
                                    address = ln

                        if (address or price != "N/A") and (address or "").lower() not in seen:
                            if address:
                                seen.add(address.lower())
                            listings.append({
                                "address": address or "N/A",
                                "price": price,
                                "beds": beds,
                                "baths": baths,
                                "sqft": sqft,
                            })
                    except Exception:
                        continue
            except Exception:
                continue

        # Strategy 2: body text
        if not listings:
            print("   Strategy 1 found 0 — trying body text...")
            body = page.inner_text("body")
            lines = [l.strip() for l in body.splitlines() if l.strip()]
            i = 0
            while i < len(lines) and len(listings) < MAX_RESULTS:
                ln = lines[i]
                if re.search(r"\$[\d,]+", ln):
                    price = ln
                    context_lines = lines[max(0, i-3):i+5]
                    address = ""
                    beds = "N/A"
                    baths = "N/A"
                    sqft = "N/A"
                    for cl in context_lines:
                        if re.search(r"(Bellevue|WA|,\s*WA)", cl, re.IGNORECASE) and not address:
                            address = cl
                        beds_m = re.search(r"(\d+)\s*(?:bd|bed|br)", cl, re.IGNORECASE)
                        baths_m = re.search(r"(\d+)\s*(?:ba|bath)", cl, re.IGNORECASE)
                        sqft_m = re.search(r"([\d,]+)\s*(?:sqft|sq\s*ft)", cl, re.IGNORECASE)
                        if beds_m:
                            beds = beds_m.group(1)
                        if baths_m:
                            baths = baths_m.group(1)
                        if sqft_m:
                            sqft = sqft_m.group(1)
                    if address:
                        key = address.lower()
                        if key not in seen:
                            seen.add(key)
                            listings.append({
                                "address": address,
                                "price": price,
                                "beds": beds,
                                "baths": baths,
                                "sqft": sqft,
                            })
                i += 1

        if not listings:
            # Check for CAPTCHA or block
            body = page.inner_text("body")
            if "captcha" in body.lower() or "verify" in body.lower() or "robot" in body.lower():
                print("❌ ERROR: Blocked by CAPTCHA/bot detection.")
            else:
                print("❌ ERROR: Extraction failed — no listings found.")

        print(f"\nDONE – Top {len(listings)} Home Listings:")
        for i, l in enumerate(listings, 1):
            print(f"  {i}. {l['address']}")
            print(f"     Price: {l['price']}  |  Beds: {l['beds']}  |  Baths: {l['baths']}  |  SqFt: {l['sqft']}")

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
