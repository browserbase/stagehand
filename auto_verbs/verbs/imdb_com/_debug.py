"""Debug: dump IMDB Christopher Nolan page text lines with ratings/years."""
import os, sys, re, shutil
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

with sync_playwright() as pw:
    port = get_free_port()
    prof = get_temp_profile_dir("imdb_dbg")
    proc = launch_chrome(prof, port)
    ws = wait_for_cdp_ws(port)
    br = pw.chromium.connect_over_cdp(ws)
    ctx = br.contexts[0]
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()

    pg.goto("https://www.imdb.com/find/?q=Christopher+Nolan&s=nm",
            wait_until="domcontentloaded", timeout=30000)
    pg.wait_for_timeout(3000)

    pg.locator("a:has-text('Christopher Nolan')").first.evaluate("el => el.click()")
    pg.wait_for_timeout(5000)
    print("URL:", pg.url)

    body = pg.inner_text("body")
    lines = body.splitlines()
    print(f"Total lines: {len(lines)}\n")

    # Print lines with ratings or years
    print("=== Lines with ratings/years ===")
    for i, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue
        has_rating = re.search(r'\d\.\d', line)
        has_year = re.search(r'(?:19|20)\d{2}', line)
        if has_rating or has_year:
            print(f"L{i}: {line[:150]}")

    # Also print first 60 non-empty lines to see page structure
    print("\n=== First 60 non-empty lines ===")
    count = 0
    for i, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue
        print(f"L{i}: {line[:150]}")
        count += 1
        if count >= 60:
            break

    br.close()
    proc.terminate()
    shutil.rmtree(prof, ignore_errors=True)
