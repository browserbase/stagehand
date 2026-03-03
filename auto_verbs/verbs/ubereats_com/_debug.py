import os, sys, shutil
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

with sync_playwright() as pw:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("ubereats_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = pw.chromium.connect_over_cdp(ws_url)
    ctx = browser.contexts[0]
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    try:
        page.goto("https://www.ubereats.com/search?q=sushi",
                   wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(8000)

        print(f"URL: {page.url}")
        print(f"Title: {page.title()}")
        html = page.content()
        print(f"HTML length: {len(html)}")

        body = page.inner_text("body")
        lines = [l.strip() for l in body.splitlines() if l.strip()]
        print(f"Body lines: {len(lines)}")
        for i, ln in enumerate(lines[:100]):
            print(f"  [{i}] {ln[:140]}")
    finally:
        browser.close()
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)
