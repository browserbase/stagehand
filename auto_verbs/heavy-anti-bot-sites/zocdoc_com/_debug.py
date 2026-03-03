import os, sys, shutil
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

with sync_playwright() as pw:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("zocdoc_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = pw.chromium.connect_over_cdp(ws_url)
    ctx = browser.contexts[0]
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    try:
        page.goto("https://www.zocdoc.com/search?address=San%20Francisco%2C%20CA&dr_specialty=dentist&sort_type=highly_rated",
                   wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(12000)

        for sel in ["button:has-text('Accept')", "[aria-label='Close']"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except: pass

        print(f"URL: {page.url}")
        print(f"Title: {page.title()}")

        # Check for iframes
        frames = page.frames
        print(f"Frames: {len(frames)}")
        for i, f in enumerate(frames):
            print(f"  Frame[{i}]: url={f.url[:100]}")

        # Check HTML length
        html = page.content()
        print(f"HTML length: {len(html)}")
        # Print first 2000 chars of html to see structure
        print("--- HTML snippet (first 2000) ---")
        print(html[:2000])
        print("--- end snippet ---")

        body = page.inner_text("body")
        lines = [l.strip() for l in body.splitlines() if l.strip()]
        print(f"Body lines: {len(lines)}")
        for i, ln in enumerate(lines[:80]):
            print(f"  [{i}] {ln[:120]}")

        if len(lines) == 0:
            # Try evaluate
            txt = page.evaluate("document.body?.innerText || 'EMPTY'")
            print(f"JS innerText length: {len(txt)}")
            print(txt[:500])
    finally:
        browser.close()
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)
