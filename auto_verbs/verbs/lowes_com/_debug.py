"""Debug: inspect Lowe's search page structure."""
import os, sys, tempfile, shutil
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, launch_chrome, wait_for_cdp_ws

with sync_playwright() as p:
    port = get_free_port()
    profile_dir = tempfile.mkdtemp(prefix="lowes_dbg_")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = p.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    try:
        page.goto("https://www.lowes.com/search?searchTerm=refrigerator",
                   wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(8000)
        
        # Check current URL
        print(f"Current URL: {page.url}")
        
        # Dismiss popups
        for sel in ["button:has-text('Accept')", "button:has-text('Close')", "[aria-label='Close']"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=500):
                    loc.evaluate("el => el.click()")
            except:
                pass
        
        page.wait_for_timeout(3000)
        
        try:
            for _ in range(3):
                page.evaluate("window.scrollBy(0, 800)")
                page.wait_for_timeout(800)
        except:
            print("Scroll failed, continuing...")
        
        # Try various selectors
        test_sels = [
            "[data-selector='prd-card']",
            "[class*='ProductCard']", 
            "[class*='product-card']",
            ".ntrn-product-card",
            "[data-testid*='product']",
            "[class*='tile']",
            "[class*='Tile']",
            "[class*='result']",
            "[role='listitem']",
            ".plp-card",
            "[class*='Card']",
            "[data-testid*='card']",
        ]
        for sel in test_sels:
            count = page.locator(sel).count()
            if count > 0:
                txt_preview = page.locator(sel).first.inner_text(timeout=2000)[:150]
                print(f"  {sel}: {count} matches — preview: {txt_preview!r}")
            else:
                print(f"  {sel}: 0")
        
        # Print a sample of body text
        body = page.inner_text("body")
        lines = [l.strip() for l in body.splitlines() if l.strip()]
        print(f"\n=== Body text ({len(lines)} lines), ALL ===")
        for i, ln in enumerate(lines, 1):
            print(f"  L{i}: {ln[:200]}")
        
        # Also check page HTML length
        html = page.content()
        print(f"\nHTML length: {len(html)}")
        print(f"HTML preview (first 1000 chars): {html[:1000]}")

    finally:
        browser.close()
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)
