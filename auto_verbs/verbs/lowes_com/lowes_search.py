"""
Lowe's – Search "refrigerator" → extract top 5 products with name, price, rating.
Pure Playwright – no AI.
"""
import re, os, sys, traceback, shutil, tempfile
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

MAX_RESULTS = 5


def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("lowes_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    products = []
    try:
        # Navigate to main page first (avoid direct search URL block)
        print("STEP 1: Navigate to Lowe's homepage...")
        page.goto("https://www.lowes.com", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(6000)

        # Dismiss popups
        for sel in ["button:has-text('Accept')", "button:has-text('Close')",
                     "[aria-label='Close']", "button:has-text('No Thanks')",
                     "#emailSignUpCloseBtn", "button:has-text('Maybe Later')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # Check if homepage loaded
        try:
            body_check = page.inner_text("body", timeout=3000)[:200]
            if "Access Denied" in body_check:
                print("   ⚠ Homepage blocked. Lowe's bot detection is active.")
                print("❌ ERROR: Cannot access Lowe's due to bot detection.")
                return products
        except Exception:
            pass

        print("STEP 2: Search for 'refrigerator'...")
        # Find search box and type
        search_box = None
        for sel in ["input#search", "input[name='searchTerm']", "input[type='search']",
                     "input[placeholder*='Search']", "input[aria-label*='Search']",
                     "input[aria-label*='search']", "#headerSearch"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=1500):
                    search_box = loc
                    break
            except Exception:
                continue

        if search_box:
            search_box.evaluate("el => el.click()")
            page.wait_for_timeout(500)
            search_box.fill("refrigerator")
            page.wait_for_timeout(500)
            search_box.press("Enter")
            page.wait_for_load_state("domcontentloaded")
            page.wait_for_timeout(8000)
        else:
            print("   Could not find search box, trying direct category URL...")
            page.goto("https://www.lowes.com/pl/Refrigerators/4294857981",
                       wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(8000)

        # Scroll to load results
        for _ in range(4):
            try:
                page.evaluate("window.scrollBy(0, 800)")
                page.wait_for_timeout(800)
            except Exception:
                pass

        print(f"   Current URL: {page.url}")

        # Check for bot block
        try:
            body_preview = page.inner_text("body", timeout=3000)[:200]
            if "Access Denied" in body_preview:
                print("   ⚠ Page returned 'Access Denied' — Lowe's bot detection triggered.")
                print("   Retrying after wait...")
                page.wait_for_timeout(5000)
                page.reload(wait_until="domcontentloaded")
                page.wait_for_timeout(8000)
        except Exception:
            pass

        print("STEP 3: Extract products...")

        # Strategy 1: product cards
        seen = set()
        card_selectors = [
            "[data-selector='prd-card']",
            "[class*='ProductCard']",
            "[class*='product-card']",
            ".ntrn-product-card",
            "[data-testid*='product']",
        ]
        cards = []
        for sel in card_selectors:
            cards = page.locator(sel).all()
            if cards:
                print(f"   Found {len(cards)} product cards with selector '{sel}'")
                break

        for card in cards:
            if len(products) >= MAX_RESULTS:
                break
            try:
                text = card.inner_text(timeout=2000).strip()
                lines = [l.strip() for l in text.split("\n") if l.strip()]
                name = ""
                price = ""
                rating = ""

                for ln in lines:
                    # Price pattern: "$1,299.00" or "$599"
                    if re.search(r'\$[\d,]+\.?\d*', ln) and not price:
                        price = re.search(r'(\$[\d,]+\.?\d*)', ln).group(1)
                    # Rating pattern: "4.5 out of 5 stars" or "4.5"
                    rm = re.search(r'(\d+\.?\d*)\s*(?:out of|/)\s*5', ln)
                    if rm and not rating:
                        rating = rm.group(1) + "/5"
                    # Star rating without "out of"
                    if not rating and re.match(r'^\d\.\d$', ln):
                        rating = ln + "/5"
                    # "Rated X.X out of Y stars" in text
                    rm2 = re.search(r'[Rr]ated?\s+(\d+\.?\d*)', ln)
                    if rm2 and not rating:
                        rating = rm2.group(1) + "/5"

                # Also try aria-label for rating
                if not rating:
                    try:
                        star_el = card.locator("[aria-label*='star']").first
                        if star_el.count() > 0:
                            aria = star_el.get_attribute("aria-label", timeout=1000) or ""
                            rm3 = re.search(r'(\d+\.?\d*)', aria)
                            if rm3:
                                rating = rm3.group(1) + "/5"
                    except Exception:
                        pass

                # Name is usually the longest line that isn't price/rating/badge
                for ln in lines:
                    if (len(ln) > 20 and "$" not in ln and "star" not in ln.lower()
                            and "bought" not in ln.lower() and "free" not in ln.lower()
                            and "delivery" not in ln.lower() and "compare" not in ln.lower()
                            and "model" not in ln.lower().split(":")[0]
                            and not re.match(r'^\d+\+?\s+bought', ln)):
                        name = ln
                        break

                if name and name.lower() not in seen:
                    seen.add(name.lower())
                    products.append({
                        "name": name,
                        "price": price or "N/A",
                        "rating": rating or "N/A",
                    })
            except Exception:
                continue

        # Strategy 2: body text fallback
        if not products:
            print("   Strategy 1 found 0 — trying body text...")
            body = page.inner_text("body")
            lines = [l.strip() for l in body.splitlines() if l.strip()]
            for i, ln in enumerate(lines):
                if len(products) >= MAX_RESULTS:
                    break
                # Look for price on a line
                pm = re.search(r'\$[\d,]+\.?\d*', ln)
                if pm and len(ln) < 20:
                    # Previous non-empty line might be product name
                    for j in range(i - 1, max(i - 5, -1), -1):
                        if len(lines[j]) > 20 and "$" not in lines[j]:
                            name = lines[j]
                            key = name.lower()
                            if key not in seen:
                                seen.add(key)
                                products.append({
                                    "name": name,
                                    "price": pm.group(0),
                                    "rating": "N/A",
                                })
                            break

        if not products:
            print("❌ ERROR: Extraction failed — no products found from the page.")

        print(f"\nDONE – Top {len(products)} Lowe's Refrigerators:")
        for i, p in enumerate(products, 1):
            print(f"  {i}. {p['name']}")
            print(f"     Price: {p['price']}  |  Rating: {p['rating']}")

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
    return products


if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
