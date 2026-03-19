"""
Zillow – Homes for Sale search with configurable location, price range, and bedroom count.
Pure Playwright – no AI.
"""   
import re, os, sys, traceback, threading, json, urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dataclasses import dataclass


@dataclass(frozen=True)
class ZillowSearchRequest:
    location: str = "Bellevue, WA"
    min_price: int = 500000
    max_price: int = 1000000
    min_beds: int = 3
    max_results: int = 5


@dataclass(frozen=True)
class ZillowListing:
    address: str
    price: str
    beds: str
    baths: str
    sqft: str


@dataclass(frozen=True)
class ZillowSearchResult:
    location: str
    listings: list





def search_zillow_homes(playwright, request: ZillowSearchRequest) -> ZillowSearchResult:
    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default"
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
        ],
    )
    page = context.pages[0] if context.pages else context.new_page()
    listings = []

    def _watchdog():
        print("\n⏱️  WATCHDOG: 90s timeout — closing browser...")
        try:
            context.close()
        except Exception:
            pass
        os._exit(1)

    timer = threading.Timer(90, _watchdog)
    timer.daemon = True
    timer.start()
    try:
        print("STEP 1: Navigate to Zillow search...")
        # Build URL from request fields — no hardcoded values
        # Convert "Bellevue, WA" → "bellevue-wa" for the URL path slug
        loc_slug = re.sub(r'[,\s]+', '-', request.location.strip()).lower()
        loc_slug = re.sub(r'-+', '-', loc_slug).strip('-')

        # searchQueryState is a JSON filter object Zillow uses
        query_state = {
            "pagination": {},
            "isMapVisible": True,
            "filterState": {
                "price": {"min": request.min_price, "max": request.max_price},
                "beds": {"min": request.min_beds},
                "sort": {"value": "globalrelevanceex"},
            },
        }
        encoded_qs = urllib.parse.quote(json.dumps(query_state, separators=(',', ':')))
        search_url = f"https://www.zillow.com/{loc_slug}/?searchQueryState={encoded_qs}"
        print(f"   URL: {search_url[:120]}...")
        page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
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
            if len(listings) >= request.max_results:
                break
            try:
                cards = page.locator(sel).all()
                if not cards:
                    continue
                print(f"   Selector '{sel}' → {len(cards)} elements")
                for card in cards:
                    if len(listings) >= request.max_results:
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
                            elif re.search(re.escape(request.location.split(',')[0]), ln, re.IGNORECASE) and not address:
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
            while i < len(lines) and len(listings) < request.max_results:
                ln = lines[i]
                if re.search(r"\$[\d,]+", ln):
                    price = ln
                    context_lines = lines[max(0, i-3):i+5]
                    address = ""
                    beds = "N/A"
                    baths = "N/A"
                    sqft = "N/A"
                    for cl in context_lines:
                        if re.search(re.escape(request.location.split(',')[0]), cl, re.IGNORECASE) and not address:
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
        timer.cancel()
        try:
            context.close()
        except Exception:
            pass
    return ZillowSearchResult(
        location=request.location,
        listings=[ZillowListing(address=l['address'], price=l['price'], beds=l['beds'], baths=l['baths'], sqft=l['sqft']) for l in listings],
    )


def test_zillow_homes():
    from playwright.sync_api import sync_playwright
    request = ZillowSearchRequest(
        location="Bellevue, WA",
        min_price=500000,
        max_price=1000000,
        min_beds=3,
        max_results=5,
    )
    with sync_playwright() as pl:
        result = search_zillow_homes(pl, request)
    print(f"\nLocation: {result.location}")
    print(f"Total listings: {len(result.listings)}")
    for i, l in enumerate(result.listings, 1):
        print(f"  {i}. {l.address}  {l.price}  {l.beds}bd/{l.baths}ba  {l.sqft} sqft")


if __name__ == "__main__":
    test_zillow_homes()
