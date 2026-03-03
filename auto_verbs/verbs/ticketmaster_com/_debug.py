import os, sys, shutil, tempfile
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

with sync_playwright() as pw:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("ticketmaster_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = pw.chromium.connect_over_cdp(ws_url)
    ctx = browser.contexts[0]
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    try:
        page.goto("https://www.ticketmaster.com/search?q=concerts+in+los+angeles",
                   wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(6000)

        for sel in ["button:has-text('Accept')", "#onetrust-accept-btn-handler"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except:
                pass

        for _ in range(4):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(600)

        # Show first 5 event links
        links = page.locator("a[href*='/event/']").all()
        print(f"Found {len(links)} event links")
        for i, link in enumerate(links[:8]):
            text = link.inner_text(timeout=2000).strip()
            href = link.get_attribute("href") or ""
            parent_text = ""
            try:
                parent_text = link.locator("..").inner_text(timeout=2000).strip()[:200]
            except:
                pass
            print(f"\n--- Link {i} ---")
            print(f"Text: {repr(text[:200])}")
            print(f"Href: {href[:100]}")
            print(f"Parent: {repr(parent_text[:200])}")

        # Also dump raw body lines in the results area
        body = page.inner_text("body")
        lines = [l.strip() for l in body.splitlines() if l.strip()]
        print("\n\n=== BODY TEXT (lines 50-120) ===")
        for i, ln in enumerate(lines[50:120], 50):
            print(f"  [{i}] {ln[:120]}")
    finally:
        browser.close()
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)
