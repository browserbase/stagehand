"""
Auto-generated Playwright script (Python)  —  concretized v2
Uber - Ride Price Estimate
Pickup:  Seattle-Tacoma International Airport
Dropoff: Downtown Seattle

Uses Playwright persistent context with real Chrome Default profile.
IMPORTANT: Close ALL Chrome windows before running!
"""

import re, json, os, shutil, traceback
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws
from playwright.sync_api import sync_playwright
from dataclasses import dataclass



def get_chrome_default_profile() -> str:
    """Get the Chrome Default profile path (not User Data, but Default subfolder)."""
    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default",
    )
    if os.path.isdir(user_data_dir):
        return user_data_dir
    raise FileNotFoundError("Could not find Chrome Default profile")



@dataclass(frozen=True)
class UberRideSearchRequest:
    pickup: str = "Seattle-Tacoma International Airport"
    dropoff: str = "Downtown Seattle"
    max_results: int = 5


@dataclass(frozen=True)
class UberRideEstimate:
    ride_type: str
    price_range: str


@dataclass(frozen=True)
class UberRideSearchResult:
    pickup: str
    dropoff: str
    estimates: list



def search_uber_rides(playwright, request: UberRideSearchRequest) -> UberRideSearchResult:
    print("=" * 59)
    print("  Uber - Ride Price Estimate")
    print("=" * 59)
    print(f"  Pickup:  {request.pickup}")
    print(f"  Dropoff: {request.dropoff}\n")

    port = get_free_port()
    profile_dir = get_temp_profile_dir("uber_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        print("Loading Uber price estimate page...")
        page.goto("https://www.uber.com/us/en/price-estimate/")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        
        # Check if redirected to login
        if "auth.uber.com" in page.url:
            print("\n  ⚠️  Redirected to login page!")
            print("  Please log in manually in the browser window...")
            print("  Waiting for login to complete (up to 2 minutes)...")
            try:
                page.wait_for_url("**/price-estimate/**", timeout=120000)
                print("  Login successful!")
                page.wait_for_timeout(3000)
            except PwTimeout:
                print("  Timeout waiting for login. Please run again after logging in.")
                return results
        
        print(f"  Loaded: {page.url}\n")

        # Dismiss popups / cookie banners
        for selector in [
            "button:has-text('Accept')",
            "button:has-text('Accept All Cookies')",
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

        # ── STEP 1: Enter pickup location ─────────────────────────────────
        print(f'STEP 1: Pickup = "{pickup}"...')
        pickup_input = page.locator('input[aria-label="Pickup location"]').first
        pickup_input.wait_for(state="visible", timeout=5000)
        pickup_input.click()
        page.wait_for_timeout(500)
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.wait_for_timeout(200)
        pickup_input.type(pickup, delay=50)
        page.wait_for_timeout(3000)

        # Select first autocomplete suggestion from pickup dropdown
        pickup_dd = page.locator('[aria-label="pickup location dropdown"] li[role="option"]').first
        pickup_dd.wait_for(state="visible", timeout=5000)
        pickup_dd.click()
        print("  Selected pickup suggestion")
        page.wait_for_timeout(2000)

        # ── STEP 2: Enter dropoff location ────────────────────────────────
        print(f'STEP 2: Dropoff = "{dropoff}"...')
        dropoff_input = page.locator('input[aria-label="Dropoff location"]').first
        dropoff_input.wait_for(state="visible", timeout=5000)
        dropoff_input.click()
        page.wait_for_timeout(500)
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.wait_for_timeout(200)
        dropoff_input.type(dropoff, delay=50)
        page.wait_for_timeout(3000)

        # Select autocomplete suggestion from destination dropdown
        dropoff_dd = page.locator('[aria-label="destination location dropdown"] li[role="option"]').first
        dropoff_dd.wait_for(state="visible", timeout=5000)
        dropoff_dd.click()
        print("  Selected dropoff suggestion")
        page.wait_for_timeout(2000)

        # ── STEP 3: Click "See prices" ────────────────────────────────────
        print("STEP 3: Get price estimate...")
        see_prices = page.locator('a[aria-label="See prices"]').first
        see_prices.wait_for(state="visible", timeout=5000)
        see_prices.click()
        print("  Clicked 'See prices'")
        page.wait_for_timeout(8000)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)
        print(f"  URL: {page.url}")

        # ── STEP 4: Extract price estimates ───────────────────────────────
        print(f"STEP 4: Extract ride prices...\n")

        # Scroll to load all ride options
        for _ in range(5):
            page.evaluate("window.scrollBy(0, 400)")
            page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        body_text = page.evaluate("document.body.innerText")
        lines = body_text.split("\n")

        # Known ride types to search for
        known_rides = [
            "UberX", "UberXL", "Comfort", "Comfort Electric",
            "Electric", "Pet", "UberXXL", "Black", "Black SUV", "WAV",
            "Green", "Share", "Pool", "Premier", "Connect",
        ]
        # Uber appends capacity digits to ride names in innerText,
        # e.g. "UberX4", "UberXL6", "Black SUV6", "WAV4".
        # Match ride type name followed by optional digits at end of string.
        for rt in known_rides:
            # Build regex: exact ride name + optional digits + end
            rt_pattern = re.compile(r"^" + re.escape(rt) + r"\d*$", re.IGNORECASE)
            for i, line in enumerate(lines):
                stripped = line.strip()
                if rt_pattern.match(stripped):
                    # Look nearby for price pattern
                    ctx = " ".join(lines[max(0, i-2):min(len(lines), i+8)])
                    # Try range like $23-$30
                    price_match = re.search(r"\$(\d+(?:\.\d{2})?)\s*[-\u2013]\s*\$(\d+(?:\.\d{2})?)", ctx)
                    if not price_match:
                        # Try single price like $25.50
                        price_match = re.search(r"\$(\d+(?:\.\d{2})?)", ctx)
                    if price_match:
                        if price_match.lastindex and price_match.lastindex == 2:
                            price_range = "$" + str(price_match.group(1)) + "-$" + str(price_match.group(2))
                        else:
                            price_range = "$" + str(price_match.group(1))
                        if not any(r["rideType"] == rt for r in results):
                            results.append({"rideType": rt, "priceRange": price_range})
                        break
                    # Check for non-price entries like "Local Rates"
                    if "local rate" in ctx.lower() or "unavailable" in ctx.lower():
                        if not any(r["rideType"] == rt for r in results):
                            results.append({"rideType": rt, "priceRange": "Local Rates"})
                        break

        print(f"Found {len(results)} ride estimates:")
        for r in results:
            print(f"  {r['rideType']}: {r['priceRange']}")

        # Highlight target ride types
        ride_types = ["UberX","UberXL"]
        print("\nTarget ride types:")
        for target in ride_types:
            match = next((r for r in results if r["rideType"].lower().replace(" ", "") == target.lower().replace(" ", "")), None)
            if match:
                print(f"  OK  {match['rideType']}: {match['priceRange']}")
            else:
                print(f"  MISS  {target}: not found")

    except Exception as e:
        print(f"\nError: {e}")
        traceback.print_exc()
    finally:
        try:
            browser.close()
        except Exception:
            pass
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)
    return UberRideSearchResult(
        pickup=request.pickup,
        dropoff=request.dropoff,
        estimates=[UberRideEstimate(ride_type=r['rideType'], price_range=r['priceRange']) for r in results],
    )



def test_uber_rides():
    from playwright.sync_api import sync_playwright
    request = UberRideSearchRequest(
        pickup="Seattle-Tacoma International Airport",
        dropoff="Downtown Seattle",
        max_results=5,
    )
    with sync_playwright() as pl:
        result = search_uber_rides(pl, request)
    print(f"\nTotal estimates: {len(result.estimates)}")
    for i, e in enumerate(result.estimates, 1):
        print(f"  {i}. {e.ride_type}  {e.price_range}")


if __name__ == "__main__":
    test_uber_rides()
