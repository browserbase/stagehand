import os, sys, shutil, tempfile
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

with sync_playwright() as pw:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("maps_google_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = pw.chromium.connect_over_cdp(ws_url)
    ctx = browser.contexts[0]
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    try:
        page.goto("https://www.google.com/maps/dir/Space+Needle,+Seattle,+WA/Pike+Place+Market,+Seattle,+WA/",
                   wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(8000)

        for sel in ["button:has-text('Accept')", "button:has-text('OK')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except: pass

        # Click driving mode
        try:
            btn = page.locator("[data-travel_mode='0'], [aria-label*='Driving']").first
            if btn.is_visible(timeout=2000):
                btn.evaluate("el => el.click()")
                page.wait_for_timeout(3000)
        except: pass

        body = page.inner_text("body")
        lines = [l.strip() for l in body.splitlines() if l.strip()]
        print(f"Total lines: {len(lines)}")
        # Find lines around "via" or trip details
        for i, ln in enumerate(lines):
            if any(kw in ln.lower() for kw in ["via", "min", "mile", "step", "head ", "turn ", "keep "]):
                print(f"  [{i}] {ln[:120]}")
    finally:
        browser.close()
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)
