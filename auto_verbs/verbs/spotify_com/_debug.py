"""Debug: inspect Spotify search results page structure."""
import re, os, sys, shutil, tempfile
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, launch_chrome, wait_for_cdp_ws

with sync_playwright() as pw:
    port = get_free_port()
    profile = tempfile.mkdtemp(prefix="spotify_debug_")
    proc = launch_chrome(profile, port)
    ws = wait_for_cdp_ws(port)
    browser = pw.chromium.connect_over_cdp(ws)
    ctx = browser.contexts[0]
    page = ctx.pages[0] if ctx.pages else ctx.new_page()

    url = "https://open.spotify.com/search/jazz%20playlist"
    print(f"URL: {url}\n")
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(8000)

    # dismiss cookie banner
    for sel in ["button:has-text('Accept')", "#onetrust-accept-btn-handler", "button:has-text('OK')"]:
        try:
            loc = page.locator(sel).first
            if loc.is_visible(timeout=800):
                loc.evaluate("el => el.click()")
                page.wait_for_timeout(500)
        except Exception:
            pass

    # Try clicking Playlists tab
    try:
        pl_tab = page.locator("button:has-text('Playlists'), a:has-text('Playlists')").first
        if pl_tab.is_visible(timeout=2000):
            pl_tab.evaluate("el => el.click()")
            page.wait_for_timeout(3000)
            print("Clicked 'Playlists' tab")
    except Exception:
        print("No 'Playlists' tab found")

    for _ in range(5):
        page.evaluate("window.scrollBy(0, 500)")
        page.wait_for_timeout(600)

    # Check known selectors
    for sel in [
        "[data-testid='card']",
        "[data-testid='search-category-card']",
        "[data-testid='tracklist-row']",
        ".Card",
        ".contentSpacing",
        "[class*='CardButton']",
        "section",
        "[role='listitem']",
        "[role='grid']",
        "[role='row']",
        "a[href*='/playlist/']",
    ]:
        count = page.locator(sel).count()
        if count > 0:
            print(f"SELECTOR '{sel}' → {count} matches")
            try:
                txt = page.locator(sel).first.inner_text(timeout=3000)
                print(f"  FIRST TEXT:\n{txt[:300]}\n")
            except Exception as e:
                print(f"  (error: {e})\n")

    # Dump body text
    body = page.inner_text("body")
    lines = body.splitlines()
    print(f"\n=== BODY TEXT ({len(lines)} lines) ===")
    for i, line in enumerate(lines):
        l = line.strip()
        if l:
            print(f"L{i:3d}: {l[:140]}")

    print(f"\nFinal URL: {page.url}")

    browser.close()
    proc.terminate()
    shutil.rmtree(profile, ignore_errors=True)
