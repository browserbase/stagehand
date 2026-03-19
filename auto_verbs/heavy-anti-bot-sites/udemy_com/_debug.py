"""Debug: inspect Udemy search page structure."""
import os, sys, tempfile, shutil, re
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, launch_chrome, wait_for_cdp_ws

with sync_playwright() as p:
    port = get_free_port()
    profile_dir = tempfile.mkdtemp(prefix="udemy_dbg_")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = p.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    try:
        page.goto("https://www.udemy.com/topic/python/",
                   wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(8000)

        # Dismiss popups
        for sel in ["button:has-text('Accept')", "button:has-text('Dismiss')", "[aria-label='Close']"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=500):
                    loc.evaluate("el => el.click()")
            except:
                pass

        for _ in range(3):
            try:
                page.evaluate("window.scrollBy(0, 600)")
                page.wait_for_timeout(600)
            except:
                pass

        print(f"URL: {page.url}")

        # Try selectors
        test_sels = [
            "[data-purpose='search-course-card']",
            "[class*='course-card']",
            "[class*='CourseCard']",
            "[data-testid*='course']",
            "[class*='course-list']",
            "[class*='search-result']",
            "[role='listitem']",
            "h3",
            "[data-purpose*='course']",
            "a[href*='/course/']",
        ]
        for sel in test_sels:
            count = page.locator(sel).count()
            if count > 0:
                txt = page.locator(sel).first.inner_text(timeout=2000)[:100]
                print(f"  {sel}: {count} — preview: {txt!r}")
            else:
                print(f"  {sel}: 0")

        # Body text sample
        body = page.inner_text("body")
        lines = [l.strip() for l in body.splitlines() if l.strip()]
        print(f"\n=== Body ({len(lines)} lines), lines 80–160 ===")
        for i, ln in enumerate(lines[80:160], 81):
            print(f"  L{i}: {ln[:140]}")

    finally:
        browser.close()
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)
