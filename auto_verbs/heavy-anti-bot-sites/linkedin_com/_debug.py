import os, sys, shutil
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

with sync_playwright() as pw:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("linkedin_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = pw.chromium.connect_over_cdp(ws_url)
    ctx = browser.contexts[0]
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    try:
        url = ("https://www.linkedin.com/jobs/search/?"
               "keywords=Software%20Engineer&location=Seattle%2C%20WA&f_TPR=r604800")
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(8000)

        for sel in ["button:has-text('Accept')", "button:has-text('Dismiss')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except: pass

        for _ in range(3):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(400)

        print(f"URL: {page.url}")

        # Check first 5 base-card elements
        cards = page.locator(".base-card").all()
        print(f"base-card elements: {len(cards)}")
        for ci, card in enumerate(cards[:5]):
            text = card.inner_text(timeout=2000).strip()
            lines = [l.strip() for l in text.splitlines() if l.strip()]
            print(f"\n--- Card {ci} ({len(lines)} lines) ---")
            for li, ln in enumerate(lines):
                print(f"  [{li}] {ln[:100]}")
    finally:
        browser.close()
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)
