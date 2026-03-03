import os, sys, shutil
from datetime import date, timedelta
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

with sync_playwright() as pw:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("united_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = pw.chromium.connect_over_cdp(ws_url)
    ctx = browser.contexts[0]
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    try:
        depart = date.today() + timedelta(days=60)
        ret = depart + timedelta(days=3)
        d_str = depart.strftime("%Y-%m-%d")
        r_str = ret.strftime("%Y-%m-%d")
        url = (
            f"https://www.united.com/en/us/fsr/choose-flights?"
            f"f=SFO&t=EWR&d={d_str}&r={r_str}&cb=0&px=1&taxng=1&newHP=True&clm=7&st=bestmatches&tqp=R"
        )
        print(f"URL: {url}")
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(15000)

        # Dismiss popups
        for sel in ["button:has-text('Accept')", "#onetrust-accept-btn-handler",
                     "button:has-text('No thanks')", "[aria-label='Close']"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except: pass

        print(f"Final URL: {page.url}")
        print(f"Title: {page.title()}")

        body = page.inner_text("body")
        lines = [l.strip() for l in body.splitlines() if l.strip()]
        print(f"Body lines: {len(lines)}")
        for i, ln in enumerate(lines[:120]):
            print(f"  [{i}] {ln[:140]}")
    finally:
        browser.close()
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)
