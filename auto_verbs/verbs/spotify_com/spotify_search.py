"""
Spotify – Search for "jazz playlist"
Generated: 2026-02-28T18:49:46.024Z
Pure Playwright – no AI.
NOTE: Does not require Spotify login for public search results.
"""
import re, os, traceback, shutil, tempfile
from playwright.sync_api import Playwright, sync_playwright

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, launch_chrome, wait_for_cdp_ws

MAX_RESULTS = 5

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = tempfile.mkdtemp(prefix="spotify_")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    playlists = []
    try:
        print("STEP 1: Navigate to Spotify search...")
        page.goto("https://open.spotify.com/search/jazz%20playlist", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(8000)

        # dismiss cookie banner
        for sel in ["button:has-text('Accept')", "#onetrust-accept-btn-handler", "button:has-text('OK')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        # Click on "Playlists" tab if available
        try:
            pl_tab = page.locator("button:has-text('Playlists'), a:has-text('Playlists')").first
            if pl_tab.is_visible(timeout=2000):
                pl_tab.evaluate("el => el.click()")
                page.wait_for_timeout(3000)
        except Exception:
            pass

        for _ in range(5):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(600)

        print("STEP 2: Extract playlist data...")

        # ── Strategy 1: .Card selector ──
        cards = page.locator(".Card").all()
        print(f"   Found {len(cards)} .Card elements")

        for card in cards:
            if len(playlists) >= MAX_RESULTS:
                break
            try:
                txt = card.inner_text(timeout=3000)
                lines = [l.strip() for l in txt.splitlines() if l.strip()]
                if not lines:
                    continue
                name = lines[0]
                creator = "N/A"
                for ln in lines[1:]:
                    m = re.match(r'^[Bb]y\s+(.+)', ln)
                    if m:
                        creator = m.group(1).strip()
                        break
                if name and len(name) >= 2:
                    playlists.append({"name": name, "creator": creator})
            except Exception:
                continue

        # ── Strategy 2: body text fallback (name / By creator alternating) ──
        if not playlists:
            print("   Strategy 1 found 0 — trying body text...")
            body = page.inner_text("body")
            lines = [l.strip() for l in body.splitlines() if l.strip()]
            i = 0
            while i < len(lines) - 1 and len(playlists) < MAX_RESULTS:
                ln = lines[i]
                # Look for "By ..." on one of the next 2 non-empty lines
                for j in range(i + 1, min(i + 3, len(lines))):
                    m = re.match(r'^[Bb]y\s+(.+)', lines[j])
                    if m:
                        # ln is the playlist name
                        if 2 <= len(ln) <= 120 and not ln.startswith("By "):
                            playlists.append({"name": ln, "creator": m.group(1).strip()})
                        i = j + 1
                        break
                else:
                    i += 1

        if not playlists:
            print("❌ ERROR: Extraction failed — no playlists found from the page.")

        print(f"\nDONE – Top {len(playlists)} Jazz Playlists:")
        for i, p in enumerate(playlists, 1):
            print(f"  {i}. {p['name']} | By: {p['creator']}")

    except Exception as e:
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        try:
            browser.close()
        except Exception:
            pass
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)
    return playlists

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
