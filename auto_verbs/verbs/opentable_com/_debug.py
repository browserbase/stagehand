"""Debug: inspect OpenTable search results page structure."""
import re, os, sys, shutil, tempfile
from datetime import date, timedelta
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

dt = date.today() + timedelta(days=60)
d_str = dt.strftime("%Y-%m-%d")
url = f"https://www.opentable.com/s?dateTime={d_str}T19%3A00%3A00&covers=2&metroId=4&regionIds=232&term=Seattle"

with sync_playwright() as pw:
    port = get_free_port()
    profile = tempfile.mkdtemp(prefix="ot_debug_")
    proc = launch_chrome(profile, port)
    ws = wait_for_cdp_ws(port)
    browser = pw.chromium.connect_over_cdp(ws)
    ctx = browser.contexts[0]
    page = ctx.pages[0] if ctx.pages else ctx.new_page()

    print(f"URL: {url}\n")
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(8000)

    # dismiss popups
    for sel in ["button:has-text('Accept')", "button:has-text('Got it')", "[aria-label='Close']"]:
        try:
            loc = page.locator(sel).first
            if loc.is_visible(timeout=800):
                loc.evaluate("el => el.click()")
        except Exception:
            pass

    for _ in range(5):
        page.evaluate("window.scrollBy(0, 500)")
        page.wait_for_timeout(600)

    # Check known selectors
    for sel in [
        "[data-test='restaurant-card']",
        ".restaurant-card",
        ".resultsListItem",
        "[data-test='search-result']",
        "[class*='RestaurantCard']",
        "[class*='restaurant']",
        "[class*='listing']",
        "section[data-test]",
    ]:
        count = page.locator(sel).count()
        if count > 0:
            print(f"SELECTOR '{sel}' → {count} matches")
            # print first card text
            try:
                txt = page.locator(sel).first.inner_text(timeout=3000)
                print(f"  FIRST CARD TEXT:\n{txt[:500]}\n")
            except Exception as e:
                print(f"  (error reading text: {e})\n")

    # Dump body text lines 
    body = page.inner_text("body")
    lines = body.splitlines()
    print(f"\n=== BODY TEXT ({len(lines)} lines) ===")
    for i, line in enumerate(lines):
        l = line.strip()
        if l:
            print(f"L{i:3d}: {l[:120]}")
    
    # Also check page URL after load
    print(f"\nFinal URL: {page.url}")

    browser.close()
    proc.terminate()
    shutil.rmtree(profile, ignore_errors=True)
