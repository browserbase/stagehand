import os, sys, shutil
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

with sync_playwright() as pw:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("trulia_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = pw.chromium.connect_over_cdp(ws_url)
    ctx = browser.contexts[0]
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    try:
        page.goto("https://www.trulia.com/for_rent/San_Jose,CA/2p_beds/",
                   wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(6000)

        for sel in ["button:has-text('Accept')", "#onetrust-accept-btn-handler",
                     "[aria-label='Close']"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except: pass

        for _ in range(3):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(600)

        # Try PropertyCard
        cards = page.locator("[class*='PropertyCard']").all()
        print(f"PropertyCard count: {len(cards)}")
        for i, card in enumerate(cards[:5]):
            text = card.inner_text(timeout=2000).strip()
            print(f"\n--- Card {i} ---")
            lines = text.splitlines()
            for j, ln in enumerate(lines[:10]):
                print(f"  [{j}] {ln.strip()[:100]}")

        # Also show body text excerpt
        body = page.inner_text("body")
        lines = [l.strip() for l in body.splitlines() if l.strip()]
        print(f"\n\n=== BODY LINES (near listings) ===")
        # Find lines with $ amounts
        for i, ln in enumerate(lines):
            if "$" in ln and i < 200:
                print(f"  [{i}] {ln[:120]}")
                if i + 1 < len(lines):
                    print(f"  [{i+1}] {lines[i+1][:120]}")
                if i + 2 < len(lines):
                    print(f"  [{i+2}] {lines[i+2][:120]}")
                print()
    finally:
        browser.close()
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)
