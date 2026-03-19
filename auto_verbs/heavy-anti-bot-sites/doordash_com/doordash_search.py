"""
DoorDash – Pizza Restaurants in Redmond, WA
Generated: 2026-02-28T22:57:09.763Z
Pure Playwright – no AI.
"""
from datetime import date, timedelta
import re, time, os, traceback, sys, threading
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dataclasses import dataclass




def dismiss_login_modal(page):
    """Try to close any login/signup modal or overlay."""
    close_selectors = [
        'button[aria-label="Close"]', 'button[aria-label="close"]',
        '[data-testid="close-btn"]', '[data-testid="CloseButton"]',
        'button.close', 'button.modal-close', '.modal-close-btn',
        'button:has-text("Close")', 'button:has-text("Not now")',
        'button:has-text("Maybe later")', 'button:has-text("Skip")',
        'a:has-text("Browse as guest")', 'a:has-text("Continue as guest")',
    ]
    for attempt in range(3):
        body = page.locator("body").inner_text(timeout=5000)
        if not re.search(r"sign\s*in|log\s*in|create.*account|sign\s*up", body, re.IGNORECASE):
            print("  No login modal detected.")
            return True
        print(f"  Login modal detected (attempt {attempt + 1}/3), trying to dismiss...")
        # Press Escape
        page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
        page.wait_for_timeout(1000)
        # Try close/dismiss selectors
        for sel in close_selectors:
            try:
                el = page.locator(sel).first
                if el.is_visible(timeout=500):
                    el.evaluate("el => el.click()")
                    print(f"  Clicked: {sel}")
                    page.wait_for_timeout(1500)
                    break
            except Exception:
                pass
        # Click outside modal
        page.evaluate("(function(){ var e = document.elementFromPoint(10,10); if(e) e.click(); })()")
        page.wait_for_timeout(1000)
    # Final check – page may still have sign-in text but also show restaurants
    body2 = page.locator("body").inner_text(timeout=5000)
    blocked = bool(re.search(r"sign\s*in|log\s*in", body2, re.IGNORECASE)) and not re.search(r"restaurant|deliver|search|pizza", body2, re.IGNORECASE)
    if blocked:
        print("  Could not dismiss login modal.")
        return False
    print("  Login modal dismissed or page accessible.")
    return True


def set_address(page, address):
    """Enter the delivery address on the DoorDash homepage."""
    addr_selectors = [
        "input[data-anchor-id='AddressAutocompleteField']",
        "input[placeholder*='address' i]",
        "input[placeholder*='delivery' i]",
        "input[aria-label*='address' i]",
        "input[id*='address' i]",
    ]
    suggestion_selectors = [
        "[data-anchor-id='AddressSuggestion']",
        "li[role='option']",
        ".address-suggestion",
        "[data-testid*='AddressSuggestion']",
        "ul[role='listbox'] li",
    ]
    for sel in addr_selectors:
        try:
            inp = page.locator(sel).first
            if inp.is_visible(timeout=2000):
                inp.evaluate("el => el.click()")
                page.wait_for_timeout(500)
                inp.fill("", timeout=1000)      # clear first
                inp.type(address, delay=50)      # type char-by-char for autocomplete
                page.wait_for_timeout(2500)
                # Click first suggestion
                for sug_sel in suggestion_selectors:
                    try:
                        sug = page.locator(sug_sel).first
                        if sug.is_visible(timeout=2000):
                            sug.evaluate("el => el.click()")
                            page.wait_for_timeout(3000)
                            print(f"  Address set: {address}")
                            return True
                    except Exception:
                        pass
                # If no suggestion dropdown, press Enter
                inp.press("Enter")
                page.wait_for_timeout(3000)
                print(f"  Address entered (no suggestion clicked): {address}")
                return True
        except Exception:
            pass
    print("  Could not find address input.")
    return False


def search_pizza(page, query):
    """Search for pizza on DoorDash by navigating directly to the search URL."""
    print(f"  Navigating to search results for: {query}")
    page.goto(f"https://www.doordash.com/search/store/{query}/?pickup=false",
              wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(5000)
    return True


def extract_restaurants(page, max_count=5):
    """Extract restaurant info from the search results page."""
    restaurants = []

    # Common food categories to skip (these are nav links, not restaurants)
    SKIP_WORDS = {"pizza", "indian", "chinese", "mexican", "thai", "japanese",
                  "italian", "burgers", "sushi", "sandwiches", "fast food",
                  "desserts", "breakfast", "healthy", "asian", "american",
                  "seafood", "wings", "vegan", "korean", "mediterranean",
                  "salads", "soup", "bubble tea", "coffee", "alcohol",
                  "grocery", "convenience", "pets", "flowers", "retail"}

    def is_category(name):
        return name.lower().strip() in SKIP_WORDS

    # Try structured store card selectors (most specific first)
    card_selectors = [
        "[data-testid='StoreCard']",
        "[data-anchor-id='StoreCard']",
        "[class*='StoreCard']",
        "div[class*='store-card']",
    ]
    for card_sel in card_selectors:
        cards = page.locator(card_sel)
        count = cards.count()
        if count == 0:
            continue
        for i in range(min(count, max_count * 2)):  # scan extra to skip bad cards
            if len(restaurants) >= max_count:
                break
            try:
                card = cards.nth(i)
                txt = card.inner_text(timeout=2000)
                lines = [l.strip() for l in txt.split("\n") if l.strip()]
                if not lines or is_category(lines[0]):
                    continue
                name = lines[0][:60]
                rating = "N/A"
                fee = "N/A"
                est = "N/A"
                for ln in lines[1:]:
                    if re.search(r"\d+\.\d", ln) and len(ln) < 10 and "mi" not in ln.lower():
                        rating = ln[:20]
                    if "$" in ln or "fee" in ln.lower() or "free" in ln.lower():
                        fee = ln[:40]
                    if re.search(r"\d+\s*min", ln, re.IGNORECASE):
                        est = ln[:30]
                restaurants.append({"name": name, "rating": rating, "delivery_fee": fee, "est_time": est})
            except Exception:
                pass
        if restaurants:
            return restaurants

    # Try a[href*='/store/'] but require multi-line content (skip category links)
    store_links = page.locator("a[href*='/store/']")
    link_count = store_links.count()
    for i in range(min(link_count, max_count * 5)):  # scan more to find enough
        if len(restaurants) >= max_count:
            break
        try:
            link = store_links.nth(i)
            txt = link.inner_text(timeout=1500)
            lines = [l.strip() for l in txt.split("\n") if l.strip()]
            if len(lines) < 2 or is_category(lines[0]):
                continue  # skip category / nav links
            name = lines[0][:60]
            full = " ".join(lines)
            # Must have delivery-like info (min, fee, rating, $) to be a restaurant
            if not re.search(r"min|fee|\$|delivery|\d+\.\d", full, re.IGNORECASE):
                continue
            rating = "N/A"
            fee = "N/A"
            est = "N/A"
            for ln in lines[1:]:
                if re.search(r"\d+\.\d", ln) and len(ln) < 10 and "mi" not in ln.lower():
                    rating = ln[:20]
                if "$" in ln or "fee" in ln.lower() or "free" in ln.lower():
                    fee = ln[:40]
                if re.search(r"\d+\s*min", ln, re.IGNORECASE):
                    est = ln[:30]
            restaurants.append({"name": name, "rating": rating, "delivery_fee": fee, "est_time": est})
        except Exception:
            pass
    if restaurants:
        return restaurants

    # Fallback: parse body text for restaurant-like blocks
    body = page.locator("body").inner_text(timeout=10000)
    lines = [l.strip() for l in body.split("\n") if l.strip()]
    i = 0
    while i < len(lines) and len(restaurants) < max_count:
        line = lines[i]
        if (len(line) > 3 and len(line) < 80
            and not is_category(line)
            and not re.search(r"sign\s*in|log\s*in|password|email|home|account", line, re.IGNORECASE)):
            nearby = " ".join(lines[i:i+5])
            if re.search(r"\d+\s*min", nearby, re.IGNORECASE) and re.search(r"\$|fee|delivery|free", nearby, re.IGNORECASE):
                r = {"name": line, "rating": "N/A", "delivery_fee": "N/A", "est_time": "N/A"}
                for j in range(i+1, min(i+5, len(lines))):
                    nl = lines[j]
                    if re.search(r"\d+\.\d", nl) and len(nl) < 10 and "mi" not in nl.lower():
                        r["rating"] = nl[:20]
                    if "$" in nl or "fee" in nl.lower() or "free delivery" in nl.lower():
                        r["delivery_fee"] = nl[:40]
                    if re.search(r"\d+\s*min", nl, re.IGNORECASE):
                        r["est_time"] = nl[:30]
                restaurants.append(r)
                i += 4  # skip lines we already consumed
        i += 1
    return restaurants


@dataclass(frozen=True)
class DoorDashSearchRequest:
    address: str
    query: str
    max_results: int


@dataclass(frozen=True)
class DoorDashRestaurant:
    name: str
    rating: str
    delivery_fee: str
    est_time: str


@dataclass(frozen=True)
class DoorDashSearchResult:
    address: str
    query: str
    restaurants: list[DoorDashRestaurant]


# Searches DoorDash for restaurants matching a query near an address,
# returning up to max_results results with name, rating, delivery fee, and time.
def search_doordash_restaurants(
    playwright,
    request: DoorDashSearchRequest,
) -> DoorDashSearchResult:
    ADDRESS = request.address
    QUERY = request.query
    MAX_RESULTS = request.max_results
    raw_results = []
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
    raw_results = []

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
        # STEP 1: Go to homepage first (avoids some anti-bot redirects)
        print("STEP 1: Navigate to DoorDash homepage...")
        page.goto("https://www.doordash.com/", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(4000)

        # Dismiss login modal if present
        login_ok = dismiss_login_modal(page)
        if not login_ok:
            print("  Trying direct search URL as fallback...")
            page.goto("https://www.doordash.com/search/store/pizza/?pickup=false",
                       wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(4000)
            dismiss_login_modal(page)

        # STEP 2: Set delivery address
        print("STEP 2: Set delivery address...")
        set_address(page, ADDRESS)

        # STEP 3: Search for pizza
        print("STEP 3: Search for pizza...")
        search_pizza(page, QUERY)

        # Scroll to load more results
        # Scroll more aggressively to load lazy content
        for _ in range(8):
            page.evaluate("window.scrollBy(0, 800)")
            page.wait_for_timeout(1000)
        # Scroll back to top so all cards are rendered
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1500)

        # STEP 4: Extract raw_results
        print("STEP 4: Extract restaurant data...")
        raw_results = extract_restaurants(page)

        if not raw_results:
            print("  Extraction found no raw_results.")

        print(f"\nDONE – Top {len(raw_results)} Pizza Restaurants:")
        for i, r in enumerate(raw_results, 1):
            print(f"  {i}. {r.get('name', 'N/A')} | rating {r.get('rating', 'N/A')} | Fee: {r.get('delivery_fee', 'N/A')} | {r.get('est_time', 'N/A')}")

    except Exception as e:
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        timer.cancel()
        try:
            context.close()
        except Exception:
            pass
    return DoorDashSearchResult(
        address=request.address,
        query=request.query,
        restaurants=[DoorDashRestaurant(
            name=r.get("name",""),
            rating=r.get("rating",""),
            delivery_fee=r.get("delivery_fee",""),
            est_time=r.get("est_time",""),
        ) for r in raw_results],
    )
def test_search_doordash_restaurants() -> None:
    from playwright.sync_api import sync_playwright
    request = DoorDashSearchRequest(address="Redmond, WA 98052", query="pizza", max_results=5)
    with sync_playwright() as playwright:
        result = search_doordash_restaurants(playwright, request)
    assert result.address == request.address
    assert len(result.restaurants) <= request.max_results
    print(f"\nTotal restaurants found: {len(result.restaurants)}")


if __name__ == "__main__":
    test_search_doordash_restaurants()
