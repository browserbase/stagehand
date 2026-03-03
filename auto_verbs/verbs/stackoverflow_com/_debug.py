"""Debug: inspect StackOverflow search results page."""
import re, os, sys, shutil, tempfile
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, launch_chrome, wait_for_cdp_ws

with sync_playwright() as pw:
    port = get_free_port()
    profile = tempfile.mkdtemp(prefix="so_debug_")
    proc = launch_chrome(profile, port)
    ws = wait_for_cdp_ws(port)
    browser = pw.chromium.connect_over_cdp(ws)
    ctx = browser.contexts[0]
    page = ctx.pages[0] if ctx.pages else ctx.new_page()

    url = "https://stackoverflow.com/search?q=how+to+parse+JSON+in+Python&s=votes"
    print(f"URL: {url}\n")
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(5000)

    # Dismiss cookie
    for sel in ["button:has-text('Accept all cookies')", "button:has-text('Accept')"]:
        try:
            loc = page.locator(sel).first
            if loc.is_visible(timeout=800):
                loc.evaluate("el => el.click()")
                page.wait_for_timeout(500)
        except Exception:
            pass

    # Check selectors
    for sel in [
        ".s-post-summary--content",
        ".s-post-summary",
        ".search-result",
        ".question-hyperlink",
        "a.s-link",
        "[data-searchsession]",
        ".js-search-results",
        "h3 a",
        ".result-link",
    ]:
        count = page.locator(sel).count()
        if count > 0:
            print(f"SELECTOR '{sel}' → {count} matches")
            try:
                txt = page.locator(sel).first.inner_text(timeout=2000)
                print(f"  FIRST: {txt[:200]}\n")
            except Exception as e:
                print(f"  (error: {e})\n")

    body = page.inner_text("body")
    lines = body.splitlines()
    print(f"\n=== BODY TEXT ({len(lines)} lines) ===")
    for i, line in enumerate(lines[:80]):
        l = line.strip()
        if l:
            print(f"L{i:3d}: {l[:140]}")

    print(f"\nFinal URL: {page.url}")
    browser.close()
    proc.terminate()
    shutil.rmtree(profile, ignore_errors=True)
